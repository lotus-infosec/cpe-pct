// Job runner contracts. The queue and runner are one implementation on both targets; only the tick
// source differs (AGENTS §6.2, DECISIONS D-012). Persistence is done by the adapter that owns the DB.
import type { JobPayload, JobType, TickBudget } from '../../ports';

export interface JobRow {
  id: string;
  type: JobType;
  payload: unknown;
  attempts: number;
  cron: string | null;
  runAt: string;
}

export type Handler<T extends JobType = JobType> = (
  payload: JobPayload[T],
  job: JobRow,
) => Promise<void>;
export type Handlers = { [T in JobType]?: Handler<T> };

export const MAX_ATTEMPTS = 5;
export const LEASE_MS = 5 * 60_000;

/** Exponential backoff in ms for a failed attempt (1-based). */
export function backoffMs(attempt: number): number {
  return Math.min(60 * 60_000, 30_000 * 2 ** Math.max(0, attempt - 1));
}

// Next occurrence for the tiny cron dialect we support: every-N-minutes ("star-slash-N * * * *"),
// hourly at minute M ("M * * * *"), daily at H:M UTC ("M H * * *"). Anything else → null (one-shot).
export function nextCron(expr: string, from: Date): Date | null {
  const m = expr.trim().split(/\s+/);
  if (m.length !== 5) return null;
  const [min, hour, dom, mon, dow] = m as [string, string, string, string, string];
  if (dom !== '*' || mon !== '*' || dow !== '*') return null;
  const d = new Date(from.getTime());
  d.setUTCSeconds(0, 0);
  const every = min.match(/^\*\/(\d+)$/);
  if (every && hour === '*') {
    const n = Number(every[1]);
    d.setUTCMinutes(Math.floor(d.getUTCMinutes() / n) * n + n);
    return d;
  }
  if (/^\d+$/.test(min) && hour === '*') {
    d.setUTCMinutes(Number(min));
    if (d <= from) d.setUTCHours(d.getUTCHours() + 1);
    return d;
  }
  if (/^\d+$/.test(min) && /^\d+$/.test(hour)) {
    d.setUTCHours(Number(hour), Number(min));
    if (d <= from) d.setUTCDate(d.getUTCDate() + 1);
    return d;
  }
  return null;
}

export function withinBudget(startedAt: number, budget: TickBudget, done: number): boolean {
  return done < budget.maxJobs && Date.now() - startedAt < budget.softDeadlineMs;
}
