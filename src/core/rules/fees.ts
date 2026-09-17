// Fee schedule: which fee periods a cycle implies, and whether each is covered. Pure.
// Scope 'certification' → periods keyed to the cycle; 'membership' → periods keyed to the body membership.
// Both step `feePeriodMonths` from the cycle start.
import type {
  CertRequirement,
  Cycle,
  HeldCert,
  IsoDate,
  Membership,
  Payment,
  RuleSet,
} from '../domain/types';
import { addMonths } from '../cycles/dates';

export interface FeePeriod {
  targetType: 'cycle' | 'membership';
  targetId: string | null; // null when membership scope but no membership recorded
  scope: string; // 'membership:isc2' | 'cycle:<id>'
  periodStart: IsoDate;
  periodEnd: IsoDate; // exclusive
  dueOn: IsoDate;
  amountCents: number | null;
  currency: string | null;
  status: 'paid' | 'waived' | 'due';
  /** Set when a higher held certification's fee covers this one (covered_by_higher_cert). */
  coveredBy: string | null;
}

export interface FeeContext {
  held: HeldCert;
  rules: RuleSet;
  payments: Payment[];
  memberships: Membership[];
  allHeld: HeldCert[];
  allCycles: Cycle[];
}

export function feeSchedule(
  cycle: Cycle,
  ctx: FeeContext,
  req: CertRequirement | undefined,
): FeePeriod[] {
  const scope = ctx.rules.feeScope;
  if (!req || scope === 'none' || !req.feePeriodMonths) return [];
  const targetType = scope === 'membership' ? 'membership' : 'cycle';
  const membership = ctx.memberships.find((m) => m.bodyId === ctx.held.bodyId);
  const targetId = scope === 'membership' ? (membership?.id ?? null) : cycle.id;
  const scopeLabel = scope === 'membership' ? `membership:${ctx.held.bodyId}` : `cycle:${cycle.id}`;
  const coveredBy = coveringCert(ctx, req);
  const paid = ctx.payments.filter(
    (p) =>
      p.targetType === targetType &&
      p.targetId === targetId &&
      (p.status === 'paid' || p.status === 'waived'),
  );
  const out: FeePeriod[] = [];
  let start = cycle.startsOn;
  while (start < cycle.endsOn) {
    const end = addMonths(start, req.feePeriodMonths);
    const hit = paid.find((p) => p.periodStart <= start && p.periodEnd > start);
    out.push({
      targetType,
      targetId,
      scope: scopeLabel,
      periodStart: start,
      periodEnd: end,
      dueOn: start,
      amountCents: req.feeAmountCents,
      currency: req.feeCurrency,
      status: hit ? (hit.status === 'waived' ? 'waived' : 'paid') : coveredBy ? 'waived' : 'due',
      coveredBy,
    });
    start = end;
  }
  return out;
}

/**
 * CompTIA-style: "you only pay the CE fee for your highest-level certification". A cert with
 * fee_params.covered_by_higher_cert is covered when an active held cert with an open cycle
 * has an earning_renews relation onto it (i.e. it is a higher cert in the same body).
 */
export function coveringCert(ctx: FeeContext, req: CertRequirement): string | null {
  if (!req.feeParams?.['covered_by_higher_cert']) return null;
  for (const rel of ctx.rules.relations) {
    if (rel.relation !== 'earning_renews' || rel.toCertId !== ctx.held.certificationId) continue;
    if (!rel.fromCertId.startsWith(`${ctx.rules.bodyId}/`)) continue;
    const higher = ctx.allHeld.find(
      (h) => h.certificationId === rel.fromCertId && h.status === 'active' && h.id !== ctx.held.id,
    );
    if (!higher) continue;
    const open = ctx.allCycles.some((c) => c.heldCertId === higher.id && c.status === 'open');
    if (open) return higher.certificationId;
  }
  return null;
}
