// Pure date helpers over ISO 'YYYY-MM-DD' strings. No Date-object leakage into rule outputs.
import type { IsoDate } from '../domain/types';

export function parseIso(d: IsoDate): { y: number; m: number; d: number } {
  const [y, m, day] = d.split('-').map(Number) as [number, number, number];
  return { y, m, d: day };
}

export function toIso(y: number, m: number, d: number): IsoDate {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${y}-${pad(m)}-${pad(d)}`;
}

function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Adds calendar months; clamps the day to the target month's length (Jan 31 + 1 month = Feb 28/29). */
export function addMonths(date: IsoDate, months: number): IsoDate {
  const { y, m, d } = parseIso(date);
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return toIso(ny, nm, Math.min(d, daysInMonth(ny, nm)));
}

export function addDays(date: IsoDate, days: number): IsoDate {
  const { y, m, d } = parseIso(date);
  const t = Date.UTC(y, m - 1, d) + days * 86_400_000;
  const dt = new Date(t);
  return toIso(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

export function daysBetween(from: IsoDate, to: IsoDate): number {
  const a = parseIso(from);
  const b = parseIso(to);
  return Math.round((Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d)) / 86_400_000);
}

/** start <= date < end (end exclusive). ISO strings compare lexically. */
export function inRange(date: IsoDate, start: IsoDate, end: IsoDate): boolean {
  return date >= start && date < end;
}

export interface Bucket {
  index: number; // 0-based cycle year
  start: IsoDate;
  end: IsoDate; // exclusive
}

/** Splits a cycle into consecutive `months`-long buckets from its start (default 12 = cycle years). */
export function buckets(startsOn: IsoDate, endsOn: IsoDate, months = 12): Bucket[] {
  const out: Bucket[] = [];
  let start = startsOn;
  let i = 0;
  while (start < endsOn) {
    const end = addMonths(startsOn, months * (i + 1));
    out.push({ index: i, start, end: end < endsOn ? end : endsOn });
    start = end;
    i += 1;
  }
  return out;
}

export function bucketOf(date: IsoDate, bs: Bucket[]): Bucket | undefined {
  return bs.find((b) => inRange(date, b.start, b.end));
}
