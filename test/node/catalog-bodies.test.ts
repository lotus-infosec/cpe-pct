import { beforeAll, describe, expect, it } from 'vitest';
import type { createApp } from '../../src/app';
import { testApp } from './app';

// The seeded catalog against the issuers' own worked examples and headline rules.
const clock = { now: () => new Date('2026-09-12T12:00:00Z') };
let app: ReturnType<typeof createApp>;
let cookie = '';
const call = async (method: string, path: string, body?: unknown) => {
  const res = await app.request(path, {
    method,
    headers: { 'content-type': 'application/json', cookie },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });
  return { status: res.status, json: (await res.json()) as any };
};
const hold = async (certificationId: string, earnedOn = '2025-01-15') =>
  (await call('POST', '/api/held', { certificationId, earnedOn })).json.id as string;
const fanout = async (activity: Record<string, unknown>) => {
  const a = await call('POST', '/api/activities', {
    title: 't',
    occurredOn: '2026-06-01',
    ...activity,
  });
  return (await call('GET', `/api/activities/${a.json.id}/fanout`)).json.suggestions as any[];
};

beforeAll(async () => {
  app = (await testApp(clock)).app;
  const r = await app.request('/api/setup', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password: 'correct horse battery staple' }),
  });
  cookie = r.headers.get('set-cookie')!.split(';')[0]!;
});

describe('catalog: every body is present with a current version', () => {
  it('lists all twelve bodies', async () => {
    const bodies = (await call('GET', '/api/catalog')).json.bodies as any[];
    expect(bodies.map((b) => b.id).sort()).toEqual([
      'aws',
      'cisco',
      'comptia',
      'ec-council',
      'giac',
      'iapp',
      'imi',
      'isaca',
      'isc2',
      'microsoft',
      'pmi',
      'testout',
    ]);
    for (const b of bodies) expect(b.currentVersion, b.id).not.toBeNull();
  });
});

describe('ISACA (contrasting 50-minute body)', () => {
  it("reproduces the policy's sample calculation: 390 minutes → 7.75 CPE (nearest quarter)", async () => {
    const h = await hold('isaca/cisa');
    const s = (await fanout({ activityType: 'attend_conference', durationMinutes: 390 })).find(
      (x) => x.heldCertId === h,
    );
    expect(s).toMatchObject({ creditsX100: 775, categoryKey: 'A' });
  });
  it('mentoring is capped at 10 per year and lands in category B; presenting earns 5× delivery time', async () => {
    const h = (await call('GET', '/api/held')).json.find(
      (x: any) => x.certificationId === 'isaca/cisa',
    ).id;
    const m = (await fanout({ activityType: 'mentor', durationMinutes: 720 })).find(
      (x) => x.heldCertId === h,
    );
    expect(m).toMatchObject({
      creditsX100: 1000,
      categoryKey: 'B',
      warnings: expect.arrayContaining(['clamped_annual_cap']),
    });
    const p = (await fanout({ activityType: 'deliver_presentation', durationMinutes: 120 })).find(
      (x) => x.heldCertId === h,
    );
    expect(p.creditsX100).toBe(1000);
  });
  it('standing has a HARD annual minimum of 20 and category rules 90 A / 30 B', async () => {
    const held = (await call('GET', '/api/held')).json.find(
      (x: any) => x.certificationId === 'isaca/cisa',
    );
    const st = (await call('GET', `/api/cycles/${held.cycles[0].id}/standing`)).json;
    expect(st.constraints.find((c: any) => c.type === 'annual_min')).toMatchObject({
      severity: 'hard',
      required: 2000,
    });
    expect(st.constraints.find((c: any) => c.type === 'category_min')).toMatchObject({
      category: 'A',
      required: 9000,
    });
    expect(st.constraints.find((c: any) => c.type === 'category_max')).toMatchObject({
      category: 'B',
      required: 3000,
    });
    expect(st.constraints.find((c: any) => c.type === 'fee_paid')).toMatchObject({
      scope: expect.stringMatching(/^cycle:/),
    });
  });
});

describe('PMI (nested categories) and GIAC / AWS (exam alternatives)', () => {
  it('PMP: education suggestions land in the parent category; sub-minimums are tracked via parent_key', async () => {
    const h = await hold('pmi/pmp');
    const s = (await fanout({ activityType: 'attend_training', durationMinutes: 100 })).find(
      (x) => x.heldCertId === h,
    );
    expect(s).toMatchObject({ creditsX100: 150, categoryKey: 'education' }); // 1.67 → floor_quarter 1.5
    const held = (await call('GET', '/api/held')).json.find(
      (x: any) => x.certificationId === 'pmi/pmp',
    );
    const st = (await call('GET', `/api/cycles/${held.cycles[0].id}/standing`)).json;
    expect(
      st.constraints
        .filter((c: any) => c.type === 'category_min')
        .map((c: any) => [c.category, c.required]),
    ).toEqual(
      expect.arrayContaining([
        ['education', 3500],
        ['wow', 800],
        ['ps', 800],
        ['ba', 800],
      ]),
    );
    expect(
      st.constraints
        .filter((c: any) => c.type === 'category_max')
        .map((c: any) => [c.category, c.required]),
    ).toEqual(
      expect.arrayContaining([
        ['giving_back', 2500],
        ['practitioner', 800],
      ]),
    );
  });
  it('GIAC: 48-month cycle, any_of(36 CPEs, retake); no automatic suggestions', async () => {
    const h = await hold('giac/gcih');
    const held = (await call('GET', '/api/held')).json.find((x: any) => x.id === h);
    expect(held.cycles[0]).toMatchObject({ startsOn: '2025-01-15', endsOn: '2029-01-15' });
    expect(
      (await fanout({ activityType: 'attend_training', durationMinutes: 600 })).some(
        (x) => x.heldCertId === h,
      ),
    ).toBe(false);
    const st = (await call('GET', `/api/cycles/${held.cycles[0].id}/standing`)).json;
    const any = st.constraints.find((c: any) => c.type === 'any_of');
    expect(any.of.map((c: any) => c.type)).toEqual(['cycle_total', 'recert_exam']);
    expect(st.constraints.find((c: any) => c.type === 'fee_paid')).toMatchObject({
      satisfied: false,
      period: '2025-01-15..2029-01-15',
    });
  });
  it('AWS: exam-only, and earning SA Professional proposes renewing SA Associate', async () => {
    const assoc = await hold('aws/solutions-architect-associate');
    const s = (
      await fanout({
        activityType: 'earn_certification',
        relatedCertificationId: 'aws/solutions-architect-professional',
      })
    ).find((x) => x.heldCertId === assoc);
    expect(s).toMatchObject({ kind: 'renewal' });
  });
  it('TestOut: lifetime, no cycle; Microsoft Fundamentals: no cycle; AZ-104: 12-month cycle', async () => {
    const t = (
      await call('POST', '/api/held', {
        certificationId: 'testout/security-pro',
        earnedOn: '2022-01-01',
      })
    ).json;
    expect(t.cycles).toEqual([]);
    const f = (
      await call('POST', '/api/held', {
        certificationId: 'microsoft/az-900',
        earnedOn: '2024-01-01',
      })
    ).json;
    expect(f.cycles).toEqual([]);
    const a = (
      await call('POST', '/api/held', {
        certificationId: 'microsoft/az-104',
        earnedOn: '2026-03-01',
      })
    ).json;
    expect(a.cycles[0]).toMatchObject({ endsOn: '2027-03-01' });
  });
});
