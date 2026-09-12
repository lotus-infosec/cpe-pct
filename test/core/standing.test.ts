import { describe, expect, it } from 'vitest';
import { firstCycle, rollover, standing } from '../../src/core/rules';
import type { StandingContext } from '../../src/core/rules';
import { addMonths, buckets } from '../../src/core/cycles/dates';
import { app, bodyA, bodyB, bodyC, cycles, held } from './fixtures';

const a1 = held[0]!;
const cyA1 = cycles[0]!;
const base = (over: Partial<StandingContext> = {}): StandingContext => ({
  held: a1,
  rules: bodyA,
  applications: [],
  payments: [],
  memberships: [{ id: 'm-a', bodyId: 'a' }],
  allHeld: held,
  allCycles: cycles,
  asOf: '2026-09-09',
  ...over,
});

describe('worked example 5: a1 cycle year 2, fee lapsed', () => {
  const applications = [
    app({
      id: 'y1',
      heldCertId: 'h-a1',
      cycleId: 'cy-a1',
      creditsX100: 9200,
      categoryKey: 'A',
      occurredOn: '2025-08-01',
      status: 'accepted',
    }),
    app({
      id: 'sub',
      heldCertId: 'h-a1',
      cycleId: 'cy-a1',
      creditsX100: 600,
      categoryKey: 'A',
      occurredOn: '2026-06-01',
      status: 'submitted',
    }),
    app({
      id: 'clm',
      heldCertId: 'h-a1',
      cycleId: 'cy-a1',
      creditsX100: 325,
      categoryKey: 'A',
      occurredOn: '2026-07-01',
      status: 'claimed',
    }),
    app({
      id: 'b',
      heldCertId: 'h-a1',
      cycleId: 'cy-a1',
      creditsX100: 2900,
      categoryKey: 'B',
      occurredOn: '2025-09-01',
      status: 'accepted',
    }),
  ];
  const payments: StandingContext['payments'] = [
    {
      targetType: 'membership',
      targetId: 'm-a',
      periodStart: '2025-05-01',
      periodEnd: '2026-05-01',
      dueOn: '2025-05-01',
      status: 'paid',
    },
  ];
  const s = standing(cyA1, base({ applications, payments }));
  it('is non-compliant because the fee is overdue', () => {
    expect(s.compliant).toBe(false);
    const fee = s.constraints.find((c) => c.type === 'fee_paid')!;
    expect(fee).toMatchObject({
      satisfied: false,
      overdue: true,
      scope: 'membership:a',
      due: '2026-05-01',
    });
    expect(fee.overdueDays).toBe(131);
  });
  it('reports accepted/submitted/claimed separately against the cycle total', () => {
    const t = s.constraints.find((c) => c.type === 'cycle_total')!;
    expect(t.required).toBe(12000);
    expect(t.totals).toMatchObject({ accepted: 12100, submitted: 600, claimed: 325 });
    expect(t.satisfied).toBe(true);
  });
  it('annual_min: year 1 met, year 2 not yet, with its deadline', () => {
    const am = s.constraints.find((c) => c.type === 'annual_min')!;
    expect(am.of!.map((y) => [y.year, y.actual, y.satisfied])).toEqual([
      [1, 12100, true],
      [2, 925, false],
      [3, 0, false],
    ]);
    expect(am.year).toBe(2);
    expect(am.due).toBe('2027-04-30');
    expect(am.overdue).toBe(false);
  });
  it('category_max B: 29 of 30 used, satisfied', () =>
    expect(s.constraints.find((c) => c.type === 'category_max')).toMatchObject({
      category: 'B',
      actual: 2900,
      required: 3000,
      satisfied: true,
    }));
  it('failing constraint is listed first', () => expect(s.constraints[0]!.satisfied).toBe(false));
});

describe('standing() constraint types', () => {
  it('fee_paid at certification scope uses cycle payments', () => {
    const s = standing(
      cycles[3]!,
      base({
        held: held[3]!,
        rules: bodyB,
        memberships: [],
        payments: [
          {
            targetType: 'cycle',
            targetId: 'cy-b1',
            periodStart: '2025-01-01',
            periodEnd: '2026-01-01',
            dueOn: '2025-01-01',
            status: 'paid',
          },
          {
            targetType: 'cycle',
            targetId: 'cy-b1',
            periodStart: '2026-01-01',
            periodEnd: '2027-01-01',
            dueOn: '2026-01-01',
            status: 'waived',
          },
        ],
      }),
    );
    expect(s.constraints.find((c) => c.type === 'fee_paid')).toMatchObject({
      satisfied: true,
      scope: 'cycle:cy-b1',
    });
  });
  it('hard annual_min that is overdue makes the cycle non-compliant', () => {
    const s = standing(
      cycles[4]!,
      base({
        held: held[4]!,
        rules: bodyC,
        memberships: [],
        applications: [
          app({
            id: 'x',
            heldCertId: 'h-c1',
            cycleId: 'cy-c1',
            creditsX100: 500,
            occurredOn: '2025-03-01',
          }),
        ],
      }),
    );
    expect(s.compliant).toBe(false);
    expect(s.constraints.find((c) => c.type === 'annual_min')).toMatchObject({
      year: 1,
      actual: 500,
      required: 2000,
      overdue: true,
    });
  });
  it('prerequisite_current, attestation, recert_exam, any_of', () => {
    const rs = structuredClone(bodyB);
    rs.constraints = [
      {
        id: 'pre',
        certificationId: 'b/b1',
        type: 'prerequisite_current',
        params: { certification: 'b/b2' },
        severity: 'hard',
      },
      { id: 'att', certificationId: null, type: 'attestation', params: {}, severity: 'hard' },
      {
        id: 'any',
        certificationId: null,
        type: 'any_of',
        params: { of: [{ type: 'cycle_total' }, { type: 'recert_exam' }] },
        severity: 'hard',
      },
    ];
    const s = standing(
      cycles[3]!,
      base({ held: held[3]!, rules: rs, memberships: [], recertExamPassedOn: '2026-03-01' }),
    );
    expect(s.constraints.find((c) => c.type === 'prerequisite_current')?.satisfied).toBe(true);
    expect(s.constraints.find((c) => c.type === 'attestation')?.satisfied).toBe(false);
    const any = s.constraints.find((c) => c.type === 'any_of')!;
    expect(any.satisfied).toBe(true);
    expect(any.of!.map((r) => [r.type, r.satisfied])).toEqual([
      ['cycle_total', false],
      ['recert_exam', true],
    ]);
    expect(s.compliant).toBe(true); // attestation due at cycle end, not yet overdue
  });
  it('projects cycle_total shortfall at cycle end when behind pace', () => {
    const s = standing(
      cyA1,
      base({
        applications: [app({ id: 'p', heldCertId: 'h-a1', cycleId: 'cy-a1', creditsX100: 100 })],
        payments: [
          {
            targetType: 'membership',
            targetId: 'm-a',
            periodStart: '2025-05-01',
            periodEnd: '2027-05-01',
            dueOn: '2025-05-01',
            status: 'paid',
          },
        ],
      }),
    );
    expect(s.projectedAtCycleEnd).toContain('cycle_total');
    expect(s.compliant).toBe(true);
  });
});

describe('cycles', () => {
  it('buckets a 36-month cycle into three years', () =>
    expect(buckets('2025-05-01', '2028-05-01').map((b) => [b.start, b.end])).toEqual([
      ['2025-05-01', '2026-05-01'],
      ['2026-05-01', '2027-05-01'],
      ['2027-05-01', '2028-05-01'],
    ]));
  it('addMonths clamps month-end', () => expect(addMonths('2025-01-31', 1)).toBe('2025-02-28'));
  it('firstCycle pins the version and spans cycle_months', () =>
    expect(firstCycle('h', '2025-05-01', 36, 'a@1', 'cy')).toMatchObject({
      startsOn: '2025-05-01',
      endsOn: '2028-05-01',
      sequence: 1,
      ruleVersionId: 'a@1',
    }));
  it('rollover closes and opens contiguous cycles with the pinned version', () => {
    const { closed, opened } = rollover(cyA1, {
      renewedOn: '2028-04-15',
      ruleVersionId: 'a@2',
      cycleMonths: 36,
      newCycleId: 'cy-a1-2',
    });
    expect(closed.status).toBe('renewed');
    expect(opened).toMatchObject({
      sequence: 2,
      startsOn: '2028-05-01',
      endsOn: '2031-05-01',
      ruleVersionId: 'a@2',
      status: 'open',
    });
  });
});
