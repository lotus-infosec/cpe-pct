import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { desc, eq } from 'drizzle-orm';
import * as s from '../../db/schema';
import { today, type Vars } from '../context';
import { readSettings, renewalScan, sendPending } from '../jobs/renewal-scan';
import { notifiersFromSettings } from '../../adapters/shared/notifiers';

export const notificationsRoute = new Hono<Vars>()
  .get('/', async (c) =>
    c.json(
      await c
        .get('ctx')
        .db.select()
        .from(s.notifications)
        .orderBy(desc(s.notifications.createdAt))
        .limit(200)
        .all(),
    ),
  )
  .post('/:id/read', async (c) => {
    await c
      .get('ctx')
      .db.update(s.notifications)
      .set({ status: 'read' })
      .where(eq(s.notifications.id, c.req.param('id')));
    return c.json({ ok: true });
  })
  .post('/read-all', async (c) => {
    await c
      .get('ctx')
      .db.update(s.notifications)
      .set({ status: 'read' })
      .where(eq(s.notifications.status, 'sent'));
    return c.json({ ok: true });
  })
  // Manual scan (same code the daily job runs). asOf may be overridden for what-if checks.
  .post(
    '/scan',
    zValidator(
      'json',
      z
        .object({
          asOf: z
            .string()
            .regex(/^\d{4}-\d{2}-\d{2}$/)
            .optional(),
        })
        .optional(),
    ),
    async (c) => {
      const ctx = c.get('ctx');
      return c.json(await renewalScan(ctx, c.req.valid('json')?.asOf ?? today(ctx.clock)));
    },
  )
  .post('/retry', async (c) => c.json(await sendPending(c.get('ctx'))));

const SETTING_KEYS = ['notify.webhook_url', 'notify.discord_url'] as const;
const url = z.string().url().max(2000).or(z.literal(''));

export const settingsRoute = new Hono<Vars>()
  .get('/', async (c) => c.json(await readSettings(c.get('ctx'), [...SETTING_KEYS])))
  .put(
    '/',
    zValidator(
      'json',
      z.object({ 'notify.webhook_url': url.optional(), 'notify.discord_url': url.optional() }),
    ),
    async (c) => {
      const ctx = c.get('ctx');
      const now = ctx.clock.now().toISOString();
      const body = c.req.valid('json');
      const ops = [];
      for (const key of SETTING_KEYS) {
        const v = body[key];
        if (v === undefined) continue;
        ops.push(
          v === ''
            ? ctx.db.delete(s.settings).where(eq(s.settings.key, key))
            : ctx.db
                .insert(s.settings)
                .values({ key, value: v, updatedAt: now })
                .onConflictDoUpdate({ target: s.settings.key, set: { value: v, updatedAt: now } }),
        );
      }
      if (ops.length) await ctx.db.batch(ops as [(typeof ops)[number], ...typeof ops]);
      return c.json(await readSettings(ctx, [...SETTING_KEYS]));
    },
  )
  .post('/test-send', async (c) => {
    const ctx = c.get('ctx');
    const notifiers = notifiersFromSettings(await readSettings(ctx, [...SETTING_KEYS]));
    if (!notifiers.length) return c.json({ error: 'no_notifiers_configured' }, 400);
    const results = await Promise.all(
      notifiers.map((n) =>
        n.send({
          key: `test:${Date.now()}`,
          kind: 'export_ready',
          severity: 'info',
          title: 'CPE PCT test notification',
          body: 'If you can read this, notifications work.',
        }),
      ),
    );
    return c.json({ results });
  });
