import type {
  Constraint,
  CreditApplication,
  CreditsX100,
  Cycle,
  HeldCert,
  IsoDate,
  Membership,
  Payment,
  RuleSet,
  Severity,
} from '../domain/types';
import { addDays, addMonths, buckets, daysBetween, inRange } from '../cycles/dates';
import { toX100 } from './resolve';

export interface StandingContext {
  held: HeldCert; // the cert this cycle belongs to
  rules: RuleSet; // pinned version
  applications: CreditApplication[]; // all applications for this cycle (any status)
  payments: Payment[]; // every payment the owner has recorded (both scopes)
  memberships: Membership[];
  /** Other held certs + their open cycles, for prerequisite_current. */
  allHeld: HeldCert[];
  allCycles: Cycle[];
  attestedOn?: IsoDate | null;
  recertExamPassedOn?: IsoDate | null;
  asOf: IsoDate;
}

export interface Totals {
  accepted: CreditsX100;
  submitted: CreditsX100;
  claimed: CreditsX100;
  planned: CreditsX100;
}

export interface ConstraintResult {
  constraintId: string | null;
  type: Constraint['type'];
  severity: Severity;
  satisfied: boolean;
  /** When this must be true. Unsatisfied + due in the past = overdue. */
  due: IsoDate | null;
  overdue: boolean;
  required?: CreditsX100;
  actual?: CreditsX100;
  totals?: Totals;
  year?: number;
  category?: string;
  activityType?: string;
  scope?: string;
  period?: string;
  overdueDays?: number;
  note?: string;
  of?: ConstraintResult[];
}

export interface Standing {
  cycleId: string;
  compliant: boolean; // every hard constraint is satisfied or not yet due
  asOf: IsoDate;
  daysRemaining: number;
  totals: Totals;
  requiredX100: CreditsX100;
  constraints: ConstraintResult[]; // failing ones first
  projectedAtCycleEnd: Constraint['type'][];
}

const COUNTED: CreditApplication['status'][] = ['accepted', 'submitted', 'claimed'];

export function standing(cycle: Cycle, ctx: StandingContext): Standing {
  const req = ctx.rules.requirements.find((r) => r.certificationId === ctx.held.certificationId);
  const apps = ctx.applications.filter((a) => a.cycleId === cycle.id);
  const totals = totalsOf(apps);
  const counted = apps.filter((a) => COUNTED.includes(a.status));
  const applicable = ctx.rules.constraints.filter(
    (c) => c.certificationId == null || c.certificationId === ctx.held.certificationId,
  );
  const results = applicable.map((c) =>
    evaluate(c, cycle, ctx, counted, req?.totalCreditsX100 ?? 0, totals),
  );
  // Failing first; among failing, overdue first; among those, hard before soft.
  results.sort(
    (a, b) =>
      Number(a.satisfied) - Number(b.satisfied) ||
      Number(b.overdue) - Number(a.overdue) ||
      Number(a.severity === 'soft') - Number(b.severity === 'soft'),
  );
  const compliant = results.every((r) => r.severity === 'soft' || r.satisfied || !r.overdue);

  // Projection: for end-of-cycle totals, is the current pace enough?
  const elapsed = Math.max(1, daysBetween(cycle.startsOn, ctx.asOf));
  const length = Math.max(1, daysBetween(cycle.startsOn, cycle.endsOn));
  const frac = Math.min(1, elapsed / length);
  const projectedAtCycleEnd = results
    .filter(
      (r) =>
        !r.satisfied && r.required != null && r.actual != null && r.due === lastDay(cycle.endsOn),
    )
    .filter((r) => r.actual! / frac < r.required!)
    .map((r) => r.type);

  return {
    cycleId: cycle.id,
    compliant,
    asOf: ctx.asOf,
    daysRemaining: daysBetween(ctx.asOf, cycle.endsOn),
    totals,
    requiredX100: req?.totalCreditsX100 ?? 0,
    constraints: results,
    projectedAtCycleEnd,
  };
}

function evaluate(
  c: Constraint,
  cycle: Cycle,
  ctx: StandingContext,
  counted: CreditApplication[],
  totalRequired: CreditsX100,
  totals: Totals,
): ConstraintResult {
  const base = { constraintId: c.id, type: c.type, severity: c.severity } as const;
  const cycleDue = lastDay(cycle.endsOn);
  const sumOf = (xs: CreditApplication[]) => xs.reduce((n, a) => n + a.creditsX100, 0);
  const req = ctx.rules.requirements.find((r) => r.certificationId === ctx.held.certificationId);

  switch (c.type) {
    case 'cycle_total': {
      const required = toX100(c.params['total']) ?? totalRequired;
      const actual = sumOf(counted);
      return fin(
        {
          ...base,
          required,
          actual,
          totals,
          due: cycleDue,
          satisfied: actual >= required,
          note: pace(actual, required, cycle, ctx.asOf),
        },
        ctx.asOf,
      );
    }
    case 'annual_min': {
      // One result per cycle year; reported as the first unsatisfied year, with all years in `of`.
      const required = toX100(c.params['min']) ?? req?.annualMinX100 ?? 0;
      const years = buckets(cycle.startsOn, cycle.endsOn).map((b) => {
        const actual = sumOf(counted.filter((a) => inRange(a.occurredOn, b.start, b.end)));
        return fin(
          {
            ...base,
            year: b.index + 1,
            required,
            actual,
            due: lastDay(b.end),
            satisfied: actual >= required,
          },
          ctx.asOf,
        );
      });
      const first = years.find((y) => !y.satisfied) ?? years[years.length - 1]!;
      return { ...first, of: years };
    }
    case 'category_min':
    case 'category_max': {
      const category = String(c.params['category']);
      const keys = withChildren(category, ctx.rules);
      const actual = sumOf(counted.filter((a) => a.categoryKey != null && keys.has(a.categoryKey)));
      if (c.type === 'category_min') {
        const required = toX100(c.params['min']) ?? 0;
        return fin(
          { ...base, category, required, actual, due: cycleDue, satisfied: actual >= required },
          ctx.asOf,
        );
      }
      const max = toX100(c.params['max']) ?? Infinity;
      return fin(
        { ...base, category, required: max, actual, due: null, satisfied: actual <= max },
        ctx.asOf,
      );
    }
    case 'activity_type_max': {
      const activityType = String(c.params['activity_type']);
      const max = toX100(c.params['max']) ?? Infinity;
      const actual = sumOf(counted.filter((a) => a.activityType === activityType));
      return fin(
        { ...base, activityType, required: max, actual, due: null, satisfied: actual <= max },
        ctx.asOf,
      );
    }
    case 'fee_paid': {
      const scope = ctx.rules.feeScope;
      if (scope === 'none' || !req?.feePeriodMonths)
        return fin({ ...base, due: null, satisfied: true, note: 'no fee' }, ctx.asOf);
      const membership = ctx.memberships.find((m) => m.bodyId === ctx.held.bodyId);
      const targetId = scope === 'membership' ? membership?.id : cycle.id;
      const scopeLabel =
        scope === 'membership' ? `membership:${ctx.held.bodyId}` : `cycle:${cycle.id}`;
      const targetType = scope === 'membership' ? 'membership' : 'cycle';
      const paid = ctx.payments.filter(
        (p) =>
          p.targetType === targetType &&
          p.targetId === targetId &&
          (p.status === 'paid' || p.status === 'waived'),
      );
      // Every fee period from cycle start up to asOf must be covered by a paid/waived payment.
      let start = cycle.startsOn;
      while (start <= ctx.asOf && start < cycle.endsOn) {
        const end = addMonths(start, req.feePeriodMonths);
        const covered = paid.some((p) => p.periodStart <= start && p.periodEnd > start);
        if (!covered) {
          const overdueDays = Math.max(0, daysBetween(start, ctx.asOf));
          return fin(
            {
              ...base,
              scope: scopeLabel,
              period: `${start}..${end}`,
              due: start,
              satisfied: false,
              overdueDays,
            },
            ctx.asOf,
          );
        }
        start = end;
      }
      return fin({ ...base, scope: scopeLabel, due: null, satisfied: true }, ctx.asOf);
    }
    case 'prerequisite_current': {
      const certId = String(c.params['certification']);
      const held = ctx.allHeld.find((h) => h.certificationId === certId && h.status === 'active');
      const open =
        held &&
        ctx.allCycles.some(
          (cy) =>
            cy.heldCertId === held.id &&
            cy.status === 'open' &&
            inRange(ctx.asOf, cy.startsOn, cy.endsOn),
        );
      return fin(
        {
          ...base,
          scope: certId,
          due: cycleDue,
          satisfied: Boolean(open),
          ...(open ? {} : { note: `${certId} not current` }),
        },
        ctx.asOf,
      );
    }
    case 'attestation':
      return fin(
        {
          ...base,
          due: cycleDue,
          satisfied:
            ctx.attestedOn != null && inRange(ctx.attestedOn, cycle.startsOn, cycle.endsOn),
        },
        ctx.asOf,
      );
    case 'recert_exam':
      return fin(
        {
          ...base,
          due: cycleDue,
          satisfied:
            ctx.recertExamPassedOn != null &&
            inRange(ctx.recertExamPassedOn, cycle.startsOn, cycle.endsOn),
        },
        ctx.asOf,
      );
    case 'any_of': {
      const subs =
        (c.params['of'] as
          Array<{ type: Constraint['type']; params?: Record<string, unknown> }> | undefined) ?? [];
      const of = subs.map((s) =>
        evaluate(
          {
            id: `${c.id}/${s.type}`,
            certificationId: c.certificationId,
            type: s.type,
            params: s.params ?? {},
            severity: c.severity,
          },
          cycle,
          ctx,
          counted,
          totalRequired,
          totals,
        ),
      );
      return fin({ ...base, of, due: cycleDue, satisfied: of.some((r) => r.satisfied) }, ctx.asOf);
    }
  }
}

function fin(r: Omit<ConstraintResult, 'overdue'>, asOf: IsoDate): ConstraintResult {
  return { ...r, overdue: !r.satisfied && r.due != null && r.due < asOf };
}

function totalsOf(apps: CreditApplication[]): Totals {
  const t: Totals = { accepted: 0, submitted: 0, claimed: 0, planned: 0 };
  for (const a of apps) if (a.status in t) t[a.status as keyof Totals] += a.creditsX100;
  return t;
}

function withChildren(key: string, rs: RuleSet): Set<string> {
  const keys = new Set([key]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const c of rs.categories)
      if (c.parentKey && keys.has(c.parentKey) && !keys.has(c.key)) {
        keys.add(c.key);
        grew = true;
      }
  }
  return keys;
}

function pace(actual: number, required: number, cycle: Cycle, asOf: IsoDate): string {
  const frac = Math.min(
    1,
    Math.max(
      0,
      daysBetween(cycle.startsOn, asOf) / Math.max(1, daysBetween(cycle.startsOn, cycle.endsOn)),
    ),
  );
  return actual >= required * frac ? 'on pace' : 'behind';
}

/** endsOn is exclusive; the human-facing due date is the day before. */
export function lastDay(endsOnExclusive: IsoDate): IsoDate {
  return addDays(endsOnExclusive, -1);
}
