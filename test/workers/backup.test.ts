import { createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test';
import { unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import worker from '../../src/entry.cloudflare';
import { openD1 } from '../../src/adapters/cloudflare/db';
import { R2ObjectStore } from '../../src/adapters/cloudflare/r2-object-store';
import { DbJobQueue } from '../../src/adapters/shared/db-job-queue';
import { LocalAuth } from '../../src/adapters/shared/local-auth';
import { PdfTextExtractor } from '../../src/adapters/shared/pdf-text-extractor';
import { snapshot } from '../../src/app/backup';
import { seedOwnerWorld } from '../seed-world';
import expected from '../fixtures/world-checksums.json';
import textPdf from '../fixtures/certificate-text.pdf?raw-bytes';

const clock = { now: () => new Date('2026-09-12T09:00:00Z') };
let cookie = '';
async function call(path: string, init: RequestInit = {}) {
  const ectx = createExecutionContext();
  const res = await worker.fetch(
    new Request(`http://x${path}`, {
      ...init,
      headers: { cookie, ...(init.headers as Record<string, string>) },
    }),
    env,
    ectx,
  );
  await waitOnExecutionContext(ectx);
  return res;
}

describe('backup / restore on workerd + D1 + R2', () => {
  it('the same world yields the same table checksums as Node (cross-target comparability)', async () => {
    const db = openD1(env.DB);
    const ctx = {
      db,
      clock,
      auth: new LocalAuth(db, clock),
      objectStore: new R2ObjectStore(env.EVIDENCE),
      textExtractor: new PdfTextExtractor(),
      jobQueue: new DbJobQueue(db, clock),
    };
    await seedOwnerWorld(db, clock.now().toISOString());
    const { manifest } = await snapshot(ctx, 'cloudflare');
    for (const [t, n] of Object.entries(expected.tables)) expect(manifest.tables[t], t).toBe(n);
    for (const [t, sum] of Object.entries(expected.checksums))
      expect(manifest.checksums[t], t).toBe(sum);
  });

  it('backup → wipe → restore(force) → verify: zero differences, evidence re-hashed from R2', async () => {
    const r = await call('/api/setup', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: 'correct horse battery staple' }),
    });
    cookie = r.headers.get('set-cookie')!.split(';')[0]!;
    const fd = new FormData();
    fd.set('file', new Blob([textPdf]), 'cert.pdf');
    fd.set('activityId', 'a-new');
    expect((await call('/api/evidence', { method: 'POST', body: fd })).status).toBe(201);
    const zip = new Uint8Array(await (await call('/api/backup')).arrayBuffer());
    const files = unzipSync(zip);
    const manifest = JSON.parse(new TextDecoder().decode(files['manifest.json'])) as {
      evidence: unknown[];
      tables: Record<string, number>;
    };
    expect(manifest.evidence.length).toBe(1);
    expect(manifest.tables['held_certifications']).toBe(2);
    const rfd = new FormData();
    rfd.set('file', new Blob([zip]), 'backup.zip');
    rfd.set('force', '1');
    const res = await call('/api/backup/restore', { method: 'POST', body: rfd });
    const json = (await res.json()) as { ok: boolean; diffs: unknown[]; objects: number };
    expect(res.status).toBe(201);
    expect(json).toMatchObject({ ok: true, diffs: [], objects: 1 });
    // Session was wiped with the restore; log in again with the backed-up password and verify.
    const login = await call('/api/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: 'correct horse battery staple' }),
    });
    expect(login.status).toBe(200);
    cookie = login.headers.get('set-cookie')!.split(';')[0]!;
    const v = (await (
      await call('/api/backup/verify', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: new TextDecoder().decode(files['manifest.json']),
      })
    ).json()) as { ok: boolean };
    expect(v.ok).toBe(true);
  });
});
