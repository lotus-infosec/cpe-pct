// src/app/index.ts — one Hono app, mounted by both entrypoints.
import { Hono } from 'hono';
import { count } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { healthPings } from '../db/schema';
import type { AppContext, Vars } from './context';
import { auth } from './routes/auth';
import { catalog } from './routes/catalog';
import { held, memberships } from './routes/held';
import { activities, applications } from './routes/activities';
import { cycles } from './routes/cycles';
import { payments } from './routes/payments';
import { importRoute } from './routes/import';
import { dashboard } from './routes/dashboard';
import { activityEvidenceRoute, evidence } from './routes/evidence';
import { jobsRoute } from './routes/jobs';
import { runDueJobs } from '../adapters/shared/db-job-queue';
import { jobHandlers } from './jobs/extract-text';
import type { TickBudget } from '../ports';

export type { AppContext } from './context';
export type App = ReturnType<typeof createApp>;

const PUBLIC = new Set(['GET /api/health', 'GET /api/setup', 'POST /api/setup', 'POST /api/login']);

export function createApp(ctx: AppContext) {
  const app = new Hono<Vars>();

  app.use('*', async (c, next) => {
    c.set('ctx', ctx);
    c.set('principal', await ctx.auth.authenticate(c.req.raw));
    await next();
  });

  // CSRF: mutating requests must come from our own origin when a browser sends Origin.
  app.use('/api/*', async (c, next) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(c.req.method)) {
      const origin = c.req.header('origin');
      if (origin && origin !== new URL(c.req.url).origin)
        return c.json({ error: 'bad_origin' }, 403);
    }
    await next();
  });

  app.use('/api/*', async (c, next) => {
    const key = `${c.req.method} ${new URL(c.req.url).pathname}`;
    if (!PUBLIC.has(key) && !c.get('principal')) return c.json({ error: 'unauthenticated' }, 401);
    await next();
  });

  app.get('/api/health', async (c) => {
    const now = ctx.clock.now().toISOString();
    await ctx.db.insert(healthPings).values({ at: now });
    const [row] = await ctx.db.select({ n: count() }).from(healthPings);
    return c.json({ ok: true, pings: row?.n ?? 0, at: now });
  });

  app.route('/api', auth);
  app.route('/api/catalog', catalog);
  app.route('/api/held', held);
  app.route('/api/memberships', memberships);
  app.route('/api/activities', activities);
  app.route('/api/applications', applications);
  app.route('/api/cycles', cycles);
  app.route('/api/payments', payments);
  app.route('/api/import', importRoute);
  app.route('/api/dashboard', dashboard);
  app.route('/api/evidence', evidence);
  app.route('/api/activities', activityEvidenceRoute);
  app.route('/api/jobs', jobsRoute);

  app.notFound((c) => c.json({ error: 'not_found' }, 404));
  app.onError((err, c) => {
    if (err instanceof HTTPException) return err.getResponse();
    console.error(err);
    return c.json({ error: 'internal', message: err.message }, 500);
  });

  return app;
}

/** The one job runner, called by IntervalTickSource (Node) and scheduled() (Workers). */
export function tick(ctx: AppContext, budget: TickBudget) {
  return runDueJobs(ctx.db, ctx.clock, jobHandlers(ctx), budget);
}
