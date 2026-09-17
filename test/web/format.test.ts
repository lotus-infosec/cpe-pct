import { describe, expect, it } from 'vitest';
import {
  bytes,
  credits,
  creditsAgainst,
  dateRange,
  daysToCycleEnd,
  lastDay,
  longDate,
  money,
  relativeDays,
  standingLabel,
  timestamp,
} from '../../web/src/lib/format';

describe('credits', () => {
  it('prints decimals only when fractional', () => {
    expect(credits(0)).toBe('0');
    expect(credits(12000)).toBe('120');
    expect(credits(1250)).toBe('12.5');
    expect(credits(79025)).toBe('790.25');
    expect(credits(1)).toBe('0.01');
    expect(credits(10)).toBe('0.1');
  });
  it('groups thousands over 999', () => {
    expect(credits(99900)).toBe('999');
    expect(credits(100000)).toBe('1,000');
    expect(credits(124050)).toBe('1,240.5');
  });
  it('keeps the sign without a negative zero', () => {
    expect(credits(-50)).toBe('-0.5');
    expect(credits(-12000)).toBe('-120');
    expect(credits(-0)).toBe('0');
  });
});

describe('creditsAgainst', () => {
  it('zero earned', () => {
    expect(creditsAgainst(0, 12000)).toMatchObject({ text: '0 / 120', met: false, surplus: null });
  });
  it('one under', () => {
    expect(creditsAgainst(11999, 12000)).toMatchObject({ text: '119.99 / 120', met: false });
  });
  it('exactly met', () => {
    expect(creditsAgainst(12000, 12000)).toMatchObject({
      text: '120 / 120',
      met: true,
      surplusX100: 0,
      surplus: null,
    });
  });
  it('one over caps and moves the excess', () => {
    expect(creditsAgainst(12001, 12000)).toMatchObject({
      text: '120 / 120',
      met: true,
      surplusX100: 1,
      surplus: '+0.01 beyond requirement',
    });
  });
  it('the CISSP case', () => {
    expect(creditsAgainst(79025, 12000)).toMatchObject({
      text: '120 / 120',
      surplus: '+670.25 beyond requirement',
    });
  });
  it('names a cap when asked', () => {
    expect(creditsAgainst(1500, 1200, 'over the cap').surplus).toBe('+3 over the cap');
  });
  it('no requirement shows the real figure', () => {
    expect(creditsAgainst(500, 0)).toMatchObject({ text: '5 / 0', surplus: null, met: true });
  });
});

describe('relativeDays', () => {
  it.each([
    [561, '561 days left', 'dim'],
    [31, '31 days left', 'dim'],
    [30, '30 days left', 'warn'],
    [2, '2 days left', 'warn'],
    [1, '1 day left', 'warn'],
    [0, 'due today', 'warn'],
    [-1, '1 day overdue', 'bad'],
    [-561, '561 days overdue', 'bad'],
    [-1200, '1,200 days overdue', 'bad'],
  ] as const)('%i → %s', (days, text, tone) => {
    expect(relativeDays(days)).toEqual({ text, tone });
  });
  it('never prints a negative number', () => {
    for (let d = -800; d <= 800; d++) expect(relativeDays(d).text).not.toMatch(/-\d/);
  });
});

describe('cycle end', () => {
  // endsOn is exclusive: a cycle with endsOn 2026-10-01 has 2026-09-30 as its last day.
  const endsOn = '2026-10-01';
  it('yesterday, today, tomorrow relative to the last day', () => {
    expect(lastDay(endsOn)).toBe('2026-09-30');
    expect(daysToCycleEnd('2026-09-29', endsOn)).toBe(1);
    expect(daysToCycleEnd('2026-09-30', endsOn)).toBe(0);
    expect(daysToCycleEnd('2026-10-01', endsOn)).toBe(-1);
    expect(relativeDays(daysToCycleEnd('2026-09-30', endsOn)).text).toBe('due today');
    expect(relativeDays(daysToCycleEnd('2026-10-01', endsOn)).text).toBe('1 day overdue');
  });
  it('crosses month, year and leap day', () => {
    expect(lastDay('2025-01-01')).toBe('2024-12-31');
    expect(lastDay('2028-03-01')).toBe('2028-02-29');
    expect(daysToCycleEnd('2028-02-28', '2028-03-01')).toBe(1);
  });
});

describe('dates', () => {
  it('ranges print the inclusive last day', () => {
    expect(dateRange('2023-10-01', '2026-10-01')).toBe('2023-10-01 → 2026-09-30');
  });
  it('long form is day month year regardless of locale', () => {
    expect(longDate('2026-09-12')).toBe('12 September 2026');
    expect(longDate('2026-01-01T08:00:00Z')).toBe('1 January 2026');
  });
  it('timestamps', () => {
    expect(timestamp('2026-09-16T14:05:33.120Z')).toBe('2026-09-16 14:05');
  });
});

describe('standingLabel', () => {
  it('buckets and booleans', () => {
    expect(standingLabel('overdue')).toEqual({ label: 'Overdue', tone: 'bad' });
    expect(standingLabel(null)).toEqual({ label: 'No cycle', tone: 'muted' });
    expect(standingLabel(true)).toEqual({ label: 'Good standing', tone: 'ok' });
    expect(standingLabel(false)).toEqual({ label: 'Action needed', tone: 'bad' });
  });
});

describe('money and bytes', () => {
  it('money is en-US', () => {
    expect(money(25000)).toBe('$250.00');
    expect(money(12345678, 'EUR')).toBe('€123,456.78');
  });
  it('bytes', () => {
    expect(bytes(512)).toBe('512 B');
    expect(bytes(2048)).toBe('2.0 KB');
    expect(bytes(5 * 1_048_576)).toBe('5.0 MB');
  });
});
