import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { openNodeDb } from '../../src/adapters/node/db';
import { DbJobQueue, runDueJobs } from '../../src/adapters/shared/db-job-queue';
import { jobs } from '../../src/db/schema';
import type { Clock } from '../../src/ports';

const budget = { maxJobs: 10, softDeadlineMs: 5_000 };
const clockAt = (iso: string): Clock & { set: (s: string) => void } => {
  let t = new Date(iso);
  return {
    now: () => t,
    set: (s) => {
      t = new Date(s);
    },
  };
};

describe('DbJobQueue + runDueJobs', () => {
  it('runs due jobs, skips future ones, records done', async () => {
    const db = await openNodeDb(':memory:', { migrationsFolder: 'src/db/migrations' });
    const clock = clockAt('2026-09-12T10:00:00Z');
    const q = new DbJobQueue(db, clock);
    const ran: string[] = [];
    await q.enqueue('extract_text', { evidenceId: 'e1' });
    await q.enqueue(
      'extract_text',
      { evidenceId: 'later' },
      { runAt: new Date('2026-09-12T11:00:00Z') },
    );
    const r = await runDueJobs(
      db,
      clock,
      {
        extract_text: async (p) => {
          ran.push(p.evidenceId);
        },
      },
      budget,
    );
    expect(r).toEqual({ picked: 1, done: 1, failed: 0 });
    expect(ran).toEqual(['e1']);
    const rows = await db.select().from(jobs).all();
    expect(rows.map((x) => x.status).sort()).toEqual(['done', 'queued']);
  });

  it('idempotency key dedups and returns the existing id', async () => {
    const db = await openNodeDb(':memory:', { migrationsFolder: 'src/db/migrations' });
    const q = new DbJobQueue(db, clockAt('2026-09-12T10:00:00Z'));
    const a = await q.enqueue(
      'extract_text',
      { evidenceId: 'e1' },
      { idempotencyKey: 'extract:e1' },
    );
    const b = await q.enqueue(
      'extract_text',
      { evidenceId: 'e1' },
      { idempotencyKey: 'extract:e1' },
    );
    expect(b).toBe(a);
    expect((await db.select().from(jobs).all()).length).toBe(1);
  });

  it('failure backs off, then marks failed after max attempts', async () => {
    const db = await openNodeDb(':memory:', { migrationsFolder: 'src/db/migrations' });
    const clock = clockAt('2026-09-12T10:00:00Z');
    const q = new DbJobQueue(db, clock);
    const id = await q.enqueue('renewal_scan', { asOf: '2026-09-12' });
    const boom = {
      renewal_scan: async () => {
        throw new Error('boom');
      },
    };
    for (let attempt = 1; attempt <= 5; attempt++) {
      const r = await runDueJobs(db, clock, boom, budget);
      expect(r.failed).toBe(1);
      const row = (await db.select().from(jobs).where(eq(jobs.id, id)).get())!;
      expect(row.attempts).toBe(attempt);
      expect(row.lastError).toBe('boom');
      if (attempt < 5) {
        expect(row.status).toBe('queued');
        expect(row.runAt > clock.now().toISOString()).toBe(true);
        clock.set(new Date(new Date(row.runAt).getTime() + 1000).toISOString());
      } else expect(row.status).toBe('failed');
    }
    expect((await runDueJobs(db, clock, boom, budget)).picked).toBe(0);
  });

  it('a crashed run (lease held) is re-picked only after the lease expires', async () => {
    const db = await openNodeDb(':memory:', { migrationsFolder: 'src/db/migrations' });
    const clock = clockAt('2026-09-12T10:00:00Z');
    const q = new DbJobQueue(db, clock);
    const id = await q.enqueue('extract_text', { evidenceId: 'e1' });
    // Simulate a runner that claimed the job then died: status running, lease in the future.
    await db
      .update(jobs)
      .set({ status: 'running', leaseUntil: '2026-09-12T10:05:00.000Z', attempts: 1 })
      .where(eq(jobs.id, id));
    let ran = 0;
    const h = {
      extract_text: async () => {
        ran += 1;
      },
    };
    expect((await runDueJobs(db, clock, h, budget)).picked).toBe(0); // lease still held
    clock.set('2026-09-12T10:06:00Z');
    // Sweep: expired leases return to queued (the picker treats running+expired as pickable).
    expect((await runDueJobs(db, clock, h, budget)).picked).toBe(1);
    expect(ran).toBe(1);
  });

  it('recurring jobs enqueue their next occurrence on completion', async () => {
    const db = await openNodeDb(':memory:', { migrationsFolder: 'src/db/migrations' });
    const clock = clockAt('2026-09-12T10:00:00Z');
    const q = new DbJobQueue(db, clock);
    await q.enqueue('renewal_scan', { asOf: '2026-09-12' }, { cron: '0 6 * * *' });
    await runDueJobs(db, clock, { renewal_scan: async () => {} }, budget);
    const rows = await db.select().from(jobs).orderBy(jobs.runAt).all();
    expect(rows.map((r) => [r.status, r.runAt])).toEqual([
      ['done', '2026-09-12T10:00:00.000Z'],
      ['queued', '2026-09-13T06:00:00.000Z'],
    ]);
  });

  it('respects the tick budget', async () => {
    const db = await openNodeDb(':memory:', { migrationsFolder: 'src/db/migrations' });
    const clock = clockAt('2026-09-12T10:00:00Z');
    const q = new DbJobQueue(db, clock);
    for (let i = 0; i < 5; i++) await q.enqueue('extract_text', { evidenceId: `e${i}` });
    expect(
      (
        await runDueJobs(
          db,
          clock,
          { extract_text: async () => {} },
          { maxJobs: 2, softDeadlineMs: 5000 },
        )
      ).picked,
    ).toBe(2);
  });
});
