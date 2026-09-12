import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import * as s from '../../db/schema';
import { newId, today, type Vars } from '../context';
import { rollover, standing } from '../../core/rules';
import { latestRuleVersionId, loadRuleSet, standingContext } from '../rulesets';

export const cycles = new Hono<Vars>()
  .get('/', async (c) => c.json(await c.get('ctx').db.select().from(s.cycles).all()))
  .get('/:id/standing', async (c) => {
    const { db, clock } = c.get('ctx');
    const cycle = await db
      .select()
      .from(s.cycles)
      .where(eq(s.cycles.id, c.req.param('id')))
      .get();
    if (!cycle) return c.json({ error: 'not_found' }, 404);
    const asOf = c.req.query('asOf') ?? today(clock);
    const ctx = await standingContext(db, cycle, asOf);
    if (!ctx) return c.json({ error: 'rule_version_missing' }, 500);
    return c.json(standing(cycle, ctx));
  })
  .post(
    '/:id/renew',
    zValidator(
      'json',
      z.object({
        renewedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        issuerConfirmation: z.string().max(200).optional(),
        notes: z.string().max(2000).optional(),
      }),
    ),
    async (c) => {
      const { db } = c.get('ctx');
      const cycle = await db
        .select()
        .from(s.cycles)
        .where(eq(s.cycles.id, c.req.param('id')))
        .get();
      if (!cycle) return c.json({ error: 'not_found' }, 404);
      if (cycle.status !== 'open') return c.json({ error: 'cycle_not_open' }, 409);
      const held = await db
        .select({ h: s.heldCertifications, bodyId: s.certifications.bodyId })
        .from(s.heldCertifications)
        .innerJoin(s.certifications, eq(s.certifications.id, s.heldCertifications.certificationId))
        .where(eq(s.heldCertifications.id, cycle.heldCertId))
        .get();
      if (!held) return c.json({ error: 'held_missing' }, 500);
      // The new cycle pins the CURRENT version: an explicit choice at renewal time, never a silent change to an open cycle.
      const rvId = (await latestRuleVersionId(db, held.bodyId)) ?? cycle.ruleVersionId;
      const rs = await loadRuleSet(db, rvId);
      const req = rs?.requirements.find((r) => r.certificationId === held.h.certificationId);
      if (!req) return c.json({ error: 'no_requirement' }, 409);
      const b = c.req.valid('json');
      const { closed, opened } = rollover(cycle, {
        renewedOn: b.renewedOn,
        ruleVersionId: rvId,
        cycleMonths: req.cycleMonths,
        newCycleId: newId(),
      });
      await db.batch([
        db.update(s.cycles).set({ status: closed.status }).where(eq(s.cycles.id, cycle.id)),
        db.insert(s.cycles).values(opened),
        db.insert(s.renewals).values({
          id: newId(),
          closedCycleId: cycle.id,
          openedCycleId: opened.id,
          renewedOn: b.renewedOn,
          issuerConfirmation: b.issuerConfirmation ?? null,
          notes: b.notes ?? null,
        }),
      ]);
      return c.json({ closed, opened }, 201);
    },
  );
