import { Hono } from 'hono';
import { desc, eq } from 'drizzle-orm';
import * as s from '../../db/schema';
import type { Vars } from '../context';
import {
  ACTIVITY_TYPE_LABELS,
  ACTIVITY_TYPES,
  ITEM_BASED_TYPES,
} from '../../core/domain/activity-types';

export const catalog = new Hono<Vars>()
  .get('/', async (c) => {
    const db = c.get('ctx').db;
    const [bodies, certs, versions, reqs] = await Promise.all([
      db.select().from(s.bodies).all(),
      db.select().from(s.certifications).all(),
      db.select().from(s.ruleVersions).orderBy(desc(s.ruleVersions.version)).all(),
      db.select().from(s.certRequirements).all(),
    ]);
    const out = bodies.map((b) => {
      const current = versions.find((v) => v.bodyId === b.id) ?? null;
      return {
        ...b,
        currentVersion: current && {
          id: current.id,
          version: current.version,
          effectiveFrom: current.effectiveFrom,
          verifiedOn: current.verifiedOn,
          sourceUrl: current.sourceUrl,
          sourceTitle: current.sourceTitle,
        },
        certifications: certs
          .filter((x) => x.bodyId === b.id)
          .map((x) => ({
            ...x,
            requirement: current
              ? (reqs.find((r) => r.ruleVersionId === current.id && r.certificationId === x.id) ??
                null)
              : null,
          })),
      };
    });
    return c.json({ bodies: out });
  })
  .get('/activity-types', (c) =>
    c.json(
      ACTIVITY_TYPES.map((t) => ({
        key: t,
        label: ACTIVITY_TYPE_LABELS[t],
        itemBased: ITEM_BASED_TYPES.has(t),
      })),
    ),
  )
  .get('/versions/:id', async (c) => {
    const db = c.get('ctx').db;
    const rv = await db
      .select()
      .from(s.ruleVersions)
      .where(eq(s.ruleVersions.id, c.req.param('id')))
      .get();
    if (!rv) return c.json({ error: 'not_found' }, 404);
    const [rules, cons, cats, rels] = await Promise.all([
      db.select().from(s.creditingRules).where(eq(s.creditingRules.ruleVersionId, rv.id)).all(),
      db.select().from(s.constraints).where(eq(s.constraints.ruleVersionId, rv.id)).all(),
      db.select().from(s.creditCategories).where(eq(s.creditCategories.ruleVersionId, rv.id)).all(),
      db.select().from(s.certRelations).where(eq(s.certRelations.ruleVersionId, rv.id)).all(),
    ]);
    return c.json({
      ...rv,
      creditingRules: rules,
      constraints: cons,
      categories: cats,
      relations: rels,
    });
  });
