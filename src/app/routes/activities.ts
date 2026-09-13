import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { desc, eq, inArray } from 'drizzle-orm';
import * as s from '../../db/schema';
import { newId, today, type Vars } from '../context';
import { ACTIVITY_TYPES } from '../../core/domain/activity-types';
import { resolve, standing } from '../../core/rules';
import { resolveContext, standingContext } from '../rulesets';
import { inRange } from '../../core/cycles/dates';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const activityBody = z.object({
  title: z.string().min(1).max(300),
  occurredOn: isoDate,
  activityType: z.enum(ACTIVITY_TYPES),
  provider: z.string().max(300).optional(),
  durationMinutes: z.number().int().nonnegative().max(100_000).optional(),
  itemCount: z.number().int().positive().max(1000).optional(),
  description: z.string().max(5000).optional(),
  relatedCertificationId: z.string().max(200).optional(),
});

const toDomain = (a: typeof s.activities.$inferSelect) => ({
  id: a.id,
  activityType: a.activityType as (typeof ACTIVITY_TYPES)[number],
  occurredOn: a.occurredOn,
  durationMinutes: a.durationMinutes,
  itemCount: a.itemCount,
  title: a.title,
  relatedCertificationId: a.description?.match(/^related:(\S+)/)?.[1] ?? null,
});

export const activities = new Hono<Vars>()
  .get('/', async (c) => {
    const { db } = c.get('ctx');
    const rows = await db
      .select()
      .from(s.activities)
      .orderBy(desc(s.activities.occurredOn), desc(s.activities.createdAt))
      .all();
    const apps = await db.select().from(s.creditApplications).all();
    return c.json(
      rows.map((a) => ({ ...a, applications: apps.filter((x) => x.activityId === a.id) })),
    );
  })
  .post('/', zValidator('json', activityBody), async (c) => {
    const { db, clock } = c.get('ctx');
    const b = c.req.valid('json');
    const row: typeof s.activities.$inferInsert = {
      id: newId(),
      title: b.title,
      occurredOn: b.occurredOn,
      provider: b.provider ?? null,
      durationMinutes: b.durationMinutes ?? null,
      itemCount: b.itemCount ?? 1,
      activityType: b.activityType,
      description:
        [
          b.relatedCertificationId ? `related:${b.relatedCertificationId}` : null,
          b.description ?? null,
        ]
          .filter(Boolean)
          .join('\n') || null,
      source: 'manual',
      status: 'draft',
      createdAt: clock.now().toISOString(),
    };
    await db.insert(s.activities).values(row);
    return c.json(row, 201);
  })
  .get('/:id', async (c) => {
    const { db } = c.get('ctx');
    const a = await db
      .select()
      .from(s.activities)
      .where(eq(s.activities.id, c.req.param('id')))
      .get();
    if (!a) return c.json({ error: 'not_found' }, 404);
    const apps = await db
      .select()
      .from(s.creditApplications)
      .where(eq(s.creditApplications.activityId, a.id))
      .all();
    return c.json({ ...a, applications: apps });
  })
  .put('/:id', zValidator('json', activityBody.partial()), async (c) => {
    const { db } = c.get('ctx');
    const id = c.req.param('id');
    const a = await db.select().from(s.activities).where(eq(s.activities.id, id)).get();
    if (!a) return c.json({ error: 'not_found' }, 404);
    const b = c.req.valid('json');
    await db
      .update(s.activities)
      .set({
        ...(b.title !== undefined && { title: b.title }),
        ...(b.occurredOn !== undefined && { occurredOn: b.occurredOn }),
        ...(b.activityType !== undefined && { activityType: b.activityType }),
        ...(b.provider !== undefined && { provider: b.provider }),
        ...(b.durationMinutes !== undefined && { durationMinutes: b.durationMinutes }),
        ...(b.itemCount !== undefined && { itemCount: b.itemCount }),
        ...(b.description !== undefined && { description: b.description }),
      })
      .where(eq(s.activities.id, id));
    return c.json({ ok: true });
  })
  .delete('/:id', async (c) => {
    const { db } = c.get('ctx');
    const id = c.req.param('id');
    await db.batch([
      db.delete(s.creditApplications).where(eq(s.creditApplications.activityId, id)),
      db.delete(s.activityEvidence).where(eq(s.activityEvidence.activityId, id)),
      db.delete(s.activities).where(eq(s.activities.id, id)),
    ]);
    return c.json({ ok: true });
  })
  // Fan-out: pure engine over the loaded context. Never writes.
  .get('/:id/fanout', async (c) => {
    const { db, clock } = c.get('ctx');
    const a = await db
      .select()
      .from(s.activities)
      .where(eq(s.activities.id, c.req.param('id')))
      .get();
    if (!a) return c.json({ error: 'not_found' }, 404);
    const ctx = await resolveContext(db, today(clock));
    const suggestions = resolve(toDomain(a), ctx);
    const existing = await db
      .select()
      .from(s.creditApplications)
      .where(eq(s.creditApplications.activityId, a.id))
      .all();
    const certs = await db.select().from(s.certifications).all();
    return c.json({
      activity: a,
      suggestions: suggestions.map((sg) => ({
        ...sg,
        certification: certs.find((x) => x.id === sg.certificationId) ?? null,
      })),
      existing,
      heldWithoutSuggestion: ctx.held
        .filter((h) => h.status === 'active' && !suggestions.some((sg) => sg.heldCertId === h.id))
        .map((h) => ({
          heldCertId: h.id,
          certificationId: h.certificationId,
          cycle:
            ctx.cycles.find(
              (cy) => cy.heldCertId === h.id && inRange(a.occurredOn, cy.startsOn, cy.endsOn),
            ) ?? null,
        })),
    });
  })
  // Confirm/override: writes claimed applications in one batch. Overrides need a reason.
  .post(
    '/:id/applications',
    zValidator(
      'json',
      z.object({
        applications: z
          .array(
            z.object({
              heldCertId: z.string(),
              creditsX100: z.number().int().nonnegative(),
              categoryKey: z.string().nullable().optional(),
              overrideReason: z.string().max(1000).optional(),
            }),
          )
          .min(1),
      }),
    ),
    async (c) => {
      const { db, clock } = c.get('ctx');
      const a = await db
        .select()
        .from(s.activities)
        .where(eq(s.activities.id, c.req.param('id')))
        .get();
      if (!a) return c.json({ error: 'not_found' }, 404);
      const asOf = today(clock);
      const ctx = await resolveContext(db, asOf);
      const suggestions = resolve(toDomain(a), ctx);
      const rows: (typeof s.creditApplications.$inferInsert)[] = [];
      const errors: string[] = [];
      // One row per (activity, held cert) is a unique index; a repeated heldCertId in the payload
      // would reach the batch and fail as a constraint error instead of a validation error.
      const seen = new Set<string>();
      for (const app of c.req.valid('json').applications) {
        if (seen.has(app.heldCertId)) {
          errors.push(`${app.heldCertId}: listed more than once`);
          continue;
        }
        seen.add(app.heldCertId);
        const sg = suggestions.find((x) => x.heldCertId === app.heldCertId && x.kind === 'credit');
        const cycle = ctx.cycles.find(
          (cy) =>
            cy.heldCertId === app.heldCertId &&
            cy.status === 'open' &&
            inRange(a.occurredOn, cy.startsOn, cy.endsOn),
        );
        if (!cycle) {
          errors.push(`${app.heldCertId}: no open cycle contains ${a.occurredOn}`);
          continue;
        }
        const overridden =
          !sg ||
          sg.creditsX100 !== app.creditsX100 ||
          (app.categoryKey ?? sg.categoryKey) !== sg.categoryKey;
        if (overridden && !app.overrideReason) {
          errors.push(`${app.heldCertId}: override reason required`);
          continue;
        }
        rows.push({
          id: newId(),
          activityId: a.id,
          heldCertId: app.heldCertId,
          cycleId: cycle.id,
          creditsX100: app.creditsX100,
          categoryKey: app.categoryKey ?? sg?.categoryKey ?? null,
          status: 'claimed',
          ruleVersionId: cycle.ruleVersionId,
          creditingRuleId: sg?.creditingRuleId ?? null,
          suggestedCreditsX100: sg?.creditsX100 ?? null,
          overrideReason: overridden ? app.overrideReason! : null,
          explanation: sg
            ? { explain: sg.explain, warnings: sg.warnings, coveredBy: sg.coveredBy }
            : { explain: ['manual override; no rule matched'], warnings: [] },
        });
      }
      if (errors.length) return c.json({ error: 'invalid_applications', details: errors }, 400);
      const heldIds = rows.map((r) => r.heldCertId);
      await db.batch([
        db.delete(s.creditApplications).where(eq(s.creditApplications.activityId, a.id)),
        ...rows.map((r) => db.insert(s.creditApplications).values(r)),
        db.update(s.activities).set({ status: 'logged' }).where(eq(s.activities.id, a.id)),
      ]);
      void heldIds;
      const standings = [];
      for (const cycleId of new Set(rows.map((r) => r.cycleId))) {
        const cycle = ctx.cycles.find((cy) => cy.id === cycleId)!;
        const sctx = await standingContext(db, cycle, asOf);
        if (sctx) standings.push(standing(cycle, sctx));
      }
      return c.json({ applications: rows, standings }, 201);
    },
  );

const TRANSITIONS: Record<string, string[]> = {
  planned: ['claimed'],
  claimed: ['submitted', 'accepted'],
  submitted: ['accepted', 'rejected', 'claimed'],
  rejected: ['claimed'],
  accepted: ['submitted'],
};

export const applications = new Hono<Vars>()
  .patch(
    '/:id',
    zValidator(
      'json',
      z.object({
        status: z.enum(['planned', 'claimed', 'submitted', 'accepted', 'rejected']),
        issuerReference: z.string().max(200).optional(),
      }),
    ),
    async (c) => {
      const { db, clock } = c.get('ctx');
      const id = c.req.param('id');
      const row = await db
        .select()
        .from(s.creditApplications)
        .where(eq(s.creditApplications.id, id))
        .get();
      if (!row) return c.json({ error: 'not_found' }, 404);
      const { status, issuerReference } = c.req.valid('json');
      if (!TRANSITIONS[row.status]?.includes(status))
        return c.json({ error: 'invalid_transition', from: row.status, to: status }, 409);
      const now = clock.now().toISOString();
      await db
        .update(s.creditApplications)
        .set({
          status,
          ...(status === 'submitted' && { submittedAt: now }),
          ...((status === 'accepted' || status === 'rejected') && { resolvedAt: now }),
          ...(issuerReference !== undefined && { issuerReference }),
        })
        .where(eq(s.creditApplications.id, id));
      return c.json({ ok: true });
    },
  )
  .delete('/:id', async (c) => {
    const { db } = c.get('ctx');
    await db.delete(s.creditApplications).where(eq(s.creditApplications.id, c.req.param('id')));
    return c.json({ ok: true });
  })
  .get('/', async (c) => {
    const { db } = c.get('ctx');
    const ids = c.req.query('cycleId');
    const q = db.select().from(s.creditApplications);
    return c.json(
      ids
        ? await q.where(inArray(s.creditApplications.cycleId, ids.split(','))).all()
        : await q.all(),
    );
  });
