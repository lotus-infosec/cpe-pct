import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { desc, eq, getTableColumns, sql } from 'drizzle-orm';
import * as s from '../../db/schema';
import { newId, type Vars } from '../context';
import { resolveSelection, selectionBody } from '../activity-selection';

// The list reports how many activities a selection holds, not the ids themselves.
const { activityIds: _ids, ...exportColumns } = getTableColumns(s.exports_);
const listColumns = {
  ...exportColumns,
  activityCount: sql<number | null>`json_array_length(${s.exports_.activityIds})`,
};
const cycleBody = z.object({ cycleId: z.string() }).strict();

export const exportsRoute = new Hono<Vars>()
  .get('/', async (c) =>
    c.json(
      await c
        .get('ctx')
        .db.select(listColumns)
        .from(s.exports_)
        .orderBy(desc(s.exports_.createdAt))
        .limit(100)
        .all(),
    ),
  )
  // A cycle bundle, or a selection of activities (STAGE8: "export selection first").
  .post('/', zValidator('json', z.union([cycleBody, selectionBody])), async (c) => {
    const ctx = c.get('ctx');
    const b = c.req.valid('json');
    const id = newId();
    const base = {
      id,
      status: 'building' as const,
      progress: null,
      objectKey: null,
      createdAt: ctx.clock.now().toISOString(),
    };
    if ('cycleId' in b) {
      const cycle = await ctx.db
        .select({ cy: s.cycles, bodyId: s.certifications.bodyId })
        .from(s.cycles)
        .innerJoin(s.heldCertifications, eq(s.heldCertifications.id, s.cycles.heldCertId))
        .innerJoin(s.certifications, eq(s.certifications.id, s.heldCertifications.certificationId))
        .where(eq(s.cycles.id, b.cycleId))
        .get();
      if (!cycle) return c.json({ error: 'not_found' }, 404);
      await ctx.db
        .insert(s.exports_)
        .values({ ...base, bodyId: cycle.bodyId, cycleId: cycle.cy.id, activityIds: null });
    } else {
      const sel = await resolveSelection(ctx.db, b);
      if (!sel.ok) return c.json({ error: sel.error, matched: sel.matched }, sel.status);
      if (sel.ids.length === 0)
        return c.json({ error: 'nothing_selected', unknown: sel.unknown }, 400);
      await ctx.db
        .insert(s.exports_)
        .values({ ...base, bodyId: null, cycleId: null, activityIds: sel.ids });
    }
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
        'content-disposition': `attachment; filename="cpe-pct-export-${row.bodyId ?? 'selection'}-${row.id.slice(0, 8)}.zip"`,
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
