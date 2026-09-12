// R2ObjectStore over the EVIDENCE binding. Streams both ways.
import type { ObjectStore, StoredObject } from '../../ports';

export class R2ObjectStore implements ObjectStore {
  constructor(private readonly bucket: R2Bucket) {}

  async put(
    key: string,
    body: Uint8Array | ReadableStream<Uint8Array>,
    meta: { contentType: string; size?: number },
  ): Promise<void> {
    // R2 needs a known length for streams; buffer when the caller cannot supply one.
    const data =
      body instanceof Uint8Array || meta.size != null
        ? body
        : new Uint8Array(await new Response(body).arrayBuffer());
    await this.bucket.put(key, data as Uint8Array | ReadableStream, {
      httpMetadata: { contentType: meta.contentType },
    });
  }

  async get(key: string): Promise<StoredObject | null> {
    const obj = await this.bucket.get(key);
    if (!obj) return null;
    return {
      body: obj.body,
      contentType: obj.httpMetadata?.contentType ?? 'application/octet-stream',
      size: obj.size,
    };
  }

  async head(key: string): Promise<Omit<StoredObject, 'body'> | null> {
    const obj = await this.bucket.head(key);
    if (!obj) return null;
    return {
      contentType: obj.httpMetadata?.contentType ?? 'application/octet-stream',
      size: obj.size,
    };
  }

  async delete(key: string): Promise<void> {
    await this.bucket.delete(key);
  }

  async *list(prefix: string): AsyncIterable<{ key: string; size: number }> {
    let cursor: string | undefined;
    do {
      const page = await this.bucket.list({ prefix, ...(cursor && { cursor }) });
      for (const o of page.objects) yield { key: o.key, size: o.size };
      cursor = page.truncated ? page.cursor : undefined;
    } while (cursor);
  }
}
