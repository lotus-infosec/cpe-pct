// Response shapes used by the UI. Kept loose on purpose; the server is the source of truth.
export interface Certification {
  id: string;
  bodyId: string;
  name: string;
  abbreviation: string;
  creditUnitLabel: string;
  expires: boolean;
  requirement?: {
    cycleMonths: number;
    totalCreditsX100: number;
    annualMinX100: number | null;
    annualMinSeverity: 'hard' | 'soft' | null;
    feeAmountCents: number | null;
    feeCurrency: string | null;
    feePeriodMonths: number | null;
  } | null;
}
export interface Body {
  id: string;
  name: string;
  website: string | null;
  feeScope: 'membership' | 'certification' | 'none';
  currentVersion: {
    id: string;
    version: number;
    effectiveFrom: string;
    verifiedOn: string;
    sourceUrl: string;
    sourceTitle: string;
  } | null;
  certifications: Certification[];
}
export interface Cycle {
  id: string;
  heldCertId: string;
  sequence: number;
  startsOn: string;
  endsOn: string;
  ruleVersionId: string;
  status: 'open' | 'renewed' | 'lapsed';
}
export interface Held {
  id: string;
  certificationId: string;
  certNumber: string | null;
  earnedOn: string;
  status: string;
  notes: string | null;
  certification: Certification;
  body: Body;
  cycles: Cycle[];
}
export interface Totals {
  accepted: number;
  submitted: number;
  claimed: number;
  planned: number;
}
export interface ConstraintResult {
  constraintId: string | null;
  type: string;
  severity: 'hard' | 'soft';
  satisfied: boolean;
  due: string | null;
  overdue: boolean;
  required?: number;
  actual?: number;
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
  compliant: boolean;
  asOf: string;
  daysRemaining: number;
  totals: Totals;
  requiredX100: number;
  constraints: ConstraintResult[];
  projectedAtCycleEnd: string[];
}
export interface DashboardItem {
  held: Omit<Held, 'certification' | 'body' | 'cycles'>;
  certification: Certification;
  body: Body;
  cycle: Cycle | null;
  ruleVersion: { id: string; version: number; verifiedOn: string; sourceUrl: string } | null;
  standing: {
    compliant: boolean;
    daysRemaining: number;
    totals: Totals;
    requiredX100: number;
    failing: { type: string; severity: string; overdue: boolean; due: string | null }[];
    projectedAtCycleEnd: string[];
  } | null;
}
export interface Application {
  id: string;
  activityId: string;
  heldCertId: string;
  cycleId: string;
  creditsX100: number;
  categoryKey: string | null;
  status: 'planned' | 'claimed' | 'submitted' | 'accepted' | 'rejected';
  submittedAt: string | null;
  resolvedAt: string | null;
  issuerReference: string | null;
  suggestedCreditsX100: number | null;
  overrideReason: string | null;
  explanation: { explain: string[]; warnings: string[]; coveredBy?: string | null } | null;
}
export interface Activity {
  id: string;
  title: string;
  occurredOn: string;
  provider: string | null;
  durationMinutes: number | null;
  itemCount: number | null;
  activityType: string;
  description: string | null;
  source: string;
  status: 'draft' | 'logged';
  createdAt: string;
  applications: Application[];
}
export interface Suggestion {
  heldCertId: string;
  certificationId: string;
  cycleId: string;
  kind: 'credit' | 'renewal';
  creditsX100: number;
  categoryKey: string | null;
  creditingRuleId: string | null;
  coveredBy: string | null;
  explain: string[];
  warnings: string[];
  certification: Certification | null;
}
export interface Fanout {
  activity: Activity;
  suggestions: Suggestion[];
  existing: Application[];
  heldWithoutSuggestion: { heldCertId: string; certificationId: string; cycle: Cycle | null }[];
}
export interface ActivityType {
  key: string;
  label: string;
  itemBased: boolean;
}
export interface Membership {
  id: string;
  bodyId: string;
  memberNumber: string | null;
  since: string | null;
}
export interface Payment {
  id: string;
  targetType: 'cycle' | 'membership';
  targetId: string;
  periodStart: string;
  periodEnd: string;
  dueOn: string;
  amountCents: number;
  currency: string;
  paidOn: string | null;
  status: 'due' | 'paid' | 'waived';
  confirmationRef: string | null;
}
