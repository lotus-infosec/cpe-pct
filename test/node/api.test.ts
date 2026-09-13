import { beforeAll, describe, expect, it } from 'vitest';
import type { createApp } from '../../src/app';
import type { Clock } from '../../src/ports';
import { testApp } from './app';

// Fixed clock so cycle arithmetic is deterministic. Synthetic cert numbers only.
const clock: Clock = { now: () => new Date('2026-09-11T12:00:00Z') };
const PASSWORD = 'correct horse battery staple';
let app: ReturnType<typeof createApp>;
let cookie = '';

const call = async (
  method: string,
  path: string,
  body?: unknown,
  extra: Record<string, string> = {},
) => {
  const res = await app.request(path, {
    method,
    headers: { 'content-type': 'application/json', cookie, ...extra },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* not json */
  }
  return {
    status: res.status,
    json: json as Record<string, unknown> & Record<string, any>,
    headers: res.headers,
  };
};

beforeAll(async () => {
  app = (await testApp(clock)).app;
});

describe('setup and auth', () => {
  it('starts un-set-up and refuses protected routes', async () => {
    expect((await call('GET', '/api/setup')).json).toEqual({ setUp: false });
    expect((await call('GET', '/api/held')).status).toBe(401);
  });
  it('setup creates the owner, sets a cookie, and cannot run twice', async () => {
    const r = await call('POST', '/api/setup', { password: PASSWORD });
    expect(r.status).toBe(201);
    cookie = r.headers.get('set-cookie')!.split(';')[0]!;
    expect(cookie).toMatch(/^cpe_session=/);
    expect((await call('POST', '/api/setup', { password: PASSWORD })).status).toBe(409);
  });
  it('rejects wrong password, accepts right one, logout clears', async () => {
    expect((await call('POST', '/api/login', { password: 'wrong password 12345' })).status).toBe(
      401,
    );
    expect((await call('GET', '/api/me')).json).toMatchObject({ id: 'owner', via: 'local' });
    const saved = cookie;
    await call('POST', '/api/logout');
    expect((await call('GET', '/api/me')).status).toBe(401);
    cookie = saved;
    const r = await call('POST', '/api/login', { password: PASSWORD });
    cookie = r.headers.get('set-cookie')!.split(';')[0]!;
    expect((await call('GET', '/api/me')).status).toBe(200);
  });
  it('rejects cross-origin mutations', async () => {
    expect(
      (await call('POST', '/api/activities', {}, { origin: 'https://evil.example' })).status,
    ).toBe(403);
  });
});

const heldIds: Record<string, string> = {};
const cycleIds: Record<string, string> = {};

describe('catalog and held certifications', () => {
  it('serves the seeded catalog with current versions', async () => {
    const r = await call('GET', '/api/catalog');
    const bodies = r.json['bodies'] as any[];
    const isc2 = bodies.find((b) => b.id === 'isc2');
    expect(isc2.currentVersion.id).toBe('isc2@1');
    const cissp = isc2.certifications.find((x: any) => x.id === 'isc2/cissp');
    expect(cissp.requirement).toMatchObject({
      cycleMonths: 36,
      totalCreditsX100: 12000,
      annualMinSeverity: 'soft',
    });
  });
  it('adding a held cert auto-creates its first cycle pinned to the current version', async () => {
    for (const [key, certificationId, earnedOn] of [
      ['cissp', 'isc2/cissp', '2025-05-01'],
      ['cc', 'isc2/cc', '2025-05-01'],
      ['secplus', 'comptia/security-plus', '2025-01-15'],
      ['cysa', 'comptia/cysa-plus', '2025-01-15'],
    ] as const) {
      const r = await call('POST', '/api/held', {
        certificationId,
        earnedOn,
        certNumber: `TEST-${key}-0000`,
      });
      expect(r.status).toBe(201);
      heldIds[key] = r.json['id'] as string;
      const cy = (r.json['cycles'] as any[])[0];
      cycleIds[key] = cy.id;
      expect(cy).toMatchObject({ startsOn: earnedOn, status: 'open', sequence: 1 });
    }
    const cissp = (await call('GET', '/api/held')).json as unknown as any[];
    expect(cissp.find((h) => h.id === heldIds['cissp']).cycles[0]).toMatchObject({
      endsOn: '2028-05-01',
      ruleVersionId: 'isc2@1',
    });
  });
  it('memberships', async () => {
    const r = await call('POST', '/api/memberships', {
      bodyId: 'isc2',
      memberNumber: 'TEST-000000',
      since: '2025-05-01',
    });
    expect(r.status).toBe(201);
    heldIds['isc2-membership'] = r.json['id'] as string;
  });
});

describe('activity → fan-out → applications → standing', () => {
  let activityId = '';
  it('creates a draft activity', async () => {
    const r = await call('POST', '/api/activities', {
      title: 'BSides talk',
      occurredOn: '2026-06-10',
      activityType: 'attend_conference',
      durationMinutes: 200,
      provider: 'BSides',
    });
    expect(r.status).toBe(201);
    activityId = r.json['id'] as string;
  });
  it('fans out with real ISC2 and CompTIA rules', async () => {
    const r = await call('GET', `/api/activities/${activityId}/fanout`);
    const by = (k: string) =>
      (r.json['suggestions'] as any[]).find((x) => x.heldCertId === heldIds[k]);
    expect(by('cissp')).toMatchObject({ creditsX100: 325, categoryKey: 'A' }); // 200/60 floor_quarter
    expect(by('cc')).toMatchObject({ creditsX100: 325, categoryKey: 'A' });
    expect(by('cysa')).toMatchObject({ creditsX100: 333, coveredBy: null }); // exact, cap 15 untouched
    expect(by('secplus')).toMatchObject({ creditsX100: 333, coveredBy: heldIds['cysa'] }); // covered by CySA+
    expect(by('cissp').explain.join(' ')).toContain('floor_quarter');
  });
  it('rejects a changed value without an override reason, accepts with one', async () => {
    const bad = await call('POST', `/api/activities/${activityId}/applications`, {
      applications: [{ heldCertId: heldIds['cissp'], creditsX100: 400 }],
    });
    expect(bad.status).toBe(400);
    const ok = await call('POST', `/api/activities/${activityId}/applications`, {
      applications: [
        { heldCertId: heldIds['cissp'], creditsX100: 325 },
        { heldCertId: heldIds['cc'], creditsX100: 325 },
        {
          heldCertId: heldIds['cysa'],
          creditsX100: 300,
          overrideReason: 'portal accepts whole hours only',
        },
      ],
    });
    expect(ok.status).toBe(201);
    expect((ok.json['applications'] as any[]).map((a) => a.status)).toEqual([
      'claimed',
      'claimed',
      'claimed',
    ]);
    expect((ok.json['applications'] as any[])[2]).toMatchObject({
      suggestedCreditsX100: 333,
      overrideReason: 'portal accepts whole hours only',
    });
    expect((ok.json['standings'] as any[]).length).toBe(3);
    expect((await call('GET', `/api/activities/${activityId}`)).json['status']).toBe('logged');
  });
  it('rejects the same held cert twice in one payload', async () => {
    // (activity, held cert) is unique; without the check the duplicate reached the batch and came
    // back as a 500 SQLITE_CONSTRAINT instead of a validation error. Found by stress-seeding.
    const r = await call('POST', `/api/activities/${activityId}/applications`, {
      applications: [
        { heldCertId: heldIds['cissp'], creditsX100: 325 },
        { heldCertId: heldIds['cissp'], creditsX100: 325 },
      ],
    });
    expect(r.status).toBe(400);
    expect(r.json['error']).toBe('invalid_applications');
    expect((r.json['details'] as string[]).join(' ')).toContain('listed more than once');
  });

  it('`other` yields no suggestions and requires an override reason', async () => {
    const a = await call('POST', '/api/activities', {
      title: 'Something odd',
      occurredOn: '2026-06-11',
      activityType: 'other',
      durationMinutes: 120,
    });
    const f = await call('GET', `/api/activities/${a.json['id']}/fanout`);
    expect(f.json['suggestions']).toEqual([]);
    expect((f.json['heldWithoutSuggestion'] as any[]).length).toBe(4);
    expect(
      (
        await call('POST', `/api/activities/${a.json['id']}/applications`, {
          applications: [{ heldCertId: heldIds['cissp'], creditsX100: 200 }],
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await call('POST', `/api/activities/${a.json['id']}/applications`, {
          applications: [
            {
              heldCertId: heldIds['cissp'],
              creditsX100: 200,
              categoryKey: 'B',
              overrideReason: 'accepted by ISC2 as Group B',
            },
          ],
        })
      ).status,
    ).toBe(201);
  });
  it('CISSP standing: fee lapsed → non-compliant with fee_paid failing first', async () => {
    const r = await call('GET', `/api/cycles/${cycleIds['cissp']}/standing`);
    expect(r.json['compliant']).toBe(false);
    expect((r.json['constraints'] as any[])[0]).toMatchObject({
      type: 'fee_paid',
      satisfied: false,
      overdue: true,
      scope: 'membership:isc2',
    });
    expect(r.json['totals']).toMatchObject({ claimed: 525 });
  });
  it('paying the AMF for both elapsed periods makes it compliant', async () => {
    for (const [start, end] of [
      ['2025-05-01', '2026-05-01'],
      ['2026-05-01', '2027-05-01'],
    ]) {
      const p = await call('POST', '/api/payments', {
        targetType: 'membership',
        targetId: heldIds['isc2-membership'],
        periodStart: start,
        periodEnd: end,
        dueOn: start,
        amountCents: 13500,
        status: 'paid',
        paidOn: start,
      });
      expect(p.status).toBe(201);
    }
    const r = await call('GET', `/api/cycles/${cycleIds['cissp']}/standing`);
    expect(r.json['compliant']).toBe(true);
    expect((r.json['constraints'] as any[]).find((x) => x.type === 'annual_min')).toMatchObject({
      severity: 'soft',
      satisfied: false,
    });
  });
  it('CompTIA standing uses a per-cycle fee at certification scope', async () => {
    const r = await call('GET', `/api/cycles/${cycleIds['cysa']}/standing`);
    const fee = (r.json['constraints'] as any[]).find((x) => x.type === 'fee_paid');
    expect(fee).toMatchObject({
      scope: `cycle:${cycleIds['cysa']}`,
      satisfied: false,
      overdue: true,
    });
  });
  it('application status transitions are enforced', async () => {
    const apps = (await call('GET', `/api/applications?cycleId=${cycleIds['cissp']}`))
      .json as unknown as any[];
    const id = apps[0].id;
    expect((await call('PATCH', `/api/applications/${id}`, { status: 'rejected' })).status).toBe(
      409,
    );
    expect((await call('PATCH', `/api/applications/${id}`, { status: 'submitted' })).status).toBe(
      200,
    );
    expect(
      (
        await call('PATCH', `/api/applications/${id}`, {
          status: 'accepted',
          issuerReference: 'CPE-TEST-1',
        })
      ).status,
    ).toBe(200);
    const st = await call('GET', `/api/cycles/${cycleIds['cissp']}/standing`);
    expect(st.json['totals']).toMatchObject({ accepted: apps[0].creditsX100 });
  });
});

describe('CSV import', () => {
  it('imports accepted history into the right cycles', async () => {
    const csv = [
      'certification,occurred_on,title,activity_type,minutes,credits,category,status,issuer_reference',
      'isc2/cissp,2025-08-01,"Course, with comma",attend_training,600,10,A,accepted,ISC2-REF-1',
      'comptia/security-plus,2025-03-01,Webinar,attend_webinar,60,1,,accepted,',
    ].join('\n');
    const r = await call('POST', '/api/import', { filename: 'history.csv', csv });
    expect(r.status).toBe(201);
    expect(r.json['rows']).toBe(2);
    const st = await call('GET', `/api/cycles/${cycleIds['cissp']}/standing`);
    expect((st.json['totals'] as any).accepted).toBeGreaterThanOrEqual(1000);
    const bad = await call('POST', '/api/import', {
      filename: 'x.csv',
      csv: 'certification,occurred_on,title,credits\nisc2/cissp,2010-01-01,Old,5',
    });
    expect(bad.status).toBe(400);
    expect((bad.json['errors'] as any[])[0].error).toMatch(/no cycle/);
  });
});

describe('dashboard and renewal', () => {
  it('summarises every held cert', async () => {
    const r = await call('GET', '/api/dashboard');
    const items = r.json['items'] as any[];
    expect(items.length).toBe(4);
    expect(items.find((x) => x.held.id === heldIds['cissp']).standing).toMatchObject({
      compliant: true,
    });
  });
  it('renewal closes the cycle and opens the next one contiguously', async () => {
    const r = await call('POST', `/api/cycles/${cycleIds['secplus']}/renew`, {
      renewedOn: '2026-09-01',
      issuerConfirmation: 'TEST-RENEW',
    });
    expect(r.status).toBe(201);
    expect(r.json['opened']).toMatchObject({
      sequence: 2,
      startsOn: '2028-01-15',
      endsOn: '2031-01-15',
      ruleVersionId: 'comptia@1',
    });
    expect(
      (await call('POST', `/api/cycles/${cycleIds['secplus']}/renew`, { renewedOn: '2026-09-01' }))
        .status,
    ).toBe(409);
  });
});
