import { Hono } from 'hono';
import { unzipSync, zipSync } from 'fflate';
import { and, eq } from 'drizzle-orm';
import * as s from '../../db/schema';
import type { Vars } from '../context';
import { applyDump, diffManifests, isEmpty, snapshot, wipe, type Manifest } from '../backup';
import { sha256Hex } from '../evidence';

const TARGET = () =>
  typeof navigator !== 'undefined' && /Cloudflare-Workers/.test(navigator.userAgent ?? '')
    ? 'cloudflare'
    : 'node';

export const backupRoute = new Hono<Vars>()
  // Full backup as a zip: manifest.json + dump.sql + evidence/*
  .get('/', async (c) => {
    const ctx = c.get('ctx');
    const { manifest, dump } = await snapshot(ctx, TARGET());
    const enc = new TextEncoder();
    const entries: Record<string, [Uint8Array, { level: 0 }]> = {
      'manifest.json': [enc.encode(JSON.stringify(manifest, null, 2)), { level: 0 }],
      'dump.sql': [enc.encode(dump), { level: 0 }],
    };
    for (const e of manifest.evidence) {
      const obj = await ctx.objectStore.get(e.key);
      if (obj)
        entries[e.key] = [new Uint8Array(await new Response(obj.body).arrayBuffer()), { level: 0 }];
    }
    const zip = zipSync(entries, { level: 0 });
    return new Response(zip, {
      headers: {
        'content-type': 'application/zip',
        'content-disposition': `attachment; filename="cpe-pct-backup-${manifest.generatedAt.slice(0, 10)}.zip"`,
        'content-length': String(zip.byteLength),
      },
    });
  })
  // Live manifest (counts, checksums, evidence hashes) for comparison.
  .get('/manifest', async (c) => c.json((await snapshot(c.get('ctx'), TARGET())).manifest))
  // Verify the live instance against a manifest (JSON body = manifest.json from a backup).
  .post('/verify', async (c) => {
    const expected = (await c.req.json()) as Manifest;
    if (expected?.version !== 1) return c.json({ error: 'bad_manifest' }, 400);
    const actual = (await snapshot(c.get('ctx'), TARGET())).manifest;
    const diffs = diffManifests(expected, actual);
    return c.json({
      ok: diffs.length === 0,
      diffs,
      actual: { tables: actual.tables, evidence: actual.evidence.length },
    });
  })
  // Restore: multipart file=backup.zip [force=1]. Refuses a non-empty instance unless force.
  .post('/restore', async (c) => {
    const ctx = c.get('ctx');
    const body = await c.req.parseBody();
    const file = body['file'];
    const force = body['force'] === '1' || body['force'] === 'true';
    if (!(file instanceof File)) return c.json({ error: 'file_required' }, 400);
    if (!(await isEmpty(ctx)) && !force)
      return c.json({ error: 'not_empty', hint: 'pass force=1 to wipe and restore' }, 409);
    let files: Record<string, Uint8Array>;
    try {
      files = unzipSync(new Uint8Array(await file.arrayBuffer()));
    } catch {
      return c.json({ error: 'bad_zip' }, 400);
    }
    const dec = new TextDecoder();
    const manifest = files['manifest.json']
      ? (JSON.parse(dec.decode(files['manifest.json'])) as Manifest)
      : null;
    const dump = files['dump.sql'] ? dec.decode(files['dump.sql']) : null;
    if (!manifest || !dump) return c.json({ error: 'missing_manifest_or_dump' }, 400);
    if (force) await wipe(ctx);
    else {
      // Fresh instance still carries catalog seeds + setup rows; the dump re-creates them, so clear first.
      await wipe(ctx);
    }
    const statements = await applyDump(ctx, dump);
    let objects = 0;
    for (const e of manifest.evidence) {
      const bytes = files[e.key];
      if (!bytes) continue;
      if ((await sha256Hex(bytes)) !== e.sha256)
        return c.json({ error: 'evidence_hash_mismatch', key: e.key }, 400);
      const meta = await ctx.db
        .select({ contentType: s.evidence.contentType })
        .from(s.evidence)
        .where(and(eq(s.evidence.objectKey, e.key)))
        .get();
      await ctx.objectStore.put(e.key, bytes, {
        contentType: meta?.contentType ?? 'application/octet-stream',
        size: bytes.byteLength,
      });
      objects += 1;
    }
    const actual = (await snapshot(ctx, TARGET())).manifest;
    const diffs = diffManifests(manifest, actual);
    return c.json({ ok: diffs.length === 0, statements, objects, diffs }, diffs.length ? 207 : 201);
  });
