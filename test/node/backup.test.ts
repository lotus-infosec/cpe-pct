import { readFileSync } from 'node:fs';
import { unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { createApp, tick } from '../../src/app';
import * as s from '../../src/db/schema';
import { applyDump, snapshot, wipe } from '../../src/app/backup';
import { testContext } from './app';
import { seedOwnerWorld } from '../seed-world';
import expected from '../fixtures/world-checksums.json';

const clock = { now: () => new Date('2026-09-12T09:00:00Z') };
const PW = 'correct horse battery staple';
const pdf = new Uint8Array(readFileSync('test/fixtures/certificate-text.pdf'));

async function instance() {
  const ctx = await testContext(clock);
  const app = createApp(ctx);
  const call = async (path: string, init: RequestInit & { cookie?: string } = {}) => {
    const { cookie, ...rest } = init;
    const res = await app.request(path, {
      ...rest,
      headers: { ...(rest.headers as Record<string, string>), ...(cookie ? { cookie } : {}) },
    });
    return res;
  };
  return { ctx, app, call };
}
const json = (b: unknown) => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(b),
});

describe('export bundle', () => {
  it('builds a zip with the body CSV, manifest, README, and evidence', async () => {
    const a = await instance();
    const cookie = (await a.call('/api/setup', json({ password: PW }))).headers
      .get('set-cookie')!
      .split(';')[0]!;
    await seedOwnerWorld(a.ctx.db, clock.now().toISOString());
    const fd = new FormData();
    fd.set('file', new Blob([pdf]), 'cert.pdf');
    fd.set('activityId', 'a-new');
    expect((await a.call('/api/evidence', { method: 'POST', body: fd, cookie })).status).toBe(201);
    const created = (await (
      await a.call('/api/exports', { ...json({ cycleId: 'cy-secplus' }), cookie })
    ).json()) as { id: string };
    expect(await (await a.call('/api/jobs/tick', { method: 'POST', cookie })).json()).toMatchObject(
      { failed: 0 },
    );
    const row = (await (await a.call(`/api/exports/${created.id}`, { cookie })).json()) as {
      status: string;
      progress: { done: number; total: number };
    };
    expect(row).toMatchObject({ status: 'ready', progress: { done: 1, total: 1 } });
    const zip = unzipSync(
      new Uint8Array(
        await (await a.call(`/api/exports/${created.id}/download`, { cookie })).arrayBuffer(),
      ),
    );
    const names = Object.keys(zip).sort();
    expect(names).toEqual([
      'README.txt',
      'comptia-security-plus-cycle-2.csv',
      'evidence-manifest.csv',
      'evidence/2024-05-01_Course/cert.pdf',
    ]);
    expect(new TextDecoder().decode(zip['comptia-security-plus-cycle-2.csv'])).toContain(
      'Course,2024-05-01,50,50,',
    );
    expect(zip['evidence/2024-05-01_Course/cert.pdf']!.byteLength).toBe(pdf.byteLength);
    const notes = (await (await a.call('/api/notifications', { cookie })).json()) as {
      kind: string;
    }[];
    expect(notes.some((n) => n.kind === 'export_ready')).toBe(true);
  });
});

describe('backup → fresh instance → restore → verify', () => {
  it('round-trips with zero differences and the owner password still works', async () => {
    const a = await instance();
    const cookie = (await a.call('/api/setup', json({ password: PW }))).headers
      .get('set-cookie')!
      .split(';')[0]!;
    await seedOwnerWorld(a.ctx.db, clock.now().toISOString());
    // A DRAFT activity so the linked upload writes a multi-line description (newline inside a literal).
    const draft = (await (
      await a.call('/api/activities', {
        ...json({ title: 'Draft', occurredOn: '2024-06-01', activityType: 'other' }),
        cookie,
      })
    ).json()) as { id: string };
    const fd = new FormData();
    fd.set('file', new Blob([pdf]), 'cert.pdf');
    fd.set('activityId', draft.id);
    await a.call('/api/evidence', { method: 'POST', body: fd, cookie });
    const withNl = (await (await a.call(`/api/activities/${draft.id}`, { cookie })).json()) as {
      description: string;
    };
    expect(withNl.description).toContain('\n');
    await a.call('/api/notifications/scan', { ...json({}), cookie });

    const zipBytes = new Uint8Array(await (await a.call('/api/backup', { cookie })).arrayBuffer());
    const files = unzipSync(zipBytes);
    const manifest = JSON.parse(new TextDecoder().decode(files['manifest.json'])) as {
      tables: Record<string, number>;
      evidence: unknown[];
      checksums: Record<string, string>;
    };
    expect(manifest.tables['held_certifications']).toBe(2);
    expect(manifest.tables['sessions']).toBeUndefined();
    expect(manifest.evidence.length).toBe(1);
    expect(files['dump.sql']).toBeDefined();

    // Fresh instance: not set up. Restore is allowed exactly then.
    const b = await instance();
    expect(await (await b.call('/api/setup')).json()).toEqual({ setUp: false });
    const rfd = new FormData();
    rfd.set('file', new Blob([zipBytes]), 'backup.zip');
    const r = await b.call('/api/backup/restore', { method: 'POST', body: rfd });
    const rj = (await r.json()) as {
      ok: boolean;
      diffs: unknown[];
      statements: number;
      objects: number;
    };
    expect(r.status).toBe(201);
    expect(rj).toMatchObject({ ok: true, diffs: [], objects: 1 });
    expect(rj.statements).toBeGreaterThan(100); // catalog seeds + world

    // Verify endpoint agrees, and the old password logs in on the restored instance.
    const login = await b.call('/api/login', json({ password: PW }));
    expect(login.status).toBe(200);
    const bc = login.headers.get('set-cookie')!.split(';')[0]!;
    const v = (await (
      await b.call('/api/backup/verify', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: new TextDecoder().decode(files['manifest.json']),
        cookie: bc,
      })
    ).json()) as { ok: boolean; diffs: unknown[] };
    expect(v).toMatchObject({ ok: true, diffs: [] });
    const ev = await b.call('/api/evidence', { cookie: bc });
    expect(((await ev.json()) as { rows: unknown[] }).rows.length).toBe(1);
    // Restored evidence bytes are the originals.
    const evRow = (await b.ctx.db.select().from(s.evidence).get())!;
    const obj = await b.ctx.objectStore.get(evRow.objectKey);
    expect((await new Response(obj!.body).arrayBuffer()).byteLength).toBe(pdf.byteLength);

    // A second restore without force is refused; with force it succeeds.
    const again = new FormData();
    again.set('file', new Blob([zipBytes]), 'backup.zip');
    expect(
      (await b.call('/api/backup/restore', { method: 'POST', body: again, cookie: bc })).status,
    ).toBe(409);
    const forced = new FormData();
    forced.set('file', new Blob([zipBytes]), 'backup.zip');
    forced.set('force', '1');
    expect(
      (await b.call('/api/backup/restore', { method: 'POST', body: forced, cookie: bc })).status,
    ).toBe(201);
  });
  it('a row written after the wipe does not abort the restore', async () => {
    // D1 has no interactive transaction, so nothing holds the wipe against a concurrent writer.
    // On Workers the every-minute cron re-seeds the recurring renewal_scan as soon as the jobs
    // table is empty, and that row carries the same idempotency_key as the one in the dump.
    const a = await instance();
    await a.call('/api/setup', json({ password: PW }));
    await seedOwnerWorld(a.ctx.db, clock.now().toISOString());
    await tick(a.ctx, { maxJobs: 5, softDeadlineMs: 5000 });
    const source = (await a.ctx.db.select().from(s.jobs).all()).find((j) => j.idempotencyKey)!;
    const { dump } = await snapshot(a.ctx, 'node');

    const b = await instance();
    await wipe(b.ctx);
    await b.ctx.db.insert(s.jobs).values({ ...source, id: 'written-after-the-wipe' });
    await expect(applyDump(b.ctx, dump)).resolves.toBeGreaterThan(100);
    const jobs = await b.ctx.db.select().from(s.jobs).all();
    // The raced row was replaced by the backup's, not added alongside it.
    expect(jobs.map((j) => j.id)).not.toContain('written-after-the-wipe');
    expect(jobs.filter((j) => j.idempotencyKey === source.idempotencyKey).length).toBe(1);
  });

  it('checksums are deterministic for the same world (cross-target comparability)', async () => {
    const a = await instance();
    await seedOwnerWorld(a.ctx.db, clock.now().toISOString());
    const m1 = (await (
      await a.call('/api/backup/manifest', {
        cookie: (await a.call('/api/setup', json({ password: PW }))).headers
          .get('set-cookie')!
          .split(';')[0]!,
      })
    ).json()) as { checksums: Record<string, string> };
    const b = await instance();
    await seedOwnerWorld(b.ctx.db, clock.now().toISOString());
    const m2 = (await (
      await b.call('/api/backup/manifest', {
        cookie: (await b.call('/api/setup', json({ password: PW }))).headers
          .get('set-cookie')!
          .split(';')[0]!,
      })
    ).json()) as { checksums: Record<string, string> };
    for (const t of [
      'held_certifications',
      'cycles',
      'activities',
      'credit_applications',
      'payments',
      'bodies',
      'crediting_rules',
    ])
      expect(m1.checksums[t]).toBe(m2.checksums[t]);
    for (const [t, sum] of Object.entries(expected.checksums)) expect(m1.checksums[t], t).toBe(sum);
  });
});
