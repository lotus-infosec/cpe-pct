import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import * as s from '../../db/schema';
import { newId, type Vars } from '../context';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const body = z.object({
  targetType: z.enum(['cycle', 'membership']),
  targetId: z.string(),
  periodStart: isoDate,
  periodEnd: isoDate,
  dueOn: isoDate,
  amountCents: z.number().int().nonnegative(),
  currency: z.string().length(3).default('USD'),
  paidOn: isoDate.optional(),
  confirmationRef: z.string().max(200).optional(),
  status: z.enum(['due', 'paid', 'waived']).default('due'),
  waiveReason: z.string().max(500).optional(),
});

export const payments = new Hono<Vars>()
  .get('/', async (c) => c.json(await c.get('ctx').db.select().from(s.payments).all()))
  .post('/', zValidator('json', body), async (c) => {
    const { db } = c.get('ctx');
    const b = c.req.valid('json');
    const row = {
      id: newId(),
      ...b,
      paidOn: b.paidOn ?? null,
      confirmationRef: b.confirmationRef ?? null,
      waiveReason: b.waiveReason ?? null,
    };
    await db.insert(s.payments).values(row);
    return c.json(row, 201);
  })
  .patch('/:id', zValidator('json', body.partial()), async (c) => {
    const { db } = c.get('ctx');
    const b = c.req.valid('json');
    const existing = await db
      .select()
      .from(s.payments)
      .where(eq(s.payments.id, c.req.param('id')))
      .get();
    if (!existing) return c.json({ error: 'not_found' }, 404);
    await db.update(s.payments).set(b).where(eq(s.payments.id, existing.id));
    return c.json({ ok: true });
  })
  .delete('/:id', async (c) => {
    await c
      .get('ctx')
      .db.delete(s.payments)
      .where(eq(s.payments.id, c.req.param('id')));
    return c.json({ ok: true });
  });
