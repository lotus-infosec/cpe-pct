// Public demo (demo branch): no accounts, refused routes, growth caps, and the 12-hour reset leaving
// the catalog intact. Small limits keep the suite fast; the real ones are DEMO_LIMITS. Synthetic data only.
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import { count } from 'drizzle-orm';
import * as s from '../../src/db/schema';
import type { AppContext } from '../../src/app/context';
import { DEMO_LIMITS, demoApp, nextResetAt, resetDemo, type DemoLimits } from '../../src/demo';
import { testContext } from './app';

const LIMITS: DemoLimits = {
  heldCertifications: 3,
  activities: 5,
  memberships: 2,
  evidenceFiles: 2,
  evidenceBytes: 4096,
  exports: 1,
};
const clock = { now: () => new Date('2026-09-17T13:30:00Z') };
const PDF = readFileSync('test/fixtures/certificate-text.pdf');
const PNG = readFileSync('test/fixtures/tiny.png');

let ctx: AppContext;
let app: ReturnType<typeof demoApp>;

// No cookie anywhere in this file: the demo must work for a visitor who never logged in.
const call = async (method: string, path: string, body?: unknown) => {
  const res = await app.request(path, {
    method,
    headers: { 'content-type': 'application/json', origin: 'http://localhost' },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });
  const text = await res.text();
  return { status: res.status, json: (text ? JSON.parse(text) : null) as any };
};
const upload = async (bytes: Uint8Array, name: string, activityId?: string) => {
  const fd = new FormData();
  fd.set('file', new Blob([bytes]), name);
  if (activityId) fd.set('activityId', activityId);
  const res = await app.request('/api/evidence', { method: 'POST', body: fd });
  return { status: res.status, json: (await res.json()) as any };
};
const rows = async (table: Parameters<ReturnType<AppContext['db']['select']>['from']>[0]) =>
  (await ctx.db.select({ n: count() }).from(table).get())!.n;
const certIds = async () =>
  (await ctx.db.select({ id: s.certifications.id }).from(s.certifications).all()).map((c) => c.id);
const activity = (i: number) => ({
  title: `Synthetic demo activity ${i}`,
  occurredOn: '2026-09-01',
  activityType: 'attend_webinar',
  durationMinutes: 60,
});

beforeEach(async () => {
  ctx = await testContext(clock);
  app = demoApp(ctx, LIMITS);
});

describe('no accounts', () => {
  it('reports set up and treats every request as the owner, with no cookie', async () => {
    expect((await call('GET', '/api/setup')).json).toEqual({ setUp: true });
    const me = await call('GET', '/api/me');
    expect(me.status).toBe(200);
    expect(me.json).toEqual({ id: 'owner', via: 'demo' });
    expect((await call('GET', '/api/dashboard')).status).toBe(200);
  });
  it('refuses setup, login and logout', async () => {
    for (const path of ['/api/setup', '/api/login', '/api/logout']) {
      const r = await call('POST', path, { password: 'synthetic-password-123' });
      expect(r.status, path).toBe(403);
      expect(r.json.error).toMatch(/no accounts/);
    }
    expect(await ctx.auth.isSetUp()).toBe(false);
  });
  it('keeps the CSRF origin check', async () => {
    const res = await app.request('/api/activities', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://evil.example' },
      body: JSON.stringify(activity(0)),
    });
    expect(res.status).toBe(403);
  });
});

describe('refused routes', () => {
  it('turns off notification settings, test sends, backup download and restore', async () => {
    expect(
      (await call('PUT', '/api/settings', { 'notify.webhook_url': 'https://x.test/h' })).status,
    ).toBe(403);
    expect((await call('POST', '/api/settings/test-send')).status).toBe(403);
    expect((await call('GET', '/api/backup')).status).toBe(403);
    const fd = new FormData();
    fd.set('file', new Blob([new Uint8Array(4)]), 'b.zip');
    expect((await app.request('/api/backup/restore', { method: 'POST', body: fd })).status).toBe(
      403,
    );
    expect(await rows(s.settings)).toBe(0);
  });
  it('stores uploads but never serves them back, and never serves export zips', async () => {
    const up = await upload(PNG, 'tiny.png');
    expect(up.status).toBe(201);
    const content = await call('GET', `/api/evidence/${up.json.evidenceId}/content`);
    expect(content.status).toBe(403);
    expect((await call('GET', '/api/exports/anything/download')).status).toBe(403);
  });
  it('still answers unknown API paths with JSON 404', async () => {
    const r = await call('GET', '/api/nope');
    expect(r.status).toBe(404);
    expect(r.json).toEqual({ error: 'not_found' });
  });
});

describe('caps', () => {
  it('held certifications', async () => {
    const ids = await certIds();
    for (let i = 0; i < LIMITS.heldCertifications; i++)
      expect(
        (await call('POST', '/api/held', { certificationId: ids[i], earnedOn: '2025-01-01' }))
          .status,
      ).toBe(201);
    const over = await call('POST', '/api/held', {
      certificationId: ids[9],
      earnedOn: '2025-01-01',
    });
    expect(over.status).toBe(409);
    expect(over.json.error).toMatch(/at most 3 certifications/);
    expect(await rows(s.heldCertifications)).toBe(3);
  });
  it('memberships', async () => {
    for (const bodyId of ['isc2', 'isaca'])
      expect((await call('POST', '/api/memberships', { bodyId })).status).toBe(201);
    expect((await call('POST', '/api/memberships', { bodyId: 'iapp' })).status).toBe(409);
  });
  it('activities, including drafts created by uploads and rows added by CSV import', async () => {
    for (let i = 0; i < 3; i++)
      expect((await call('POST', '/api/activities', activity(i))).status).toBe(201);
    // Import of 3 rows would make 6 > 5: refused whole.
    const csv = [
      'certification,occurred_on,title,activity_type,minutes,credits',
      ...[1, 2, 3].map((i) => `isc2/cissp,2026-09-0${i},Row ${i},attend_webinar,60,1`),
    ].join('\n');
    const imp = await call('POST', '/api/import', { filename: 'h.csv', csv });
    expect(imp.status).toBe(409);
    expect(await rows(s.activities)).toBe(3);
    // One upload without an activity makes a draft (4), a second makes 5, then the cap bites.
    expect((await upload(PNG, 'a.png')).status).toBe(201);
    expect(await rows(s.activities)).toBe(4);
    expect((await call('POST', '/api/activities', activity(4))).status).toBe(201);
    expect((await call('POST', '/api/activities', activity(5))).status).toBe(409);
    expect((await upload(PDF.subarray(0, 100), 'b.pdf')).status).toBe(409);
    expect(await rows(s.activities)).toBe(5);
  });
  it('uploads: size and file count; linking to an existing activity does not need activity room', async () => {
    const big = await upload(new Uint8Array(LIMITS.evidenceBytes + 1), 'big.png');
    expect(big.status).toBe(413);
    expect(big.json.error).toMatch(/limited to/);
    const a = await call('POST', '/api/activities', activity(0));
    expect((await upload(PNG, 'one.png', a.json.id)).status).toBe(201);
    expect((await upload(PDF, 'two.pdf', a.json.id)).status).toBe(201);
    const third = await upload(new Uint8Array([1, 2, 3]), 'three.png', a.json.id);
    expect(third.status).toBe(409);
    expect(third.json.error).toMatch(/uploaded files/);
    expect(await rows(s.evidence)).toBe(2);
  });
  it('exports', async () => {
    const ids = await certIds();
    const held = await call('POST', '/api/held', {
      certificationId: ids.find((i) => i === 'isc2/cissp'),
      earnedOn: '2025-01-01',
    });
    const cycleId = held.json.cycles[0].id;
    expect((await call('POST', '/api/exports', { cycleId })).status).toBe(202);
    expect((await call('POST', '/api/exports', { cycleId })).status).toBe(409);
  });
  it('reports usage and the next reset', async () => {
    await call('POST', '/api/activities', activity(0));
    const d = await call('GET', '/api/demo');
    expect(d.json.used.activities).toBe(1);
    expect(d.json.limits).toEqual(LIMITS);
    expect(d.json.nextResetAt).toBe('2026-09-18T00:00:00.000Z');
    expect(d.json.resetEveryHours).toBe(12);
  });
});

describe('12-hour reset', () => {
  it('empties everything a visitor can create and keeps the catalog', async () => {
    const catalogBefore = await rows(s.certifications);
    const rulesBefore = await rows(s.creditingRules);
    const held = await call('POST', '/api/held', {
      certificationId: 'isc2/cissp',
      earnedOn: '2025-01-01',
    });
    await call('POST', '/api/memberships', { bodyId: 'isc2' });
    const a = await call('POST', '/api/activities', activity(0));
    const fan = await call('GET', `/api/activities/${a.json.id}/fanout`);
    await call('POST', `/api/activities/${a.json.id}/applications`, {
      applications: fan.json.suggestions
        .filter((x: any) => x.kind === 'credit')
        .map((x: any) => ({
          heldCertId: x.heldCertId,
          creditsX100: x.creditsX100,
          categoryKey: x.categoryKey,
        })),
    });
    await upload(PNG, 'tiny.png', a.json.id);
    await call('POST', '/api/exports', { cycleId: held.json.cycles[0].id });
    expect(await rows(s.creditApplications)).toBeGreaterThan(0);

    await resetDemo(ctx);

    for (const t of [
      s.heldCertifications,
      s.cycles,
      s.memberships,
      s.activities,
      s.creditApplications,
      s.evidence,
      s.activityEvidence,
      s.payments,
      s.exports_,
      s.jobs,
      s.notifications,
      s.settings,
    ])
      expect(await rows(t)).toBe(0);
    let objects = 0;
    for (const prefix of ['evidence/', 'exports/'])
      for await (const _ of ctx.objectStore.list(prefix)) objects++;
    expect(objects).toBe(0);
    expect(await rows(s.certifications)).toBe(catalogBefore);
    expect(await rows(s.creditingRules)).toBe(rulesBefore);
    // Usable straight away.
    expect(
      (await call('POST', '/api/held', { certificationId: 'isc2/cissp', earnedOn: '2025-01-01' }))
        .status,
    ).toBe(201);
  });
  it('runs at 00:00 and 12:00 UTC', () => {
    expect(nextResetAt(new Date('2026-09-17T00:00:00Z')).toISOString()).toBe(
      '2026-09-17T12:00:00.000Z',
    );
    expect(nextResetAt(new Date('2026-09-17T11:59:59Z')).toISOString()).toBe(
      '2026-09-17T12:00:00.000Z',
    );
    expect(nextResetAt(new Date('2026-09-17T12:00:00Z')).toISOString()).toBe(
      '2026-09-18T00:00:00.000Z',
    );
    expect(nextResetAt(new Date('2026-12-31T23:10:00Z')).toISOString()).toBe(
      '2027-01-01T00:00:00.000Z',
    );
  });
  it('ships the limits the owner asked for', () => {
    expect(DEMO_LIMITS.heldCertifications).toBe(10);
    expect(DEMO_LIMITS.activities).toBe(100);
  });
});
