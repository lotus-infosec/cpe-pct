import type {
  Activity,
  CreditApplication,
  CreditingRule,
  CreditsX100,
  Cycle,
  HeldCert,
  IsoDate,
  RuleSet,
} from '../domain/types';
import { bucketOf, buckets, inRange } from '../cycles/dates';
import { credit } from './credit';

export interface ResolveContext {
  held: HeldCert[];
  cycles: Cycle[];
  rules: Map<string, RuleSet>; // by ruleVersionId
  existing: CreditApplication[]; // every non-rejected application across open cycles
  asOf: IsoDate;
}

export type Warning =
  | 'clamped_cycle_cap'
  | 'clamped_annual_cap'
  | 'clamped_category_cap'
  | 'already_applied'
  | 'evidence_required';

export interface Suggestion {
  heldCertId: string;
  certificationId: string;
  cycleId: string;
  kind: 'credit' | 'renewal';
  creditsX100: CreditsX100;
  categoryKey: string | null;
  creditingRuleId: string | null;
  /** Set when a `credits_flow_down` relation says a higher held cert covers this one. */
  coveredBy: string | null;
  explain: string[];
  warnings: Warning[];
}

const live = (a: CreditApplication) => a.status !== 'rejected';

/**
 * Fan-out: for every held cert with an open cycle containing the activity date, what does the
 * pinned rule version say? Pure. Never applies anything. `other` yields no suggestions.
 */
export function resolve(activity: Activity, ctx: ResolveContext): Suggestion[] {
  const out: Suggestion[] = [];
  const openFor = (heldId: string) =>
    ctx.cycles.find(
      (c) =>
        c.heldCertId === heldId &&
        c.status === 'open' &&
        inRange(activity.occurredOn, c.startsOn, c.endsOn),
    );

  for (const held of ctx.held) {
    if (held.status !== 'active') continue;
    const cycle = openFor(held.id);
    if (!cycle) continue;
    const rs = ctx.rules.get(cycle.ruleVersionId);
    if (!rs) continue;
    const explain: string[] = [];
    const warnings: Warning[] = [];

    // Relations driven by earning another certification.
    if (activity.activityType === 'earn_certification' && activity.relatedCertificationId) {
      const rel = rs.relations.find(
        (r) =>
          r.fromCertId === activity.relatedCertificationId && r.toCertId === held.certificationId,
      );
      if (rel?.relation === 'earning_renews') {
        out.push({
          heldCertId: held.id,
          certificationId: held.certificationId,
          cycleId: cycle.id,
          kind: 'renewal',
          creditsX100: 0,
          categoryKey: null,
          creditingRuleId: null,
          coveredBy: null,
          explain: [
            `${rs.bodyId}: earning ${activity.relatedCertificationId} renews ${held.certificationId}`,
          ],
          warnings: [],
        });
        continue;
      }
      if (rel?.relation === 'earning_credits' && rel.creditsX100 != null) {
        out.push({
          heldCertId: held.id,
          certificationId: held.certificationId,
          cycleId: cycle.id,
          kind: 'credit',
          creditsX100: rel.creditsX100,
          categoryKey: null,
          creditingRuleId: null,
          coveredBy: null,
          explain: [
            `${rs.bodyId}: earning ${activity.relatedCertificationId} credits ${rel.creditsX100 / 100} to ${held.certificationId}`,
          ],
          warnings: [],
        });
        continue;
      }
    }

    // Candidate crediting rules: specific (applies_to this cert) beats general.
    const candidates = rs.creditingRules
      .filter((r) => r.activityType === activity.activityType)
      .filter((r) => r.appliesToCertId == null || r.appliesToCertId === held.certificationId)
      .sort((a, b) => Number(b.appliesToCertId != null) - Number(a.appliesToCertId != null));
    const rule = candidates[0];
    if (!rule) continue; // not creditable at this body
    let credits = credit(rule, activity);
    if (credits == null) continue;
    explain.push(describe(rule, activity, credits));

    if (
      ctx.existing.some((a) => a.activityId === activity.id && a.heldCertId === held.id && live(a))
    ) {
      warnings.push('already_applied');
    }
    if (rule.evidenceRequired) warnings.push('evidence_required');

    const inCycle = ctx.existing.filter((a) => a.cycleId === cycle.id && live(a));
    const sameRule = inCycle.filter((a) =>
      a.creditingRuleId ? a.creditingRuleId === rule.id : a.activityType === rule.activityType,
    );

    if (rule.capPerCycleX100 != null) {
      const used = sum(sameRule);
      const remaining = Math.max(0, rule.capPerCycleX100 - used);
      if (credits > remaining) {
        explain.push(
          `cycle cap ${fmt(rule.capPerCycleX100)}: ${fmt(used)} used, ${fmt(remaining)} remaining`,
        );
        credits = remaining;
        warnings.push('clamped_cycle_cap');
      }
    }
    if (rule.capPerYearX100 != null) {
      const bs = buckets(cycle.startsOn, cycle.endsOn);
      const b = bucketOf(activity.occurredOn, bs);
      if (b) {
        const used = sum(sameRule.filter((a) => inRange(a.occurredOn, b.start, b.end)));
        const remaining = Math.max(0, rule.capPerYearX100 - used);
        if (credits > remaining) {
          explain.push(
            `year ${b.index + 1} cap ${fmt(rule.capPerYearX100)}: ${fmt(used)} used, ${fmt(remaining)} remaining`,
          );
          credits = remaining;
          warnings.push('clamped_annual_cap');
        }
      }
    }
    if (rule.categoryKey) {
      const capCon = rs.constraints.find(
        (c) =>
          c.type === 'category_max' &&
          (c.certificationId == null || c.certificationId === held.certificationId) &&
          c.params['category'] === rule.categoryKey,
      );
      const max = capCon ? toX100(capCon.params['max']) : null;
      if (max != null) {
        const used = sum(inCycle.filter((a) => a.categoryKey === rule.categoryKey));
        const remaining = Math.max(0, max - used);
        if (credits > remaining) {
          explain.push(
            `category ${rule.categoryKey} cap ${fmt(max)}: ${fmt(used)} used, ${fmt(remaining)} remaining`,
          );
          credits = remaining;
          warnings.push('clamped_category_cap');
        }
      }
    }

    // Covered by a higher held cert of the same body?
    const coverer = rs.relations
      .filter((r) => r.relation === 'credits_flow_down' && r.toCertId === held.certificationId)
      .map((r) =>
        ctx.held.find(
          (h) => h.certificationId === r.fromCertId && h.status === 'active' && openFor(h.id),
        ),
      )
      .find((h) => h != null);
    if (coverer) explain.push(`covered by ${coverer.certificationId}: credits flow down`);

    out.push({
      heldCertId: held.id,
      certificationId: held.certificationId,
      cycleId: cycle.id,
      kind: 'credit',
      creditsX100: credits,
      categoryKey: rule.categoryKey,
      creditingRuleId: rule.id,
      coveredBy: coverer?.id ?? null,
      explain,
      warnings,
    });
  }
  return out;
}

function describe(rule: CreditingRule, a: Activity, c: CreditsX100): string {
  switch (rule.basis) {
    case 'per_minutes':
      return `${rule.bodyLabel}: ${a.durationMinutes} min / ${rule.minutesPerCredit} min per credit, ${rule.rounding} → ${fmt(c)}`;
    case 'per_item':
      return `${rule.bodyLabel}: ${a.itemCount ?? 1} × ${fmt(rule.creditsPerItemX100 ?? 0)} → ${fmt(c)}`;
    case 'fixed':
      return `${rule.bodyLabel}: fixed ${fmt(c)}`;
  }
}

const sum = (apps: CreditApplication[]) => apps.reduce((n, a) => n + a.creditsX100, 0);
export const fmt = (x100: number) => (x100 / 100).toFixed(2).replace(/\.?0+$/, '');
export function toX100(v: unknown): CreditsX100 | null {
  return typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 100) : null;
}
