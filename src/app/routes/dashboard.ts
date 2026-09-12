import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import * as s from '../../db/schema';
import { today, type Vars } from '../context';
import { standing } from '../../core/rules';
import { standingContext } from '../rulesets';

export const dashboard = new Hono<Vars>().get('/', async (c) => {
  const { db, clock } = c.get('ctx');
  const asOf = today(clock);
  const rows = await db
    .select({ held: s.heldCertifications, cert: s.certifications, body: s.bodies })
    .from(s.heldCertifications)
    .innerJoin(s.certifications, eq(s.certifications.id, s.heldCertifications.certificationId))
    .innerJoin(s.bodies, eq(s.bodies.id, s.certifications.bodyId))
    .all();
  const cycles = await db.select().from(s.cycles).all();
  const versions = await db.select().from(s.ruleVersions).all();
  const out = [];
  for (const r of rows) {
    const open = cycles.find((cy) => cy.heldCertId === r.held.id && cy.status === 'open') ?? null;
    let st = null;
    if (open) {
      const ctx = await standingContext(db, open, asOf);
      if (ctx) st = standing(open, ctx);
    }
    out.push({
      held: r.held,
      certification: r.cert,
      body: r.body,
      cycle: open,
      ruleVersion: open ? (versions.find((v) => v.id === open.ruleVersionId) ?? null) : null,
      standing: st && {
        compliant: st.compliant,
        daysRemaining: st.daysRemaining,
        totals: st.totals,
        requiredX100: st.requiredX100,
        failing: st.constraints
          .filter((x) => !x.satisfied)
          .map((x) => ({ type: x.type, severity: x.severity, overdue: x.overdue, due: x.due })),
        projectedAtCycleEnd: st.projectedAtCycleEnd,
      },
    });
  }
  return c.json({ asOf, items: out });
});
