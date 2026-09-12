// DbJobQueue + runDueJobs over the `jobs` table. Lease column makes overlapping ticks safe:
// a job is picked only if unleased or its lease expired, and the pick is a conditional UPDATE.
import { and, eq, inArray, isNull, lte, or } from 'drizzle-orm';
import type { Db } from '../../db/client';
import { jobs } from '../../db/schema';
import type { Clock, JobPayload, JobQueue, JobType, TickBudget } from '../../ports';
import {
  backoffMs,
  LEASE_MS,
  MAX_ATTEMPTS,
  nextCron,
  withinBudget,
  type Handlers,
  type JobRow,
} from '../../core/jobs/runner';

export class DbJobQueue implements JobQueue {
  constructor(
    private readonly db: Db,
    private readonly clock: Clock,
  ) {}

  async enqueue<T extends JobType>(
    type: T,
    payload: JobPayload[T],
    opts: { runAt?: Date; idempotencyKey?: string; cron?: string } = {},
  ): Promise<string> {
    const now = this.clock.now();
    const id = crypto.randomUUID();
    await this.db
      .insert(jobs)
      .values({
        id,
        type,
        payload,
        idempotencyKey: opts.idempotencyKey ?? null,
        runAt: (opts.runAt ?? now).toISOString(),
        cron: opts.cron ?? null,
        attempts: 0,
        status: 'queued',
        createdAt: now.toISOString(),
      })
      .onConflictDoNothing({ target: jobs.idempotencyKey });
    if (opts.idempotencyKey) {
      const existing = await this.db
        .select({ id: jobs.id })
        .from(jobs)
        .where(eq(jobs.idempotencyKey, opts.idempotencyKey))
        .get();
      return existing?.id ?? id;
    }
    return id;
  }
}

/** Due, and either never leased, or the lease expired (which is how a crashed runner's job comes back). */
const pickable = (nowIso: string) =>
  and(
    inArray(jobs.status, ['queued', 'running']),
    lte(jobs.runAt, nowIso),
    or(isNull(jobs.leaseUntil), lte(jobs.leaseUntil, nowIso)),
  );

export interface RunResult {
  picked: number;
  done: number;
  failed: number;
}

/** One tick. Picks due jobs one at a time under a lease, runs the handler, records the outcome. */
export async function runDueJobs(
  db: Db,
  clock: Clock,
  handlers: Handlers,
  budget: TickBudget,
): Promise<RunResult> {
  const startedAt = Date.now();
  const result: RunResult = { picked: 0, done: 0, failed: 0 };
  while (withinBudget(startedAt, budget, result.picked)) {
    const now = clock.now();
    const nowIso = now.toISOString();
    const candidate = await db
      .select()
      .from(jobs)
      .where(pickable(nowIso))
      .orderBy(jobs.runAt)
      .limit(1)
      .get();
    if (!candidate) break;
    const leaseUntil = new Date(now.getTime() + LEASE_MS).toISOString();
    // Conditional claim: only wins if nobody else leased it since we read it.
    const claimed = await db
      .update(jobs)
      .set({ leaseUntil, status: 'running', attempts: candidate.attempts + 1 })
      .where(and(eq(jobs.id, candidate.id), pickable(nowIso)))
      .returning({ id: jobs.id })
      .get();
    if (!claimed) continue;
    result.picked += 1;
    const job: JobRow = {
      id: candidate.id,
      type: candidate.type as JobType,
      payload: candidate.payload,
      attempts: candidate.attempts + 1,
      cron: candidate.cron,
      runAt: candidate.runAt,
    };
    const handler = handlers[job.type] as ((p: unknown, j: JobRow) => Promise<void>) | undefined;
    try {
      if (!handler) throw new Error(`no handler for ${job.type}`);
      await handler(job.payload, job);
      const next = job.cron ? nextCron(job.cron, clock.now()) : null;
      await db.batch([
        db
          .update(jobs)
          .set({ status: 'done', leaseUntil: null, lastError: null })
          .where(eq(jobs.id, job.id)),
        ...(next
          ? [
              db
                .insert(jobs)
                .values({
                  id: crypto.randomUUID(),
                  type: job.type,
                  payload: job.payload,
                  runAt: next.toISOString(),
                  cron: job.cron,
                  attempts: 0,
                  status: 'queued',
                  createdAt: clock.now().toISOString(),
                  idempotencyKey: `${job.type}:${job.cron}:${next.toISOString()}`,
                })
                .onConflictDoNothing(),
            ]
          : []),
      ]);
      result.done += 1;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      const exhausted = job.attempts >= MAX_ATTEMPTS;
      await db
        .update(jobs)
        .set(
          exhausted
            ? { status: 'failed', leaseUntil: null, lastError: message }
            : {
                status: 'queued',
                leaseUntil: null,
                lastError: message,
                runAt: new Date(clock.now().getTime() + backoffMs(job.attempts)).toISOString(),
              },
        )
        .where(eq(jobs.id, job.id));
      result.failed += 1;
    }
  }
  return result;
}
