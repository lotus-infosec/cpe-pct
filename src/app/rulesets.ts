// Loads catalog rule sets and engine contexts from the database as plain objects.
// This is the only place Drizzle rows are shaped into src/core types.
import { and, desc, eq, inArray, ne } from 'drizzle-orm';
import type { Db } from '../db/client';
import * as s from '../db/schema';
import type {
  Constraint,
  CreditApplication,
  Cycle,
  HeldCert,
  Membership,
  Payment,
  RuleSet,
} from '../core/domain/types';
import type { ActivityType } from '../core/domain/activity-types';
import type { ResolveContext, StandingContext } from '../core/rules';

export async function loadRuleSet(db: Db, ruleVersionId: string): Promise<RuleSet | null> {
  const rv = await db
    .select()
    .from(s.ruleVersions)
    .where(eq(s.ruleVersions.id, ruleVersionId))
    .get();
  if (!rv) return null;
  const body = await db.select().from(s.bodies).where(eq(s.bodies.id, rv.bodyId)).get();
  const [requirements, categories, creditingRules, constraints, relations] = await Promise.all([
    db
      .select()
      .from(s.certRequirements)
      .where(eq(s.certRequirements.ruleVersionId, ruleVersionId))
      .all(),
    db
      .select()
      .from(s.creditCategories)
      .where(eq(s.creditCategories.ruleVersionId, ruleVersionId))
      .all(),
    db
      .select()
      .from(s.creditingRules)
      .where(eq(s.creditingRules.ruleVersionId, ruleVersionId))
      .all(),
    db.select().from(s.constraints).where(eq(s.constraints.ruleVersionId, ruleVersionId)).all(),
    db.select().from(s.certRelations).where(eq(s.certRelations.ruleVersionId, ruleVersionId)).all(),
  ]);
  return {
    ruleVersionId,
    bodyId: rv.bodyId,
    feeScope: body?.feeScope ?? 'none',
    requirements: requirements.map((r) => ({
      certificationId: r.certificationId,
      cycleMonths: r.cycleMonths,
      totalCreditsX100: r.totalCreditsX100,
      annualMinX100: r.annualMinX100,
      annualMinSeverity: r.annualMinSeverity,
      feeAmountCents: r.feeAmountCents,
      feeCurrency: r.feeCurrency,
      feePeriodMonths: r.feePeriodMonths,
      feeParams: (r.feeParams as Record<string, unknown> | null) ?? null,
    })),
    categories: categories.map((c) => ({ key: c.key, name: c.name, parentKey: c.parentKey })),
    creditingRules: creditingRules.map((r) => ({
      id: r.id,
      ruleVersionId: r.ruleVersionId,
      activityType: r.activityType as ActivityType,
      bodyLabel: r.bodyLabel,
      basis: r.basis,
      minutesPerCredit: r.minutesPerCredit,
      creditsPerItemX100: r.creditsPerItemX100,
      rounding: r.rounding,
      categoryKey: r.categoryKey,
      capPerCycleX100: r.capPerCycleX100,
      capPerYearX100: r.capPerYearX100,
      capPerItemX100: r.capPerItemX100,
      evidenceRequired: r.evidenceRequired,
      appliesToCertId: r.appliesToCertId,
    })),
    constraints: constraints.map((c) => ({
      id: c.id,
      certificationId: c.certificationId,
      type: c.type as Constraint['type'],
      params: (c.params as Record<string, unknown>) ?? {},
      severity: c.severity,
    })),
    relations: relations.map((r) => ({
      fromCertId: r.fromCertId,
      toCertId: r.toCertId,
      relation: r.relation,
      creditsX100: r.creditsX100,
    })),
  };
}

const cache = new Map<string, RuleSet>();
export async function ruleSetsFor(db: Db, ids: Iterable<string>): Promise<Map<string, RuleSet>> {
  const out = new Map<string, RuleSet>();
  for (const id of new Set(ids)) {
    let rs = cache.get(id);
    if (!rs) {
      const loaded = await loadRuleSet(db, id);
      if (!loaded) continue;
      rs = loaded;
      cache.set(id, rs);
    }
    out.set(id, rs);
  }
  return out;
}

export async function latestRuleVersionId(db: Db, bodyId: string): Promise<string | null> {
  const rv = await db
    .select({ id: s.ruleVersions.id })
    .from(s.ruleVersions)
    .where(eq(s.ruleVersions.bodyId, bodyId))
    .orderBy(desc(s.ruleVersions.version))
    .get();
  return rv?.id ?? null;
}

export async function heldCerts(db: Db): Promise<HeldCert[]> {
  const rows = await db
    .select({ h: s.heldCertifications, bodyId: s.certifications.bodyId })
    .from(s.heldCertifications)
    .innerJoin(s.certifications, eq(s.certifications.id, s.heldCertifications.certificationId))
    .all();
  return rows.map(({ h, bodyId }) => ({
    id: h.id,
    certificationId: h.certificationId,
    bodyId,
    status: h.status,
    earnedOn: h.earnedOn,
  }));
}

export async function allCycles(db: Db): Promise<Cycle[]> {
  return db.select().from(s.cycles).all();
}

export async function applicationsFor(db: Db, cycleIds: string[]): Promise<CreditApplication[]> {
  if (cycleIds.length === 0) return [];
  const rows = await db
    .select({
      a: s.creditApplications,
      activityType: s.activities.activityType,
      occurredOn: s.activities.occurredOn,
    })
    .from(s.creditApplications)
    .innerJoin(s.activities, eq(s.activities.id, s.creditApplications.activityId))
    .where(inArray(s.creditApplications.cycleId, cycleIds))
    .all();
  return rows.map(({ a, activityType, occurredOn }) => ({
    id: a.id,
    activityId: a.activityId,
    heldCertId: a.heldCertId,
    cycleId: a.cycleId,
    creditsX100: a.creditsX100,
    categoryKey: a.categoryKey,
    status: a.status,
    creditingRuleId: a.creditingRuleId,
    activityType: activityType as ActivityType,
    occurredOn,
  }));
}

export async function resolveContext(db: Db, asOf: string): Promise<ResolveContext> {
  const held = await heldCerts(db);
  const cycles = (await allCycles(db)).filter((c) => c.status === 'open');
  const rules = await ruleSetsFor(
    db,
    cycles.map((c) => c.ruleVersionId),
  );
  const existing = (
    await applicationsFor(
      db,
      cycles.map((c) => c.id),
    )
  ).filter((a) => a.status !== 'rejected');
  return { held, cycles, rules, existing, asOf };
}

export async function standingContext(
  db: Db,
  cycle: Cycle,
  asOf: string,
): Promise<StandingContext | null> {
  const held = (await heldCerts(db)).find((h) => h.id === cycle.heldCertId);
  const rules = (await ruleSetsFor(db, [cycle.ruleVersionId])).get(cycle.ruleVersionId);
  if (!held || !rules) return null;
  const [applications, paymentRows, membershipRows, allHeld, cycles, renewal] = await Promise.all([
    applicationsFor(db, [cycle.id]),
    db.select().from(s.payments).where(ne(s.payments.status, 'due')).all(),
    db.select().from(s.memberships).all(),
    heldCerts(db),
    allCycles(db),
    db
      .select()
      .from(s.renewals)
      .where(and(eq(s.renewals.closedCycleId, cycle.id)))
      .get(),
  ]);
  const payments: Payment[] = paymentRows.map((p) => ({
    targetType: p.targetType,
    targetId: p.targetId,
    periodStart: p.periodStart,
    periodEnd: p.periodEnd,
    dueOn: p.dueOn,
    status: p.status,
  }));
  const memberships: Membership[] = membershipRows.map((m) => ({ id: m.id, bodyId: m.bodyId }));
  return {
    held,
    rules,
    applications,
    payments,
    memberships,
    allHeld,
    allCycles: cycles,
    asOf,
    recertExamPassedOn: renewal?.renewedOn ?? null,
  };
}
