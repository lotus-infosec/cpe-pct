import { describe, expect, it } from 'vitest';
import { resolve } from '../../src/core/rules';
import type { ResolveContext } from '../../src/core/rules';
import { activity, app, cycles, held, rules } from './fixtures';

const ctx = (existing: ResolveContext['existing'] = []): ResolveContext => ({
  held,
  cycles,
  rules,
  existing,
  asOf: '2026-09-09',
});
const by = (s: ReturnType<typeof resolve>, heldId: string) =>
  s.find((x) => x.heldCertId === heldId);

describe('worked example 1: 200-minute conference session', () => {
  const a = activity({ id: 'bsides', activityType: 'attend_conference', durationMinutes: 200 });
  const s = resolve(a, ctx());
  it('a1 floor_quarter → 3.25 in category A', () =>
    expect(by(s, 'h-a1')).toMatchObject({ creditsX100: 325, categoryKey: 'A' }));
  it('a2 same rule set → 3.25', () => expect(by(s, 'h-a2')?.creditsX100).toBe(325));
  it('b2 floor_whole → 3', () => expect(by(s, 'h-b2')?.creditsX100).toBe(300));
  it('b1 is covered by b2 (credits_flow_down)', () =>
    expect(by(s, 'h-b1')).toMatchObject({ coveredBy: 'h-b2', creditsX100: 300 }));
  it('c1 at 50 min/credit → 4', () => expect(by(s, 'h-c1')?.creditsX100).toBe(400));
  it('d1 floor → 3', () => expect(by(s, 'h-d1')?.creditsX100).toBe(300));
  it('every suggestion explains itself', () =>
    s.forEach((x) => expect(x.explain.length).toBeGreaterThan(0)));
});

describe('worked example 2: 90-minute mentoring', () => {
  const a = activity({ id: 'mentor', activityType: 'mentor', durationMinutes: 90 });
  const existing = [
    app({
      id: 'b-used',
      heldCertId: 'h-a1',
      cycleId: 'cy-a1',
      creditsX100: 2900,
      categoryKey: 'B',
      activityType: 'mentor',
    }),
    app({
      id: 'c-used',
      heldCertId: 'h-c1',
      cycleId: 'cy-c1',
      creditsX100: 1000,
      creditingRuleId: 'c-mentor',
      activityType: 'mentor',
      occurredOn: '2026-06-01',
    }),
  ];
  const s = resolve(a, ctx(existing));
  it('a1: 1.5 B clamped to remaining 1.0 with warning', () =>
    expect(by(s, 'h-a1')).toMatchObject({
      creditsX100: 100,
      warnings: expect.arrayContaining(['clamped_category_cap']),
    }));
  it('b2: no rule → not suggested', () => expect(by(s, 'h-b2')).toBeUndefined());
  it('c1: 90/50=1, yearly cap 10 used 10 → 0 with warning', () =>
    expect(by(s, 'h-c1')).toMatchObject({
      creditsX100: 0,
      warnings: expect.arrayContaining(['clamped_annual_cap']),
    }));
  it('d1: 1.5 → floor 1', () => expect(by(s, 'h-d1')?.creditsX100).toBe(100));
});

describe('worked example 3: read a book, 600 minutes', () => {
  const a = activity({ id: 'book', activityType: 'read_book', durationMinutes: 600, itemCount: 1 });
  const existing = [
    app({
      id: 'c-books',
      heldCertId: 'h-c1',
      cycleId: 'cy-c1',
      creditsX100: 1000,
      creditingRuleId: 'c-book',
      activityType: 'read_book',
      occurredOn: '2026-06-01',
    }),
  ];
  const s = resolve(a, ctx(existing));
  it('a1 per_item → 5', () => expect(by(s, 'h-a1')?.creditsX100).toBe(500));
  it('c1 timed 600/50=12, clamped to remaining 10 of 20/yr', () =>
    expect(by(s, 'h-c1')).toMatchObject({
      creditsX100: 1000,
      warnings: expect.arrayContaining(['clamped_annual_cap']),
    }));
  it('d1 per_item → 5', () => expect(by(s, 'h-d1')?.creditsX100).toBe(500));
  it('b: no rule → not suggested', () => expect(by(s, 'h-b2')).toBeUndefined());
});

describe('worked example 4: earned another certification', () => {
  const a = activity({
    id: 'ccsp',
    activityType: 'earn_certification',
    relatedCertificationId: 'x/ccsp',
  });
  const s = resolve(a, ctx());
  it('a1: no crediting rule → not suggested', () => expect(by(s, 'h-a1')).toBeUndefined());
  it('b1 and b2: earning_renews → renewal proposals, not credits', () => {
    expect(by(s, 'h-b1')).toMatchObject({ kind: 'renewal', creditsX100: 0 });
    expect(by(s, 'h-b2')).toMatchObject({ kind: 'renewal' });
  });
  it('d1: earning_credits 40', () =>
    expect(by(s, 'h-d1')).toMatchObject({ kind: 'credit', creditsX100: 4000 }));
});

describe('resolve() edge cases', () => {
  it('`other` yields nothing', () =>
    expect(
      resolve(activity({ id: 'o', activityType: 'other', durationMinutes: 600 }), ctx()),
    ).toEqual([]));
  it('activity dated outside every open cycle yields nothing', () =>
    expect(
      resolve(
        activity({
          id: 'old',
          activityType: 'attend_conference',
          durationMinutes: 60,
          occurredOn: '2020-01-01',
        }),
        ctx(),
      ),
    ).toEqual([]));
  it('applies_to-specific rule beats the general one', () => {
    const rs = structuredClone(rules.get('a@1')!);
    rs.creditingRules.push({
      ...rs.creditingRules[0]!,
      id: 'a-conf-a2',
      appliesToCertId: 'a/a2',
      minutesPerCredit: 30,
    });
    const s = resolve(
      activity({ id: 'x', activityType: 'attend_conference', durationMinutes: 60 }),
      { ...ctx(), rules: new Map([['a@1', rs]]) },
    );
    expect(by(s, 'h-a2')?.creditsX100).toBe(200);
    expect(by(s, 'h-a1')?.creditsX100).toBe(100);
  });
  it('warns when the activity is already applied to that cert', () => {
    const a = activity({ id: 'dup', activityType: 'attend_conference', durationMinutes: 60 });
    const s = resolve(
      a,
      ctx([
        app({ id: 'e', activityId: 'dup', heldCertId: 'h-a1', cycleId: 'cy-a1', creditsX100: 100 }),
      ]),
    );
    expect(by(s, 'h-a1')?.warnings).toContain('already_applied');
  });
  it('cycle cap clamps and warns', () => {
    const rs = structuredClone(rules.get('d@1')!);
    rs.creditingRules[0]!.capPerCycleX100 = 500;
    const s = resolve(
      activity({ id: 'x', activityType: 'attend_conference', durationMinutes: 600 }),
      {
        ...ctx([
          app({
            id: 'u',
            heldCertId: 'h-d1',
            cycleId: 'cy-d1',
            creditsX100: 400,
            creditingRuleId: 'd-conf',
          }),
        ]),
        rules: new Map([['d@1', rs]]),
      },
    );
    expect(by(s, 'h-d1')).toMatchObject({
      creditsX100: 100,
      warnings: expect.arrayContaining(['clamped_cycle_cap']),
    });
  });
});
