// Synthetic bodies that exercise the rule mechanics.
// Values are ILLUSTRATIVE; real bodies live in catalog/bodies with cited sources.
import type {
  Activity,
  CreditApplication,
  CreditingRule,
  Cycle,
  HeldCert,
  RuleSet,
} from '../../src/core/domain/types';

const rule = (
  o: Partial<CreditingRule> &
    Pick<CreditingRule, 'id' | 'ruleVersionId' | 'activityType' | 'basis'>,
): CreditingRule => ({
  bodyLabel: o.id,
  minutesPerCredit: null,
  creditsPerItemX100: null,
  rounding: 'exact',
  categoryKey: null,
  capPerCycleX100: null,
  capPerYearX100: null,
  capPerItemX100: null,
  evidenceRequired: true,
  appliesToCertId: null,
  ...o,
});

// Body A: 60 min/credit, floor_quarter, categories A/B, B capped 30/cycle on cert a1, annual min 40 soft, membership fee.
export const bodyA: RuleSet = {
  ruleVersionId: 'a@1',
  bodyId: 'a',
  feeScope: 'membership',
  requirements: [
    {
      certificationId: 'a/a1',
      cycleMonths: 36,
      totalCreditsX100: 12000,
      annualMinX100: 4000,
      annualMinSeverity: 'soft',
      feeAmountCents: 13500,
      feeCurrency: 'USD',
      feePeriodMonths: 12,
      feeParams: null,
    },
    {
      certificationId: 'a/a2',
      cycleMonths: 36,
      totalCreditsX100: 4500,
      annualMinX100: 1500,
      annualMinSeverity: 'soft',
      feeAmountCents: 13500,
      feeCurrency: 'USD',
      feePeriodMonths: 12,
      feeParams: null,
    },
  ],
  categories: [
    { key: 'A', name: 'Domain', parentKey: null },
    { key: 'B', name: 'Professional', parentKey: null },
  ],
  creditingRules: [
    rule({
      id: 'a-conf',
      ruleVersionId: 'a@1',
      activityType: 'attend_conference',
      basis: 'per_minutes',
      minutesPerCredit: 60,
      rounding: 'floor_quarter',
      categoryKey: 'A',
    }),
    rule({
      id: 'a-mentor',
      ruleVersionId: 'a@1',
      activityType: 'mentor',
      basis: 'per_minutes',
      minutesPerCredit: 60,
      rounding: 'floor_quarter',
      categoryKey: 'B',
    }),
    rule({
      id: 'a-book',
      ruleVersionId: 'a@1',
      activityType: 'read_book',
      basis: 'per_item',
      creditsPerItemX100: 500,
      categoryKey: 'A',
    }),
  ],
  constraints: [
    { id: 'a-total', certificationId: null, type: 'cycle_total', params: {}, severity: 'hard' },
    { id: 'a-annual', certificationId: null, type: 'annual_min', params: {}, severity: 'soft' },
    {
      id: 'a-bmax',
      certificationId: 'a/a1',
      type: 'category_max',
      params: { category: 'B', max: 30 },
      severity: 'hard',
    },
    { id: 'a-fee', certificationId: null, type: 'fee_paid', params: {}, severity: 'hard' },
  ],
  relations: [],
};

// Body B: 60 min/credit floor_whole, no books/mentoring, higher cert b2 renews b1 and credits flow down; earning cert x renews.
export const bodyB: RuleSet = {
  ruleVersionId: 'b@1',
  bodyId: 'b',
  feeScope: 'certification',
  requirements: [
    {
      certificationId: 'b/b1',
      cycleMonths: 36,
      totalCreditsX100: 5000,
      annualMinX100: null,
      annualMinSeverity: null,
      feeAmountCents: 5000,
      feeCurrency: 'USD',
      feePeriodMonths: 12,
      feeParams: null,
    },
    {
      certificationId: 'b/b2',
      cycleMonths: 36,
      totalCreditsX100: 6000,
      annualMinX100: null,
      annualMinSeverity: null,
      feeAmountCents: 5000,
      feeCurrency: 'USD',
      feePeriodMonths: 12,
      feeParams: null,
    },
  ],
  categories: [],
  creditingRules: [
    rule({
      id: 'b-conf',
      ruleVersionId: 'b@1',
      activityType: 'attend_conference',
      basis: 'per_minutes',
      minutesPerCredit: 60,
      rounding: 'floor_whole',
    }),
  ],
  constraints: [
    { id: 'b-total', certificationId: null, type: 'cycle_total', params: {}, severity: 'hard' },
    { id: 'b-fee', certificationId: null, type: 'fee_paid', params: {}, severity: 'hard' },
  ],
  relations: [
    { fromCertId: 'b/b2', toCertId: 'b/b1', relation: 'credits_flow_down', creditsX100: null },
    { fromCertId: 'b/b2', toCertId: 'b/b1', relation: 'earning_renews', creditsX100: null },
    { fromCertId: 'x/ccsp', toCertId: 'b/b1', relation: 'earning_renews', creditsX100: null },
    { fromCertId: 'x/ccsp', toCertId: 'b/b2', relation: 'earning_renews', creditsX100: null },
  ],
};

// Body C: 50 min/credit floor_whole; books as timed self-study capped 20/yr; mentoring capped 10/yr.
export const bodyC: RuleSet = {
  ruleVersionId: 'c@1',
  bodyId: 'c',
  feeScope: 'certification',
  requirements: [
    {
      certificationId: 'c/c1',
      cycleMonths: 36,
      totalCreditsX100: 12000,
      annualMinX100: 2000,
      annualMinSeverity: 'hard',
      feeAmountCents: null,
      feeCurrency: null,
      feePeriodMonths: null,
      feeParams: null,
    },
  ],
  categories: [],
  creditingRules: [
    rule({
      id: 'c-conf',
      ruleVersionId: 'c@1',
      activityType: 'attend_conference',
      basis: 'per_minutes',
      minutesPerCredit: 50,
      rounding: 'floor_whole',
    }),
    rule({
      id: 'c-mentor',
      ruleVersionId: 'c@1',
      activityType: 'mentor',
      basis: 'per_minutes',
      minutesPerCredit: 50,
      rounding: 'floor_whole',
      capPerYearX100: 1000,
    }),
    rule({
      id: 'c-book',
      ruleVersionId: 'c@1',
      activityType: 'read_book',
      basis: 'per_minutes',
      minutesPerCredit: 50,
      rounding: 'floor_whole',
      capPerYearX100: 2000,
    }),
  ],
  constraints: [
    { id: 'c-total', certificationId: null, type: 'cycle_total', params: {}, severity: 'hard' },
    { id: 'c-annual', certificationId: null, type: 'annual_min', params: {}, severity: 'hard' },
  ],
  relations: [],
};

// Body D: 60 min/credit floor_whole; books 5/item; earning cert x credits 40.
export const bodyD: RuleSet = {
  ruleVersionId: 'd@1',
  bodyId: 'd',
  feeScope: 'certification',
  requirements: [
    {
      certificationId: 'd/d1',
      cycleMonths: 36,
      totalCreditsX100: 12000,
      annualMinX100: null,
      annualMinSeverity: null,
      feeAmountCents: null,
      feeCurrency: null,
      feePeriodMonths: null,
      feeParams: null,
    },
  ],
  categories: [],
  creditingRules: [
    rule({
      id: 'd-conf',
      ruleVersionId: 'd@1',
      activityType: 'attend_conference',
      basis: 'per_minutes',
      minutesPerCredit: 60,
      rounding: 'floor_whole',
    }),
    rule({
      id: 'd-mentor',
      ruleVersionId: 'd@1',
      activityType: 'mentor',
      basis: 'per_minutes',
      minutesPerCredit: 60,
      rounding: 'floor_whole',
    }),
    rule({
      id: 'd-book',
      ruleVersionId: 'd@1',
      activityType: 'read_book',
      basis: 'per_item',
      creditsPerItemX100: 500,
    }),
  ],
  constraints: [
    { id: 'd-total', certificationId: null, type: 'cycle_total', params: {}, severity: 'hard' },
  ],
  relations: [
    { fromCertId: 'x/ccsp', toCertId: 'd/d1', relation: 'earning_credits', creditsX100: 4000 },
  ],
};

export const rules = new Map<string, RuleSet>([
  ['a@1', bodyA],
  ['b@1', bodyB],
  ['c@1', bodyC],
  ['d@1', bodyD],
]);

export const held: HeldCert[] = [
  { id: 'h-a1', certificationId: 'a/a1', bodyId: 'a', status: 'active', earnedOn: '2025-05-01' },
  { id: 'h-a2', certificationId: 'a/a2', bodyId: 'a', status: 'active', earnedOn: '2025-05-01' },
  { id: 'h-b2', certificationId: 'b/b2', bodyId: 'b', status: 'active', earnedOn: '2025-01-01' },
  { id: 'h-b1', certificationId: 'b/b1', bodyId: 'b', status: 'active', earnedOn: '2025-01-01' },
  { id: 'h-c1', certificationId: 'c/c1', bodyId: 'c', status: 'active', earnedOn: '2025-01-01' },
  { id: 'h-d1', certificationId: 'd/d1', bodyId: 'd', status: 'active', earnedOn: '2025-01-01' },
];

export const cycles: Cycle[] = [
  {
    id: 'cy-a1',
    heldCertId: 'h-a1',
    sequence: 1,
    startsOn: '2025-05-01',
    endsOn: '2028-05-01',
    ruleVersionId: 'a@1',
    status: 'open',
  },
  {
    id: 'cy-a2',
    heldCertId: 'h-a2',
    sequence: 1,
    startsOn: '2025-05-01',
    endsOn: '2028-05-01',
    ruleVersionId: 'a@1',
    status: 'open',
  },
  {
    id: 'cy-b2',
    heldCertId: 'h-b2',
    sequence: 1,
    startsOn: '2025-01-01',
    endsOn: '2028-01-01',
    ruleVersionId: 'b@1',
    status: 'open',
  },
  {
    id: 'cy-b1',
    heldCertId: 'h-b1',
    sequence: 1,
    startsOn: '2025-01-01',
    endsOn: '2028-01-01',
    ruleVersionId: 'b@1',
    status: 'open',
  },
  {
    id: 'cy-c1',
    heldCertId: 'h-c1',
    sequence: 1,
    startsOn: '2025-01-01',
    endsOn: '2028-01-01',
    ruleVersionId: 'c@1',
    status: 'open',
  },
  {
    id: 'cy-d1',
    heldCertId: 'h-d1',
    sequence: 1,
    startsOn: '2025-01-01',
    endsOn: '2028-01-01',
    ruleVersionId: 'd@1',
    status: 'open',
  },
];

export const app = (
  o: Partial<CreditApplication> &
    Pick<CreditApplication, 'id' | 'heldCertId' | 'cycleId' | 'creditsX100'>,
): CreditApplication => ({
  activityId: `act-${o.id}`,
  categoryKey: null,
  status: 'accepted',
  creditingRuleId: null,
  activityType: 'attend_conference',
  occurredOn: '2025-06-01',
  ...o,
});

export const activity = (
  o: Partial<Activity> & Pick<Activity, 'id' | 'activityType'>,
): Activity => ({
  occurredOn: '2026-09-09',
  durationMinutes: null,
  itemCount: 1,
  ...o,
});
