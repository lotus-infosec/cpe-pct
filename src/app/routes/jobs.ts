import { Hono } from 'hono';
import { desc } from 'drizzle-orm';
import * as s from '../../db/schema';
import type { Vars } from '../context';
import { runDueJobs } from '../../adapters/shared/db-job-queue';
import { jobHandlers } from '../jobs/extract-text';

export const jobsRoute = new Hono<Vars>()
  .get('/', async (c) =>
    c.json(
      await c.get('ctx').db.select().from(s.jobs).orderBy(desc(s.jobs.createdAt)).limit(100).all(),
    ),
  )
  // Manual tick: same runner the tick sources call. Handy on self-hosted and for the Stage 2 exit check on Workers.
  .post('/tick', async (c) => {
    const ctx = c.get('ctx');
    return c.json(
      await runDueJobs(ctx.db, ctx.clock, jobHandlers(ctx), {
        maxJobs: 10,
        softDeadlineMs: 20_000,
      }),
    );
  });
