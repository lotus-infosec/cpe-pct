// Plain-object domain types consumed by the pure engine. The app layer loads these from Drizzle rows.
// No ORM types, no Date objects: dates are ISO 'YYYY-MM-DD' strings, credits are integer hundredths.
import type { ActivityType } from './activity-types';

export type IsoDate = string; // 'YYYY-MM-DD'
export type CreditsX100 = number; // integer; 325 = 3.25

export type Basis = 'per_minutes' | 'per_item' | 'fixed';
export type Rounding = 'floor_quarter' | 'floor_half' | 'floor_whole' | 'nearest_quarter' | 'exact';
export type Severity = 'hard' | 'soft';
export type ConstraintType =
  | 'cycle_total'
  | 'annual_min'
  | 'category_min'
  | 'category_max'
  | 'activity_type_max'
  | 'fee_paid'
  | 'prerequisite_current'
  | 'attestation'
  | 'recert_exam'
  | 'any_of';
export type RelationType =
  'earning_renews' | 'credits_flow_down' | 'requires_current' | 'earning_credits';
export type ApplicationStatus = 'planned' | 'claimed' | 'submitted' | 'accepted' | 'rejected';

export interface CreditingRule {
  id: string;
  ruleVersionId: string;
  activityType: ActivityType;
  bodyLabel: string;
  basis: Basis;
  minutesPerCredit: number | null;
  creditsPerItemX100: CreditsX100 | null;
  rounding: Rounding;
  categoryKey: string | null;
  capPerCycleX100: CreditsX100 | null;
  capPerYearX100: CreditsX100 | null;
  capPerItemX100: CreditsX100 | null;
  evidenceRequired: boolean;
  appliesToCertId: string | null;
}

export interface CertRequirement {
  certificationId: string;
  cycleMonths: number;
  totalCreditsX100: CreditsX100;
  annualMinX100: CreditsX100 | null;
  annualMinSeverity: Severity | null;
  feeAmountCents: number | null;
  feeCurrency: string | null;
  feePeriodMonths: number | null;
  feeParams: Record<string, unknown> | null;
}

export interface CreditCategory {
  key: string;
  name: string;
  parentKey: string | null;
}

export interface Constraint {
  id: string;
  certificationId: string | null; // null = every cert of the body
  type: ConstraintType;
  params: Record<string, unknown>;
  severity: Severity;
}

export interface CertRelation {
  fromCertId: string;
  toCertId: string;
  relation: RelationType;
  creditsX100: CreditsX100 | null;
}

/** Everything one rule version says. Loaded once per version, keyed by ruleVersionId in ctx. */
export interface RuleSet {
  ruleVersionId: string;
  bodyId: string;
  feeScope: 'membership' | 'certification' | 'none';
  requirements: CertRequirement[];
  categories: CreditCategory[];
  creditingRules: CreditingRule[];
  constraints: Constraint[];
  relations: CertRelation[];
}

export interface Activity {
  id: string;
  activityType: ActivityType;
  occurredOn: IsoDate;
  durationMinutes: number | null;
  itemCount: number | null;
  title?: string;
  /** For earn_certification: the catalog id of the certification earned, if it is in the catalog. */
  relatedCertificationId?: string | null;
}

export interface HeldCert {
  id: string;
  certificationId: string;
  bodyId: string;
  status: 'active' | 'lapsed' | 'retired' | 'pursuing';
  earnedOn: IsoDate;
}

export interface Cycle {
  id: string;
  heldCertId: string;
  sequence: number;
  startsOn: IsoDate;
  endsOn: IsoDate; // exclusive
  ruleVersionId: string;
  status: 'open' | 'renewed' | 'lapsed';
}

export interface CreditApplication {
  id: string;
  activityId: string;
  heldCertId: string;
  cycleId: string;
  creditsX100: CreditsX100;
  categoryKey: string | null;
  status: ApplicationStatus;
  creditingRuleId: string | null;
  activityType: ActivityType;
  occurredOn: IsoDate;
}

export interface Payment {
  targetType: 'cycle' | 'membership';
  targetId: string;
  periodStart: IsoDate;
  periodEnd: IsoDate; // exclusive
  dueOn: IsoDate;
  status: 'due' | 'paid' | 'waived';
}

export interface Membership {
  id: string;
  bodyId: string;
}
