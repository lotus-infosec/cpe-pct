// STAGE7 list contract: paging, filters, sort stability, and query safety. Synthetic data only.
import { beforeAll, describe, expect, it } from 'vitest';
import * as s from '../../src/db/schema';
import type { AppContext } from '../../src/app/context';
import type { Clock } from '../../src/ports';
import { cleanQ, escapeLike } from '../../src/app/query';
import {
  expiryBucket,
  matchesExpiry,
  progressBucket,
  standingBucket,
} from '../../src/app/held-list';
import { testApp } from './app';

const clock: Clock = { now: () => new Date('2026-09-11T12:00:00Z') };
let app: Awaited<ReturnType<typeof testApp>>['app'];
let ctx: AppContext;
let cookie = '';
const heldIds: Record<string, string> = {};
const cycleIds: Record<string, string> = {};

const get = async (path: string) => {
  const res = await app.request(path, { headers: { cookie } });
  return { status: res.status, json: (await res.json()) as any };
};
const ids = (r: { json: { rows: { id: string }[] } }) => r.json.rows.map((x) => x.id);

beforeAll(async () => {
  ({ app, ctx } = await testApp(clock));
  const setup = await app.request('/api/setup', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password: 'correct horse battery staple' }),
  });
  cookie = setup.headers.get('set-cookie')!.split(';')[0]!;
  for (const [key, certificationId, earnedOn] of [
    ['cissp', 'isc2/cissp', '2025-05-01'],
    ['secplus', 'comptia/security-plus', '2023-10-01'],
    ['cc', 'isc2/cc', '2025-05-01'],
  ] as const) {
    const res = await app.request('/api/held', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie, origin: 'http://localhost' },
      body: JSON.stringify({ certificationId, earnedOn, certNumber: `TEST-${key}-0000` }),
    });
    const body = (await res.json()) as any;
    heldIds[key] = body.id;
    cycleIds[key] = body.cycles[0].id;
  }

  // 40 activities. Ten share one date so the sort must break ties; titles carry the characters a
  // careless LIKE would misread.
  const special = [
    '100% effort',
    '100 things',
    'a_b notes',
    'axb notes',
    "O'Reilly live",
    'Cloud Security Summit',
  ];
  const acts = Array.from({ length: 40 }, (_, i) => ({
    id: `act-${String(i).padStart(2, '0')}`,
    title: special[i] ?? `Training ${i}`,
    occurredOn:
      i < 10 ? '2026-03-01' : `2026-0${1 + (i % 8)}-${String(10 + (i % 18)).padStart(2, '0')}`,
    provider: i % 5 === 0 ? 'Synthetic Provider' : null,
    activityType: i % 2 === 0 ? 'attend_webinar' : 'read_book',
    source: 'manual' as const,
    status: (i % 3 === 0 ? 'draft' : 'logged') as 'draft' | 'logged',
    createdAt: `2026-09-01T00:00:${String(i).padStart(2, '0')}Z`,
  }));
  await ctx.db.insert(s.activities).values(acts);
  // Applications on CISSP for 12 activities, varying status and credits.
  const statuses = ['claimed', 'submitted', 'accepted', 'rejected'] as const;
  await ctx.db.insert(s.creditApplications).values(
    acts.slice(10, 22).map((a, i) => ({
      id: `app-${i}`,
      activityId: a.id,
      heldCertId: heldIds['cissp']!,
      cycleId: cycleIds['cissp']!,
      creditsX100: 100 * (i + 1),
      status: statuses[i % 4]!,
      ruleVersionId: 'isc2@1',
    })),
  );
  await ctx.db.insert(s.evidence).values(
    ['cert-100%.pdf', 'receipt.png', 'transcript_2026.pdf'].map((filename, i) => ({
      id: `ev-${i}`,
      objectKey: `evidence/test-${i}`,
      sha256: `${i}`.repeat(64),
      filename,
      contentType: filename.endsWith('.png') ? 'image/png' : 'application/pdf',
      sizeBytes: 1000 * (i + 1),
      extractedText: 'SYNTHETIC TEXT THAT MUST NOT BE LISTED',
      extractionStatus: i === 1 ? ('manual' as const) : ('done' as const),
      uploadedAt: `2026-09-0${i + 1}T00:00:00Z`,
    })),
  );
});

describe('query helpers', () => {
  it('escapes LIKE wildcards and the escape character', () => {
    expect(escapeLike('100%')).toBe('100\\%');
    expect(escapeLike('a_b')).toBe('a\\_b');
    expect(escapeLike('c:\\temp')).toBe('c:\\\\temp');
  });
  it('turns control characters into spaces and trims', () => {
    expect(cleanQ('  cloud\nsecurity\t\u0000 ')).toBe('cloud security');
  });
});

describe('query safety (every term is rejected or matched literally, never a 500)', () => {
  it('a % in the term matches a literal percent', async () => {
    const r = await get('/api/activities?q=100%25');
    expect(r.json.rows.map((x: any) => x.title)).toEqual(['100% effort']);
  });
  it('an _ in the term matches a literal underscore', async () => {
    const r = await get('/api/activities?q=a_b');
    expect(r.json.rows.map((x: any) => x.title)).toEqual(['a_b notes']);
  });
  it('a quote is data, not syntax', async () => {
    const r = await get(`/api/activities?q=${encodeURIComponent("O'Reilly")}`);
    expect(r.status).toBe(200);
    expect(r.json.total).toBe(1);
  });
  it('a newline in the term is folded to a space', async () => {
    const r = await get(`/api/activities?q=${encodeURIComponent('cloud\nsecurity')}`);
    expect(r.json.rows.map((x: any) => x.title)).toEqual(['Cloud Security Summit']);
  });
  it.each([
    ['a 5,000-character term', `q=${'x'.repeat(5000)}`],
    ['a 101-character term', `q=${'x'.repeat(101)}`],
    ['a sort outside the whitelist', 'sort=title;DROP TABLE activities'],
    ['a column name that is not a sort', 'sort=description'],
    ['per_page=99999', 'per_page=99999'],
    ['per_page=30', 'per_page=30'],
    ['page=0', 'page=0'],
    ['page=-1', 'page=-1'],
    ['page=1.5', 'page=1.5'],
    ['page past the cap', 'page=10001'],
    ['a repeated term', 'q=a&q=b'],
    ['a bad direction', 'dir=sideways'],
    ['an unknown activity type', 'type=hacking'],
    ['a malformed date', 'from=2026-1-1'],
  ])('%s is a 400 naming the problem', async (_label, qs) => {
    const r = await get(`/api/activities?${qs}`);
    expect(r.status).toBe(400);
    expect(r.json.error).toBe('invalid_query');
    expect(r.json.details.length).toBeGreaterThan(0);
  });
  it.each(['/api/applications', '/api/evidence', '/api/held', '/api/dashboard'])(
    '%s validates the same shared parameters',
    async (path) => {
      for (const qs of ['per_page=99999', 'page=0', 'sort=id', `q=${'x'.repeat(5000)}`])
        expect((await get(`${path}?${qs}`)).status).toBe(400);
    },
  );
  it('unknown parameters are ignored', async () => {
    expect((await get('/api/activities?foo=bar')).status).toBe(200);
  });
});

describe('activities', () => {
  it('pages with a real total and an empty page past the end', async () => {
    const p1 = await get('/api/activities?per_page=25');
    expect(p1.json).toMatchObject({ page: 1, perPage: 25, total: 40, pages: 2 });
    expect(p1.json.rows).toHaveLength(25);
    expect((await get('/api/activities?per_page=25&page=2')).json.rows).toHaveLength(15);
    const past = await get('/api/activities?per_page=25&page=9');
    expect(past.status).toBe(200);
    expect(past.json).toMatchObject({ rows: [], total: 40, pages: 2 });
  });
  it('never returns more than 100 rows', async () => {
    expect((await get('/api/activities?per_page=100')).json.rows.length).toBeLessThanOrEqual(100);
    expect((await get('/api/activities')).json.perPage).toBe(25);
  });
  it('counts the filtered set, not the table', async () => {
    const r = await get('/api/activities?type=read_book&status=logged&per_page=10');
    const all = (await get('/api/activities?per_page=100')).json.rows as any[];
    const expected = all.filter((a) => a.activityType === 'read_book' && a.status === 'logged');
    expect(r.json.total).toBe(expected.length);
    expect(r.json.pages).toBe(Math.ceil(expected.length / 10));
  });
  it('filters an inclusive date range', async () => {
    const r = await get('/api/activities?from=2026-03-01&to=2026-03-01&per_page=100');
    expect(r.json.rows.every((a: any) => a.occurredOn === '2026-03-01')).toBe(true);
    expect(r.json.total).toBeGreaterThanOrEqual(10);
  });
  it('searches provider and description as well as title', async () => {
    expect((await get('/api/activities?q=synthetic%20provider')).json.total).toBe(8);
  });
  it.each(['occurredOn', 'title', 'createdAt', 'credits'])(
    'sorting by %s never repeats or drops a row across pages',
    async (sort) => {
      for (const dir of ['asc', 'desc']) {
        const seen: string[] = [];
        for (let page = 1; page <= 4; page++)
          seen.push(
            ...ids(await get(`/api/activities?sort=${sort}&dir=${dir}&per_page=10&page=${page}`)),
          );
        expect(seen).toHaveLength(40);
        expect(new Set(seen).size).toBe(40);
      }
    },
  );
  it('sorts by credit total and returns each row with its applications', async () => {
    const r = await get('/api/activities?sort=credits&dir=desc&per_page=10');
    const totals = r.json.rows.map((a: any) => a.creditTotalX100);
    expect(totals).toEqual([...totals].sort((a, b) => b - a));
    expect(totals[0]).toBe(1200);
    expect(Object.values(r.json.rows[0].appliedTo)).toEqual([1200]);
    expect(r.json.rows[0].applications).toBeUndefined();
  });
});

describe('credit applications', () => {
  it('filters by cycle and status and carries the activity title', async () => {
    const r = await get(`/api/applications?cycleId=${cycleIds['cissp']}&status=accepted`);
    expect(r.json.total).toBe(3);
    expect(r.json.rows.every((x: any) => x.status === 'accepted' && x.activity.title)).toBe(true);
  });
  it('filters by body and held certification', async () => {
    expect((await get('/api/applications?bodyId=isc2')).json.total).toBe(12);
    expect((await get('/api/applications?bodyId=comptia')).json.total).toBe(0);
    expect((await get(`/api/applications?heldCertId=${heldIds['secplus']}`)).json.total).toBe(0);
  });
  it('searches the activity title', async () => {
    expect((await get('/api/applications?q=Training%2012')).json.total).toBe(1);
  });
  it('sorts status in lifecycle order and pages stably', async () => {
    const r = await get('/api/applications?sort=status&dir=asc&per_page=100');
    const order = ['planned', 'claimed', 'submitted', 'accepted', 'rejected'];
    const ranks = r.json.rows.map((x: any) => order.indexOf(x.status));
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    const seen = [
      ...ids(await get('/api/applications?sort=status&per_page=10&page=1')),
      ...ids(await get('/api/applications?sort=status&per_page=10&page=2')),
    ];
    expect(new Set(seen).size).toBe(12);
  });
});

describe('evidence', () => {
  it('searches the filename literally and never lists extracted text', async () => {
    const r = await get('/api/evidence?q=100%25');
    expect(r.json.rows.map((x: any) => x.filename)).toEqual(['cert-100%.pdf']);
    expect(JSON.stringify(r.json)).not.toContain('SYNTHETIC TEXT');
    expect((await get('/api/evidence?q=_2026')).json.total).toBe(1);
  });
  it('filters by extraction status and sorts by size', async () => {
    expect((await get('/api/evidence?status=manual')).json.total).toBe(1);
    const r = await get('/api/evidence?sort=size&dir=asc');
    expect(r.json.rows.map((x: any) => x.sizeBytes)).toEqual([1000, 2000, 3000]);
  });
});

describe('held certifications and dashboard', () => {
  it('finds "cissp" by search on both routes', async () => {
    for (const path of ['/api/held', '/api/dashboard']) {
      const r = await get(`${path}?q=cissp`);
      expect(r.json.total).toBe(1);
    }
    expect((await get('/api/held?q=TEST-secplus')).json.total).toBe(1);
    expect((await get('/api/held?q=comptia')).json.total).toBe(1);
  });
  it('filters by body and pages in memory', async () => {
    expect((await get('/api/held?bodyId=isc2')).json.total).toBe(2);
    const p2 = await get('/api/held?per_page=10&page=2');
    expect(p2.json).toMatchObject({ rows: [], total: 3, pages: 1 });
  });
  it('derives standing buckets and filters on them', async () => {
    const d = await get('/api/dashboard');
    const counts = d.json.counts;
    expect(Object.values(counts).reduce((a: number, b) => a + (b as number), 0)).toBe(3);
    for (const bucket of Object.keys(counts)) {
      const r = await get(`/api/dashboard?standing=${bucket}`);
      expect(r.json.total).toBe(counts[bucket]);
    }
  });
  it('filters days to expiry cumulatively', async () => {
    // Security+ earned 2023-10-01 on a 36-month cycle ends 2026-10-01: 20 days after the clock.
    for (const expiry of ['30', '90', '365'])
      expect(
        (await get(`/api/held?expiry=${expiry}`)).json.rows.map((x: any) => x.certificationId),
      ).toContain('comptia/security-plus');
    expect((await get('/api/held?expiry=overdue')).json.total).toBe(0);
  });
  it('sorts by expiry and severity with every row exactly once', async () => {
    const r = await get('/api/held?sort=expiry&dir=asc');
    const days = r.json.rows.map((x: any) => x.derived.daysToExpiry);
    expect(days).toEqual([...days].sort((a, b) => a - b));
    const sev = await get('/api/dashboard?sort=severity&dir=desc&per_page=10');
    expect(new Set(ids({ json: { rows: sev.json.rows.map((x: any) => x.held) } })).size).toBe(3);
  });
  it('view=basic skips standing unless the query needs it', async () => {
    expect((await get('/api/held?view=basic')).json.rows[0].derived.standing).toBeNull();
    expect(
      (await get('/api/held?view=basic&sort=severity')).json.rows[0].derived.standing,
    ).not.toBeNull();
    expect((await get('/api/held')).json.rows[0].derived.standing).not.toBeNull();
  });
});

describe('bucket definitions', () => {
  it('expiry', () => {
    expect([null, -1, 0, 30, 31, 90, 180, 365, 366].map(expiryBucket)).toEqual([
      'none',
      'overdue',
      '30',
      '30',
      '90',
      '90',
      '180',
      '365',
      'beyond',
    ]);
    expect(matchesExpiry(10, '90')).toBe(true);
    expect(matchesExpiry(-3, '90')).toBe(false);
    expect(matchesExpiry(null, 'none')).toBe(true);
  });
  it('progress', () => {
    expect([0, 49, 50, 99, 100, 101].map((e) => progressBucket(e, 100))).toEqual([
      'none',
      'under_half',
      'over_half',
      'over_half',
      'met',
      'surplus',
    ]);
    expect(progressBucket(5, 0)).toBeNull();
  });
  it('standing', () => {
    const open = {
      id: 'c',
      heldCertId: 'h',
      sequence: 1,
      startsOn: '2024-01-01',
      endsOn: '2027-01-01',
      ruleVersionId: 'r',
      status: 'open' as const,
    };
    const st = (over: object) => ({
      compliant: true,
      daysRemaining: 200,
      totals: { accepted: 0, submitted: 0, claimed: 0, planned: 0 },
      requiredX100: 100,
      failing: [],
      projectedAtCycleEnd: [],
      ...over,
    });
    const asOf = '2026-09-11';
    expect(standingBucket('active', [open], st({}), asOf)).toBe('compliant');
    expect(standingBucket('active', [open], st({ compliant: false }), asOf)).toBe('overdue');
    expect(
      standingBucket(
        'active',
        [open],
        st({
          failing: [{ type: 'annual_min', severity: 'soft', overdue: true, due: '2026-01-01' }],
        }),
        asOf,
      ),
    ).toBe('at_risk');
    expect(
      standingBucket(
        'active',
        [open],
        st({
          failing: [{ type: 'fee_paid', severity: 'hard', overdue: false, due: '2026-10-01' }],
        }),
        asOf,
      ),
    ).toBe('at_risk');
    expect(standingBucket('active', [open], st({ daysRemaining: 20 }), asOf)).toBe('at_risk');
    expect(
      standingBucket(
        'active',
        [open],
        st({ daysRemaining: 20, totals: { accepted: 100, submitted: 0, claimed: 0, planned: 0 } }),
        asOf,
      ),
    ).toBe('compliant');
    // Credits met, cycle ended, renewal not recorded: overdue for renewal.
    expect(
      standingBucket(
        'active',
        [open],
        st({
          daysRemaining: -130,
          totals: { accepted: 100, submitted: 0, claimed: 0, planned: 0 },
        }),
        asOf,
      ),
    ).toBe('overdue');
    expect(standingBucket('lapsed', [open], st({}), asOf)).toBe('lapsed');
    expect(standingBucket('active', [{ ...open, status: 'lapsed' as const }], null, asOf)).toBe(
      'lapsed',
    );
    expect(standingBucket('active', [], null, asOf)).toBe('untracked');
  });
});
