// FsObjectStore: $DATA_DIR/<key> with keys like evidence/ab/cd/<sha256>. Rejects traversal. Streams.
import { createReadStream, createWriteStream, type Dirent } from 'node:fs';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ObjectStore, StoredObject } from '../../ports';

const SAFE_KEY = /^[A-Za-z0-9][A-Za-z0-9._\-/]*$/;

export class FsObjectStore implements ObjectStore {
  constructor(private readonly root: string) {}

  private resolve(key: string): string {
    if (
      !SAFE_KEY.test(key) ||
      key.split('/').some((seg) => seg === '' || seg === '.' || seg === '..')
    )
      throw new Error(`invalid object key: ${key}`);
    const abs = path.resolve(this.root, key);
    if (!abs.startsWith(path.resolve(this.root) + path.sep))
      throw new Error(`key escapes root: ${key}`);
    return abs;
  }

  async put(
    key: string,
    body: Uint8Array | ReadableStream<Uint8Array>,
    meta: { contentType: string; size?: number },
  ): Promise<void> {
    const file = this.resolve(key);
    await mkdir(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp-${crypto.randomUUID()}`;
    if (body instanceof Uint8Array) await writeFile(tmp, body);
    else
      await pipeline(
        Readable.fromWeb(body as unknown as NodeReadableStream),
        createWriteStream(tmp),
      );
    await writeFile(`${file}.meta.json`, JSON.stringify({ contentType: meta.contentType }));
    await rm(file, { force: true });
    await rename(tmp, file);
  }

  async get(key: string): Promise<StoredObject | null> {
    const head = await this.head(key);
    if (!head) return null;
    const stream = Readable.toWeb(
      createReadStream(this.resolve(key)),
    ) as ReadableStream<Uint8Array>;
    return { body: stream, contentType: head.contentType, size: head.size };
  }

  async head(key: string): Promise<Omit<StoredObject, 'body'> | null> {
    const file = this.resolve(key);
    try {
      const st = await stat(file);
      let contentType = 'application/octet-stream';
      try {
        contentType = (
          JSON.parse(await readFile(`${file}.meta.json`, 'utf8')) as { contentType: string }
        ).contentType;
      } catch {
        /* no meta */
      }
      return { contentType, size: st.size };
    } catch {
      return null;
    }
  }

  async delete(key: string): Promise<void> {
    const file = this.resolve(key);
    await rm(file, { force: true });
    await rm(`${file}.meta.json`, { force: true });
  }

  async *list(prefix: string): AsyncIterable<{ key: string; size: number }> {
    const dir = this.resolve(prefix.replace(/\/$/, '') || '.');
    const walk = async function* (
      d: string,
      rel: string,
    ): AsyncGenerator<{ key: string; size: number }> {
      let entries: Dirent[];
      try {
        entries = await readdir(d, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        const r = rel ? `${rel}/${e.name}` : e.name;
        if (e.isDirectory()) yield* walk(path.join(d, e.name), r);
        else if (!e.name.endsWith('.meta.json') && !e.name.includes('.tmp-'))
          yield { key: r, size: (await stat(path.join(d, e.name))).size };
      }
    };
    for await (const x of walk(dir, prefix.replace(/\/$/, ''))) yield x;
  }
}
