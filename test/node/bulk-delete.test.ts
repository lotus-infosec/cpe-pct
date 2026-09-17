// STAGE8 bulk delete: exact cascade counts, evidence survives, submitted work is refused by default,
// selection limits, filter mode guarded by the count the person saw. Synthetic data only.
import { beforeEach, describe, expect, it } from 'vitest';
import { count, eq } from 'drizzle-orm';
import * as s from '../../src/db/schema';
import type { AppContext } from '../../src/app/context';
import type { Clock } from '../../src/ports';
import { unzipSync, strFromU8 } from 'fflate';
import { tick } from '../../src/app';
import { testApp } from './app';

const clock: Clock = { now: () => new Date('2026-09-11T12:00:00Z') };
let app: Awaited<ReturnType<typeof testApp>>['app'];
let ctx: AppContext;
let cookie = '';
let cissp = { held: '', cycle: '' };
let cc = { held: '', cycle: '' };

const call = async (method: string, path: string, body?: unknown) => {
  const res = await app.request(path, {
    method,
    headers: { 'content-type': 'application/json', cookie, origin: 'http://localhost' },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });
  return { status: res.status, json: (await res.json()) as any };
};
const rows = async (table: Parameters<ReturnType<AppContext['db']['select']>['from']>[0]) =>
  (await ctx.db.select({ n: count() }).from(table).get())!.n;

async function hold(certificationId: string) {
  const r = await call('POST', '/api/held', { certificationId, earnedOn: '2025-05-01' });
  return { held: r.json.id as string, cycle: r.json.cycles[0].id as string };
}

/**
 * act-00..act-09: CISSP claimed 1.00 each, CC claimed 0.50 each
 * act-10, act-11: CISSP submitted / accepted 2.00 (the dangerous case)
 * act-12..act-19: no applications
 * ev-shared links act-00 and act-15; ev-only links act-01 only; ev-kept links act-15 only.
 */
async function seed(n = 20) {
  const acts = Array.from({ length: n }, (_, i) => ({
    id: `act-${String(i).padStart(2, '0')}`,
    title: `Synthetic activity ${String(i).padStart(2, '0')}`,
    occurredOn: '2026-02-01',
    activityType: 'attend_webinar',
    source: 'manual' as const,
    status: 'logged' as const,
    createdAt: '2026-09-01T00:00:00Z',
  }));
  for (let i = 0; i < acts.length; i += 50)
    await ctx.db.insert(s.activities).values(acts.slice(i, i + 50));
  const apps = [];
  for (let i = 0; i < Math.min(10, n); i++) {
    const id = acts[i]!.id;
    apps.push(
      {
        id: `ca-cissp-${i}`,
        activityId: id,
        heldCertId: cissp.held,
        cycleId: cissp.cycle,
        creditsX100: 100,
        status: 'claimed' as const,
        ruleVersionId: 'isc2@1',
      },
      {
        id: `ca-cc-${i}`,
        activityId: id,
        heldCertId: cc.held,
        cycleId: cc.cycle,
        creditsX100: 50,
        status: 'claimed' as const,
        ruleVersionId: 'isc2@1',
      },
    );
  }
  apps.push(
    {
      id: 'ca-sub',
      activityId: 'act-10',
      heldCertId: cissp.held,
      cycleId: cissp.cycle,
      creditsX100: 200,
      status: 'submitted' as const,
      ruleVersionId: 'isc2@1',
    },
    {
      id: 'ca-acc',
      activityId: 'act-11',
      heldCertId: cissp.held,
      cycleId: cissp.cycle,
      creditsX100: 200,
      status: 'accepted' as const,
      ruleVersionId: 'isc2@1',
    },
  );
  await ctx.db.insert(s.creditApplications).values(apps);
  await ctx.db.insert(s.evidence).values(
    ['ev-shared', 'ev-only', 'ev-kept'].map((id, i) => ({
      id,
      objectKey: `evidence/${id}`,
      sha256: String(i).repeat(64),
      filename: `${id}.pdf`,
      contentType: 'application/pdf',
      sizeBytes: 100,
      extractionStatus: 'done' as const,
      uploadedAt: '2026-09-01T00:00:00Z',
    })),
  );
  await ctx.db.insert(s.activityEvidence).values([
    { activityId: 'act-00', evidenceId: 'ev-shared' },
    { activityId: 'act-15', evidenceId: 'ev-shared' },
    { activityId: 'act-01', evidenceId: 'ev-only' },
    { activityId: 'act-15', evidenceId: 'ev-kept' },
  ]);
}

beforeEach(async () => {
  ({ app, ctx } = await testApp(clock));
  const setup = await app.request('/api/setup', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password: 'correct horse battery staple' }),
  });
  cookie = setup.headers.get('set-cookie')!.split(';')[0]!;
  cissp = await hold('isc2/cissp');
  cc = await hold('isc2/cc');
});

describe('preview', () => {
  it('states exact consequences and writes nothing', async () => {
    await seed();
    const ids = ['act-00', 'act-01', 'act-02', 'act-10', 'act-12'];
    const before = [
      await rows(s.activities),
      await rows(s.creditApplications),
      await rows(s.activityEvidence),
    ];
    const r = await call('POST', '/api/activities/bulk-delete/preview', { ids });
    expect(r.status).toBe(200);
    expect(r.json).toEqual({
      deleted: 4,
      applicationsRemoved: 6,
      evidenceUnlinked: 2,
      evidenceOrphaned: 1,
      cyclesAffected: 2,
      refused: [
        {
          id: 'act-10',
          title: 'Synthetic activity 10',
          reason: expect.stringMatching(/submitted/),
        },
      ],
      unknown: [],
    });
    expect([
      await rows(s.activities),
      await rows(s.creditApplications),
      await rows(s.activityEvidence),
    ]).toEqual(before);
  });
});

describe('delete', () => {
  it('cascades exactly, keeps evidence, and refuses submitted or accepted work by default', async () => {
    await seed();
    const ids = ['act-00', 'act-01', 'act-02', 'act-10', 'act-11', 'act-12'];
    const preview = (await call('POST', '/api/activities/bulk-delete/preview', { ids })).json;
    const r = await call('POST', '/api/activities/bulk-delete', { ids });
    expect(r.status).toBe(200);
    expect(r.json).toEqual(preview);
    expect(r.json.deleted).toBe(4);
    expect(r.json.refused.map((x: any) => x.id)).toEqual(['act-10', 'act-11']);
    expect(await rows(s.activities)).toBe(16);
    // 22 applications seeded; 3 deleted activities with 2 each.
    expect(await rows(s.creditApplications)).toBe(16);
    expect(await rows(s.evidence)).toBe(3);
    // ev-shared still linked to act-15; ev-only now unlinked, and listed as such.
    const unlinked = await call('GET', '/api/evidence?linked=unlinked');
    expect(unlinked.json.rows.map((e: any) => e.id)).toEqual(['ev-only']);
    expect((await call('GET', '/api/evidence?linked=linked')).json.total).toBe(2);
    expect(
      await ctx.db.select().from(s.activities).where(eq(s.activities.id, 'act-10')).get(),
    ).toBeTruthy();
  });

  it('deletes submitted and accepted work only when asked to', async () => {
    await seed();
    const r = await call('POST', '/api/activities/bulk-delete', {
      ids: ['act-10', 'act-11'],
      includeSubmitted: true,
    });
    expect(r.json).toMatchObject({ deleted: 2, applicationsRemoved: 2, refused: [] });
    expect(await rows(s.activities)).toBe(18);
  });

  it('leaves standing equal to before minus exactly the removed credits', async () => {
    await seed();
    const standing = async (cycle: string) =>
      (await call('GET', `/api/cycles/${cycle}/standing`)).json.totals;
    const beforeCissp = await standing(cissp.cycle);
    const beforeCc = await standing(cc.cycle);
    await call('POST', '/api/activities/bulk-delete', {
      ids: ['act-00', 'act-01', 'act-02', 'act-10'],
    });
    // CISSP loses 3 × 1.00 claimed (act-10 refused); CC loses 3 × 0.50 claimed.
    expect(await standing(cissp.cycle)).toEqual({
      ...beforeCissp,
      claimed: beforeCissp.claimed - 300,
    });
    expect(await standing(cc.cycle)).toEqual({ ...beforeCc, claimed: beforeCc.claimed - 150 });
  });

  it('deduplicates ids and reports unknown ones instead of ignoring them', async () => {
    await seed();
    const r = await call('POST', '/api/activities/bulk-delete', {
      ids: ['act-12', 'act-12', 'act-13', 'nope-1', 'nope-2', 'nope-1'],
    });
    expect(r.json).toMatchObject({ deleted: 2, unknown: ['nope-1', 'nope-2'] });
  });

  it.each([
    ['an empty array', { ids: [] }],
    ['501 ids', { ids: Array.from({ length: 501 }, (_, i) => `id-${i}`) }],
    ['neither ids nor filter', {}],
    ['both ids and filter', { ids: ['act-00'], filter: {} }],
    ['a filter without expectedCount', { filter: { type: 'attend_webinar' } }],
    ['a filter with a bad type', { filter: { type: 'hacking' }, expectedCount: 1 }],
    ['an over-long search term', { filter: { q: 'x'.repeat(5000) }, expectedCount: 1 }],
    ['a non-boolean includeSubmitted', { ids: ['act-00'], includeSubmitted: 'yes' }],
    ['an unknown key', { ids: ['act-00'], everything: true }],
  ])('rejects %s with a 400', async (_label, body) => {
    await seed();
    expect((await call('POST', '/api/activities/bulk-delete', body)).status).toBe(400);
    expect((await call('POST', '/api/activities/bulk-delete/preview', body)).status).toBe(400);
    expect(await rows(s.activities)).toBe(20);
  });
});

describe('filter mode', () => {
  it('refuses when the matching set changed since the count was shown', async () => {
    await seed();
    const r = await call('POST', '/api/activities/bulk-delete', {
      filter: { q: 'synthetic' },
      expectedCount: 19,
    });
    expect(r.status).toBe(409);
    expect(r.json).toMatchObject({ error: 'selection_changed', matched: 20 });
    expect(await rows(s.activities)).toBe(20);
  });

  it('deletes more than one request of ids and more than one batch, in chunks', async () => {
    await seed(1_700);
    const filter = { q: 'synthetic', from: '2026-01-01', to: '2026-12-31' };
    const preview = await call('POST', '/api/activities/bulk-delete/preview', {
      filter,
      expectedCount: 1_700,
    });
    expect(preview.json).toMatchObject({
      deleted: 1_698,
      refused: [{ id: 'act-10' }, { id: 'act-11' }],
    });
    const r = await call('POST', '/api/activities/bulk-delete', { filter, expectedCount: 1_700 });
    expect(r.json.deleted).toBe(1_698);
    expect(await rows(s.activities)).toBe(2);
    expect(await rows(s.creditApplications)).toBe(2);
    expect(await rows(s.evidence)).toBe(3);
  });
});

describe('export selection first', () => {
  it('bundles the selected activities, their applications and evidence before a delete', async () => {
    await seed();
    const pdf = new TextEncoder().encode('%PDF-1.4 synthetic');
    await ctx.objectStore.put('evidence/ev-only', pdf, {
      contentType: 'application/pdf',
      size: pdf.byteLength,
    });
    const r = await call('POST', '/api/exports', { ids: ['act-01', 'act-10', 'nope'] });
    expect(r.status).toBe(202);
    await tick(ctx, { maxJobs: 5, softDeadlineMs: 5000 });
    const list = (await call('GET', '/api/exports')).json as any[];
    const row = list.find((e) => e.id === r.json.id);
    expect(row).toMatchObject({ status: 'ready', cycleId: null, activityCount: 2 });
    expect(row.activityIds).toBeUndefined();
    const res = await app.request(`/api/exports/${r.json.id}/download`, { headers: { cookie } });
    expect(res.headers.get('content-disposition')).toMatch(/cpe-pct-export-selection-/);
    const files = unzipSync(new Uint8Array(await res.arrayBuffer()));
    const activities = strFromU8(files['activities.csv']!);
    expect(activities).toContain('Synthetic activity 01');
    expect(activities).toContain('Synthetic activity 10');
    expect(strFromU8(files['credit-applications.csv']!).trim().split('\r\n')).toHaveLength(4);
    expect(files['evidence/2026-02-01_Synthetic_activity_01/ev-only.pdf']).toEqual(pdf);
    expect(Object.keys(files)).not.toContain('MISSING-EVIDENCE.txt');
  });

  it('uses the same selection rules as delete', async () => {
    await seed();
    expect((await call('POST', '/api/exports', { ids: ['nope'] })).json.error).toBe(
      'nothing_selected',
    );
    expect(
      (await call('POST', '/api/exports', { filter: { q: 'synthetic' }, expectedCount: 3 })).status,
    ).toBe(409);
    expect(
      (await call('POST', '/api/exports', { cycleId: cissp.cycle, ids: ['act-00'] })).status,
    ).toBe(400);
  });
});
