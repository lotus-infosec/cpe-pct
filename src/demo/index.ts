// src/demo/index.ts — the public demo (demo branch only). Wraps the normal app rather than changing it:
// every request is the owner, routes that would turn a public instance into file hosting or an open
// relay are refused, growth is capped, and a cron empties user data on a fixed 12-hour schedule.
import { Hono, type Context } from 'hono';
import { count, getTableName, sql } from 'drizzle-orm';
import type { SQLiteTable } from 'drizzle-orm/sqlite-core';
import { createApp, type AppContext } from '../app';
import { TABLES } from '../app/backup';
import { parseCsv } from '../app/routes/import';
import * as s from '../db/schema';
import type { Authenticator } from '../ports';

export const DEMO_LIMITS = {
  heldCertifications: 10,
  activities: 100,
  memberships: 10,
  evidenceFiles: 20,
  evidenceBytes: 2 * 1024 * 1024,
  exports: 10,
};
export type DemoLimits = typeof DEMO_LIMITS;

/** 00:00 and 12:00 UTC. The Worker's second cron trigger; must match wrangler.demo.jsonc. */
export const DEMO_RESET_CRON = '0 */12 * * *';
const RESET_HOURS = 12;

export const demoAuth: Authenticator = {
  routes: 'none',
  authenticate: async () => ({ id: 'owner', via: 'demo' }),
};

/** Catalog tables survive a reset; everything a visitor can create does not. */
const CATALOG = new Set<unknown>([
  s.bodies,
  s.certifications,
  s.ruleVersions,
  s.certRequirements,
  s.creditCategories,
  s.creditingRules,
  s.constraints,
  s.certRelations,
]);

/** Children before parents: the reverse of the backup order, which lists parents first. */
const USER_TABLES = [...TABLES].reverse().filter((t) => !CATALOG.has(t));

export function nextResetAt(now: Date): Date {
  const next = new Date(now);
  next.setUTCMinutes(0, 0, 0);
  next.setUTCHours((Math.floor(now.getUTCHours() / RESET_HOURS) + 1) * RESET_HOURS);
  return next;
}

/** Empties user data in one batch (atomic on D1), then the evidence and export objects. */
export async function resetDemo(ctx: AppContext): Promise<void> {
  const stmts = USER_TABLES.map((t) => ctx.db.run(sql.raw(`DELETE FROM "${getTableName(t)}"`)));
  await ctx.db.batch(stmts as [(typeof stmts)[number], ...typeof stmts]);
  for (const prefix of ['evidence/', 'exports/'])
    for await (const o of ctx.objectStore.list(prefix)) await ctx.objectStore.delete(o.key);
}

async function rows(ctx: AppContext, table: SQLiteTable) {
  const [r] = await ctx.db.select({ n: count() }).from(table);
  return r?.n ?? 0;
}

async function usage(ctx: AppContext) {
  return {
    heldCertifications: await rows(ctx, s.heldCertifications),
    activities: await rows(ctx, s.activities),
    memberships: await rows(ctx, s.memberships),
    evidenceFiles: await rows(ctx, s.evidence),
    exports: await rows(ctx, s.exports_),
  };
}

const OFF = 'Turned off in the public demo.';

/** Routes a public, unauthenticated instance must not serve. Method, then a path pattern. */
const BLOCKED: [string, RegExp, string][] = [
  ['POST', /^\/api\/(setup|login|logout)$/, 'The public demo has no accounts.'],
  ['PUT', /^\/api\/settings$/, `Notification settings are ${OFF.toLowerCase()}`],
  ['POST', /^\/api\/settings\/test-send$/, `Notification sends are ${OFF.toLowerCase()}`],
  ['GET', /^\/api\/backup$/, `Backup downloads are ${OFF.toLowerCase()}`],
  ['POST', /^\/api\/backup\/restore$/, `Restore is ${OFF.toLowerCase()}`],
  [
    'GET',
    /^\/api\/evidence\/[^/]+\/content$/,
    'Uploaded files are never served back in the public demo.',
  ],
  ['GET', /^\/api\/exports\/[^/]+\/download$/, `Export downloads are ${OFF.toLowerCase()}`],
];

const full = (c: Context, what: string, limit: number) =>
  c.json(
    {
      error: `The public demo holds at most ${limit} ${what}. It empties every ${RESET_HOURS} hours.`,
    },
    409,
  );

export function demoApp(ctx: AppContext, limits: DemoLimits = DEMO_LIMITS) {
  const root = new Hono();

  root.use('/api/*', async (c, next) => {
    const { method } = c.req;
    const path = new URL(c.req.url).pathname;
    for (const [m, re, message] of BLOCKED)
      if (m === method && re.test(path)) return c.json({ error: message }, 403);
    if (method !== 'POST') return next();

    if (path === '/api/held') {
      if ((await rows(ctx, s.heldCertifications)) >= limits.heldCertifications)
        return full(c, 'certifications', limits.heldCertifications);
    } else if (path === '/api/memberships') {
      if ((await rows(ctx, s.memberships)) >= limits.memberships)
        return full(c, 'memberships', limits.memberships);
    } else if (path === '/api/activities') {
      if ((await rows(ctx, s.activities)) >= limits.activities)
        return full(c, 'activities', limits.activities);
    } else if (path === '/api/exports') {
      if ((await rows(ctx, s.exports_)) >= limits.exports)
        return full(c, 'exports', limits.exports);
    } else if (path === '/api/import') {
      const body = (await c.req.raw
        .clone()
        .json()
        .catch(() => null)) as { csv?: unknown } | null;
      if (body && typeof body.csv === 'string') {
        const incoming = parseCsv(body.csv).length;
        if ((await rows(ctx, s.activities)) + incoming > limits.activities)
          return full(c, 'activities', limits.activities);
      }
    } else if (path === '/api/evidence') {
      const declared = Number(c.req.header('content-length') ?? 0);
      if (declared > limits.evidenceBytes + 4096)
        return c.json(
          {
            error: `Uploads in the public demo are limited to ${limits.evidenceBytes / 1024 / 1024} MB.`,
          },
          413,
        );
      const form = await c.req.raw
        .clone()
        .formData()
        .catch(() => null);
      const file = form?.get('file');
      if (file instanceof File && file.size > limits.evidenceBytes)
        return c.json(
          {
            error: `Uploads in the public demo are limited to ${limits.evidenceBytes / 1024 / 1024} MB.`,
          },
          413,
        );
      if ((await rows(ctx, s.evidence)) >= limits.evidenceFiles)
        return full(c, 'uploaded files', limits.evidenceFiles);
      // An upload without an activity creates a draft activity, so it counts toward that cap too.
      if (!form?.get('activityId') && (await rows(ctx, s.activities)) >= limits.activities)
        return full(c, 'activities', limits.activities);
    }
    return next();
  });

  // Nothing to set up: the demo is always "set up", so the web app goes straight to the dashboard.
  root.get('/api/setup', (c) => c.json({ setUp: true }));
  root.get('/api/demo', async (c) =>
    c.json({
      limits,
      used: await usage(ctx),
      resetEveryHours: RESET_HOURS,
      nextResetAt: nextResetAt(ctx.clock.now()).toISOString(),
    }),
  );

  root.route('/', createApp({ ...ctx, extraAuth: { mode: 'grant', authenticator: demoAuth } }));
  // A mounted app's notFound does not apply to the parent; keep unknown API paths JSON.
  root.all('/api/*', (c) => c.json({ error: 'not_found' }, 404));
  return root;
}
