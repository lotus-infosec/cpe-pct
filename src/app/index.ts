// src/app/index.ts — one Hono app, mounted by both entrypoints.
// Stage 0 wires only the database and the clock. Ports from src/ports are added stage by stage.
import { Hono } from 'hono';
import { count } from 'drizzle-orm';
import type { Db } from '../db/client';
import { healthPings } from '../db/schema';
import type { Clock } from '../ports';

export interface AppContext {
  db: Db;
  clock: Clock;
}

export type App = ReturnType<typeof createApp>;

export function createApp(ctx: AppContext) {
  const app = new Hono();

  // Proves both targets write and read the same table through the same code.
  app.get('/api/health', async (c) => {
    const now = ctx.clock.now().toISOString();
    await ctx.db.insert(healthPings).values({ at: now });
    const [row] = await ctx.db.select({ n: count() }).from(healthPings);
    return c.json({ ok: true, pings: row?.n ?? 0, at: now });
  });

  app.notFound((c) => c.json({ error: 'not_found' }, 404));

  return app;
}
