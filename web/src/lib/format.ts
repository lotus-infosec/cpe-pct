// Every number, date and relative time the interface prints goes through here, so a value cannot
// read one way on the dashboard and another on the cycle page. Display only: the API, the engine and
// exports keep real totals. No locale-dependent formatting: day and month never swap between
// machines, and a thousands separator is always a comma.
import { STANDING } from './labels';
import type { StandingBucket } from './types';

const grouped = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });

/** `12`, `12.5`, `790.25`, `1,240`. Two decimals only when fractional; credits are hundredths. */
export function credits(x100: number): string {
  const abs = Math.abs(Math.round(x100));
  const sign = x100 < 0 && abs > 0 ? '-' : '';
  const whole = grouped.format(Math.floor(abs / 100));
  const frac = abs % 100;
  if (frac === 0) return sign + whole;
  return `${sign}${whole}.${String(frac).padStart(2, '0').replace(/0$/, '')}`;
}

export interface Against {
  /** Earned, capped at the requirement: what counts. */
  shown: string;
  required: string;
  /** `120 / 120` */
  text: string;
  met: boolean;
  /** Hundredths earned beyond the requirement; 0 when not over. */
  surplusX100: number;
  /** `+670.25 beyond requirement`, or null when there is no surplus. */
  surplus: string | null;
}

/**
 * Earned against a requirement or a cap. Anything above it is shown as the requirement, and the
 * excess moves to its own line: a surplus earns nothing toward this requirement, and a count over a
 * cap is exactly the part that does not count.
 */
export function creditsAgainst(
  actualX100: number,
  requiredX100: number,
  beyond = 'beyond requirement',
): Against {
  const capped = requiredX100 > 0 ? Math.min(actualX100, requiredX100) : actualX100;
  const surplusX100 = requiredX100 > 0 ? Math.max(0, actualX100 - requiredX100) : 0;
  const shown = credits(capped);
  const required = credits(requiredX100);
  return {
    shown,
    required,
    text: `${shown} / ${required}`,
    met: actualX100 >= requiredX100,
    surplusX100,
    surplus: surplusX100 > 0 ? `+${credits(surplusX100)} ${beyond}` : null,
  };
}

const DAY = 86_400_000;
const utc = (iso: string) => {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number) as [number, number, number];
  return Date.UTC(y, m - 1, d);
};

/** Whole days from `from` to `to`, both ISO dates. Negative when `to` is earlier. */
export function daysBetween(from: string, to: string): number {
  return Math.round((utc(to) - utc(from)) / DAY);
}

export function addDays(iso: string, days: number): string {
  return new Date(utc(iso) + days * DAY).toISOString().slice(0, 10);
}

/** Cycles and fee periods store an exclusive end. The day a person reads as "the end" is the one before. */
export const lastDay = (endExclusive: string) => addDays(endExclusive, -1);

/** Signed days until the last day of a cycle: 0 on that day, -1 the day after. Matches `derived.daysToExpiry`. */
export const daysToCycleEnd = (asOf: string, endsOnExclusive: string) =>
  daysBetween(asOf, lastDay(endsOnExclusive));

export type DayTone = 'bad' | 'warn' | 'dim';

/** Every relative-time string in the app. The word carries the meaning; the tone only repeats it. */
export function relativeDays(days: number): { text: string; tone: DayTone } {
  const n = grouped.format(Math.abs(days));
  if (days > 1) return { text: `${n} days left`, tone: days <= 30 ? 'warn' : 'dim' };
  if (days === 1) return { text: '1 day left', tone: 'warn' };
  if (days === 0) return { text: 'due today', tone: 'warn' };
  if (days === -1) return { text: '1 day overdue', tone: 'bad' };
  return { text: `${n} days overdue`, tone: 'bad' };
}

export const DAY_TONE_CLASS: Record<DayTone, string> = {
  bad: 'text-bad',
  warn: 'text-warn',
  dim: 'text-dim',
};

/** Label and tone for a standing bucket, or for a single cycle's compliance when given a boolean. */
export function standingLabel(s: StandingBucket | boolean | null | undefined) {
  if (typeof s === 'boolean')
    return s
      ? { label: 'Good standing', tone: 'ok' as const }
      : { label: 'Action needed', tone: 'bad' as const };
  return STANDING[s ?? 'untracked'];
}

/** `2024-01-01 → 2026-12-31`, from a start and an exclusive end. ISO, for tables and headers. */
export const dateRange = (start: string, endExclusive: string) =>
  `${start} → ${lastDay(endExclusive)}`;

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/** `12 September 2026`, for prose. Built by hand so no locale can reorder it. */
export function longDate(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number) as [number, number, number];
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

/** `2026-09-16 14:05` from an ISO timestamp, in UTC as stored. */
export const timestamp = (iso: string) => iso.slice(0, 16).replace('T', ' ');

export const count = (n: number) => grouped.format(n);

/** `USD 250.00` style amounts, rendered as `$250.00` in en-US so the output never depends on the browser. */
export const money = (cents: number, currency = 'USD') =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(cents / 100);

export function bytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1_048_576) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1_048_576).toFixed(1)} MB`;
}
