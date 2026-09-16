import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { eq, inArray } from 'drizzle-orm';
import * as s from '../../db/schema';
import { newId, today, type Vars } from '../context';
import { validList } from '../query';
import { filterSortPage, heldListQuery, heldSummaries, needsStanding } from '../held-list';
import { firstCycle } from '../../core/rules';
import { latestRuleVersionId, loadRuleSet } from '../rulesets';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const heldBody = z.object({
  certificationId: z.string(),
  earnedOn: isoDate,
  certNumber: z.string().max(100).optional(),
  notes: z.string().max(2000).optional(),
  status: z.enum(['active', 'lapsed', 'retired', 'pursuing']).default('active'),
});

const heldList = heldListQuery({ sort: 'name', dir: 'asc' });

export const held = new Hono<Vars>()
  .get('/', validList(heldList), async (c) => {
    const { db, clock } = c.get('ctx');
    const p = c.req.valid('query');
    const all = await heldSummaries(db, today(clock), { withStanding: needsStanding(p) });
    const page = filterSortPage(all, p);
    return c.json({
      ...page,
      rows: page.rows.map((x) => ({
        ...x.held,
        certification: x.certification,
        body: x.body,
        cycles: x.cycles,
        derived: x.derived,
      })),
    });
  })
  .post('/', zValidator('json', heldBody), async (c) => {
    const { db } = c.get('ctx');
    const b = c.req.valid('json');
    const cert = await db
      .select()
      .from(s.certifications)
      .where(eq(s.certifications.id, b.certificationId))
      .get();
    if (!cert) return c.json({ error: 'unknown_certification' }, 400);
    const rvId = await latestRuleVersionId(db, cert.bodyId);
    const rs = rvId ? await loadRuleSet(db, rvId) : null;
    const req = rs?.requirements.find((r) => r.certificationId === cert.id);
    const id = newId();
    const heldRow = {
      id,
      certificationId: cert.id,
      certNumber: b.certNumber ?? null,
      earnedOn: b.earnedOn,
      status: b.status,
      notes: b.notes ?? null,
    };
    // Cycle auto-created from earned_on + cycle_months, pinned to the current rule version (D-020).
    const cycle = req && rvId ? firstCycle(id, b.earnedOn, req.cycleMonths, rvId, newId()) : null;
    if (cycle)
      await db.batch([
        db.insert(s.heldCertifications).values(heldRow),
        db.insert(s.cycles).values(cycle),
      ]);
    else await db.insert(s.heldCertifications).values(heldRow);
    return c.json({ ...heldRow, cycles: cycle ? [cycle] : [] }, 201);
  })
  .put(
    '/:id',
    zValidator('json', heldBody.partial().omit({ certificationId: true })),
    async (c) => {
      const { db } = c.get('ctx');
      const id = c.req.param('id');
      const existing = await db
        .select()
        .from(s.heldCertifications)
        .where(eq(s.heldCertifications.id, id))
        .get();
      if (!existing) return c.json({ error: 'not_found' }, 404);
      const b = c.req.valid('json');
      await db
        .update(s.heldCertifications)
        .set({
          ...(b.certNumber !== undefined && { certNumber: b.certNumber }),
          ...(b.notes !== undefined && { notes: b.notes }),
          ...(b.status !== undefined && { status: b.status }),
          ...(b.earnedOn !== undefined && { earnedOn: b.earnedOn }),
        })
        .where(eq(s.heldCertifications.id, id));
      return c.json({ ok: true });
    },
  )
  .delete('/:id', async (c) => {
    const { db } = c.get('ctx');
    const id = c.req.param('id');
    const cys = await db
      .select({ id: s.cycles.id })
      .from(s.cycles)
      .where(eq(s.cycles.heldCertId, id))
      .all();
    const cyIds = cys.map((x) => x.id);
    await db.batch([
      db.delete(s.creditApplications).where(eq(s.creditApplications.heldCertId, id)),
      ...(cyIds.length
        ? [
            db.delete(s.renewals).where(inArray(s.renewals.closedCycleId, cyIds)),
            db.delete(s.payments).where(inArray(s.payments.targetId, cyIds)),
          ]
        : []),
      db.delete(s.cycles).where(eq(s.cycles.heldCertId, id)),
      db.delete(s.heldCertifications).where(eq(s.heldCertifications.id, id)),
    ]);
    return c.json({ ok: true });
  });

const membershipBody = z.object({
  bodyId: z.string(),
  memberNumber: z.string().max(100).optional(),
  since: isoDate.optional(),
});

export const memberships = new Hono<Vars>()
  .get('/', async (c) => c.json(await c.get('ctx').db.select().from(s.memberships).all()))
  .post('/', zValidator('json', membershipBody), async (c) => {
    const { db } = c.get('ctx');
    const b = c.req.valid('json');
    const body = await db.select().from(s.bodies).where(eq(s.bodies.id, b.bodyId)).get();
    if (!body) return c.json({ error: 'unknown_body' }, 400);
    const row = {
      id: newId(),
      bodyId: b.bodyId,
      memberNumber: b.memberNumber ?? null,
      since: b.since ?? null,
    };
    await db.insert(s.memberships).values(row);
    return c.json(row, 201);
  })
  .delete('/:id', async (c) => {
    const { db } = c.get('ctx');
    await db.batch([
      db.delete(s.payments).where(eq(s.payments.targetId, c.req.param('id'))),
      db.delete(s.memberships).where(eq(s.memberships.id, c.req.param('id'))),
    ]);
    return c.json({ ok: true });
  });
