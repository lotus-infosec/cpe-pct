import { describe, expect, it } from 'vitest';
import { derive } from '../../src/core/warnings/derive';
import { feeSchedule } from '../../src/core/rules/fees';
import { standing } from '../../src/core/rules';
import type { StandingContext } from '../../src/core/rules';
import { app, bodyA, bodyB, cycles, held } from './fixtures';

const a1 = held[0]!;
const cyA1 = cycles[0]!;
const ctx = (asOf: string, over: Partial<StandingContext> = {}): StandingContext => ({
  held: a1,
  rules: bodyA,
  applications: [],
  payments: [],
  memberships: [{ id: 'm-a', bodyId: 'a' }],
  allHeld: held,
  allCycles: cycles,
  asOf,
  ...over,
});
const run = (asOf: string, over: Partial<StandingContext> = {}) => {
  const c = ctx(asOf, over);
  const st = standing(cyA1, c);
  const fees = feeSchedule(cyA1, c, bodyA.requirements[0]);
  return derive({ standing: st, fees, label: 'A1 (a)', cycleEndsOn: cyA1.endsOn, asOf });
};
const paidAll: StandingContext['payments'] = [
  {
    targetType: 'membership',
    targetId: 'm-a',
    periodStart: '2025-05-01',
    periodEnd: '2028-05-01',
    dueOn: '2025-05-01',
    status: 'paid',
  },
];

describe('warnings.derive()', () => {
  it('fee overdue yesterday → one fee_overdue with a stable key', () => {
    const n = run('2025-05-02');
    expect(n.map((x) => x.kind)).toEqual(['fee_overdue']);
    expect(n[0]!.key).toBe('cy-a1:fee_overdue:2025-05-01');
    expect(run('2025-05-09')[0]!.key).toBe('cy-a1:fee_overdue:2025-05-01'); // same key a week later → dedups
  });
  it('fee due in 20 days → fee_due bucket 30; in 3 days → bucket 7', () => {
    const p: StandingContext['payments'] = [
      {
        targetType: 'membership',
        targetId: 'm-a',
        periodStart: '2025-05-01',
        periodEnd: '2026-05-01',
        dueOn: '2025-05-01',
        status: 'paid',
      },
    ];
    expect(
      run('2026-04-11', { payments: p })
        .filter((x) => x.kind === 'fee_due')
        .map((x) => x.key),
    ).toEqual(['cy-a1:fee_due:2026-05-01:30']);
    expect(
      run('2026-04-28', { payments: p })
        .filter((x) => x.kind === 'fee_due')
        .map((x) => x.key),
    ).toEqual(['cy-a1:fee_due:2026-05-01:7']);
  });
  it('cycle ending buckets 180/90/30/7 with rising severity', () => {
    const at = (d: string) => run(d, { payments: paidAll }).find((x) => x.kind === 'cycle_ending');
    expect(at('2027-10-01')).toBeUndefined(); // 213 days
    expect(at('2027-11-15')).toMatchObject({ key: 'cy-a1:cycle_ending:180', severity: 'info' });
    expect(at('2028-02-15')).toMatchObject({ key: 'cy-a1:cycle_ending:90' });
    expect(at('2028-04-05')).toMatchObject({ key: 'cy-a1:cycle_ending:30', severity: 'warn' });
    expect(at('2028-04-28')).toMatchObject({ key: 'cy-a1:cycle_ending:7', severity: 'urgent' });
  });
  it('30 days from cycle end with the last year floor unmet → annual_floor_at_risk', () => {
    const n = run('2028-04-01', {
      payments: paidAll,
      applications: [
        app({
          id: 'x',
          heldCertId: 'h-a1',
          cycleId: 'cy-a1',
          creditsX100: 12000,
          occurredOn: '2025-06-01',
        }),
      ],
    });
    const risk = n.find((x) => x.key === 'cy-a1:annual_floor_at_risk:3');
    expect(risk).toMatchObject({ severity: 'info' }); // soft at body A; year 2 (missed) fires too
    expect(risk!.body).toContain('Suggested');
  });
  it('nothing fires when everything is fine and far away', () => {
    expect(
      run('2026-01-15', {
        payments: paidAll,
        applications: [
          app({
            id: 'y',
            heldCertId: 'h-a1',
            cycleId: 'cy-a1',
            creditsX100: 5000,
            occurredOn: '2025-06-01',
          }),
        ],
      }),
    ).toEqual([]);
  });
});

describe('feeSchedule()', () => {
  it('membership scope: yearly periods from cycle start, paid/waived/due', () => {
    const c = ctx('2026-09-12', {
      payments: [
        {
          targetType: 'membership',
          targetId: 'm-a',
          periodStart: '2025-05-01',
          periodEnd: '2026-05-01',
          dueOn: '2025-05-01',
          status: 'paid',
        },
        {
          targetType: 'membership',
          targetId: 'm-a',
          periodStart: '2026-05-01',
          periodEnd: '2027-05-01',
          dueOn: '2026-05-01',
          status: 'waived',
        },
      ],
    });
    expect(
      feeSchedule(cyA1, c, bodyA.requirements[0]).map((p) => [p.periodStart, p.status]),
    ).toEqual([
      ['2025-05-01', 'paid'],
      ['2026-05-01', 'waived'],
      ['2027-05-01', 'due'],
    ]);
  });
  it('covered_by_higher_cert: lower cert fee is covered while a higher held cert is open', () => {
    const rs = structuredClone(bodyB);
    rs.requirements[0]!.feeParams = { covered_by_higher_cert: true }; // b1 is renewed by b2 (earning_renews)
    const c: StandingContext = {
      held: held[3]!,
      rules: rs,
      applications: [],
      payments: [],
      memberships: [],
      allHeld: held,
      allCycles: cycles,
      asOf: '2026-09-12',
    };
    const sched = feeSchedule(cycles[3]!, c, rs.requirements[0]);
    expect(sched.every((p) => p.status === 'waived' && p.coveredBy === 'b/b2')).toBe(true);
    const st = standing(cycles[3]!, c);
    expect(st.constraints.find((x) => x.type === 'fee_paid')).toMatchObject({
      satisfied: true,
      note: 'covered by b/b2',
    });
  });
});
