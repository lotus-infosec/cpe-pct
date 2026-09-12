import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { desc, eq } from 'drizzle-orm';
import * as s from '../../db/schema';
import { newId, type Vars } from '../context';

export const exportsRoute = new Hono<Vars>()
  .get('/', async (c) =>
    c.json(
      await c
        .get('ctx')
        .db.select()
        .from(s.exports_)
        .orderBy(desc(s.exports_.createdAt))
        .limit(100)
        .all(),
    ),
  )
  .post('/', zValidator('json', z.object({ cycleId: z.string() })), async (c) => {
    const ctx = c.get('ctx');
    const cycle = await ctx.db
      .select({ cy: s.cycles, bodyId: s.certifications.bodyId })
      .from(s.cycles)
      .innerJoin(s.heldCertifications, eq(s.heldCertifications.id, s.cycles.heldCertId))
      .innerJoin(s.certifications, eq(s.certifications.id, s.heldCertifications.certificationId))
      .where(eq(s.cycles.id, c.req.valid('json').cycleId))
      .get();
    if (!cycle) return c.json({ error: 'not_found' }, 404);
    const id = newId();
    const now = ctx.clock.now().toISOString();
    await ctx.db.insert(s.exports_).values({
      id,
      bodyId: cycle.bodyId,
      cycleId: cycle.cy.id,
      status: 'building',
      progress: null,
      objectKey: null,
      createdAt: now,
    });
    await ctx.jobQueue.enqueue(
      'build_export',
      { exportId: id },
      { idempotencyKey: `build_export:${id}` },
    );
    return c.json({ id, status: 'building' }, 202);
  })
  .get('/:id', async (c) => {
    const row = await c
      .get('ctx')
      .db.select()
      .from(s.exports_)
      .where(eq(s.exports_.id, c.req.param('id')))
      .get();
    return row ? c.json(row) : c.json({ error: 'not_found' }, 404);
  })
  .get('/:id/download', async (c) => {
    const { db, objectStore } = c.get('ctx');
    const row = await db
      .select()
      .from(s.exports_)
      .where(eq(s.exports_.id, c.req.param('id')))
      .get();
    if (!row || row.status !== 'ready' || !row.objectKey)
      return c.json({ error: 'not_ready' }, 409);
    const obj = await objectStore.get(row.objectKey);
    if (!obj) return c.json({ error: 'object_missing' }, 404);
    return new Response(obj.body, {
      headers: {
        'content-type': 'application/zip',
        'content-length': String(obj.size),
        'content-disposition': `attachment; filename="cpe-pct-export-${row.bodyId}-${row.id.slice(0, 8)}.zip"`,
      },
    });
  })
  .delete('/:id', async (c) => {
    const { db, objectStore } = c.get('ctx');
    const row = await db
      .select()
      .from(s.exports_)
      .where(eq(s.exports_.id, c.req.param('id')))
      .get();
    if (!row) return c.json({ error: 'not_found' }, 404);
    await db.delete(s.exports_).where(eq(s.exports_.id, row.id));
    if (row.objectKey) await objectStore.delete(row.objectKey);
    return c.json({ ok: true });
  });
