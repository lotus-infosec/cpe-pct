import { describe, expect, it } from 'vitest';
import { credit, round } from '../../src/core/rules';
import type { CreditingRule } from '../../src/core/domain/types';
import { activity } from './fixtures';

const base: CreditingRule = {
  id: 'r',
  ruleVersionId: 'v',
  activityType: 'attend_training',
  bodyLabel: 'x',
  basis: 'per_minutes',
  minutesPerCredit: 60,
  creditsPerItemX100: null,
  rounding: 'exact',
  categoryKey: null,
  capPerCycleX100: null,
  capPerYearX100: null,
  capPerItemX100: null,
  evidenceRequired: true,
  appliesToCertId: null,
};

describe('round()', () => {
  it.each([
    ['floor_quarter', 333.33, 325],
    ['floor_quarter', 100, 100],
    ['floor_quarter', 24, 0],
    ['floor_half', 333.33, 300],
    ['floor_half', 375, 350],
    ['floor_whole', 333.33, 300],
    ['floor_whole', 99, 0],
    ['nearest_quarter', 333.33, 325],
    ['nearest_quarter', 338, 350],
    ['nearest_quarter', 312.5, 325],
    ['exact', 333.33, 333],
    ['exact', 333.5, 334],
  ] as const)('%s(%d) = %d', (mode, raw, want) => expect(round(raw, mode)).toBe(want));
});

describe('credit()', () => {
  it('per_minutes at 60/credit with quarter floor', () =>
    expect(
      credit(
        { ...base, rounding: 'floor_quarter' },
        activity({ id: 'a', activityType: 'attend_training', durationMinutes: 200 }),
      ),
    ).toBe(325));
  it('per_minutes at 50/credit whole', () =>
    expect(
      credit(
        { ...base, minutesPerCredit: 50, rounding: 'floor_whole' },
        activity({ id: 'a', activityType: 'attend_training', durationMinutes: 200 }),
      ),
    ).toBe(400));
  it('per_minutes without duration → null', () =>
    expect(credit(base, activity({ id: 'a', activityType: 'attend_training' }))).toBeNull());
  it('per_item multiplies by itemCount', () =>
    expect(
      credit(
        { ...base, basis: 'per_item', creditsPerItemX100: 500 },
        activity({ id: 'a', activityType: 'read_book', itemCount: 3 }),
      ),
    ).toBe(1500));
  it('per_item defaults itemCount to 1', () =>
    expect(
      credit(
        { ...base, basis: 'per_item', creditsPerItemX100: 500 },
        activity({ id: 'a', activityType: 'read_book', itemCount: null }),
      ),
    ).toBe(500));
  it('fixed ignores duration and count', () =>
    expect(
      credit(
        { ...base, basis: 'fixed', creditsPerItemX100: 4000 },
        activity({ id: 'a', activityType: 'earn_certification', itemCount: 5, durationMinutes: 1 }),
      ),
    ).toBe(4000));
  it('applies cap_per_item after rounding', () =>
    expect(
      credit(
        { ...base, capPerItemX100: 200 },
        activity({ id: 'a', activityType: 'attend_training', durationMinutes: 600 }),
      ),
    ).toBe(200));
  it('never produces a non-integer', () => {
    for (const m of [1, 7, 59, 61, 200, 1441]) {
      const c = credit(
        { ...base, minutesPerCredit: 50, rounding: 'exact' },
        activity({ id: 'a', activityType: 'attend_training', durationMinutes: m }),
      );
      expect(Number.isInteger(c)).toBe(true);
    }
  });
});
