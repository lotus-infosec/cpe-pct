// src/db/schema.ts — Drizzle schema, single source of truth for both targets.
// Stage 1: full domain schema. Catalog tables are seeded from catalog/bodies/*.yaml by the compiler.
// Credits and fees are integers (hundredths / cents). Dates are ISO strings.
import { sqliteTable as t, text, integer, index, uniqueIndex } from 'drizzle-orm/sqlite-core';

// ── Infrastructure ───────────────────────────────────────────────────
export const settings = t('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const healthPings = t('health_pings', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  at: text('at').notNull(),
});

export const jobs = t(
  'jobs',
  {
    id: text('id').primaryKey(),
    type: text('type').notNull(),
    payload: text('payload', { mode: 'json' }).notNull(),
    idempotencyKey: text('idempotency_key'),
    runAt: text('run_at').notNull(),
    cron: text('cron'), // recurring jobs: next occurrence enqueued on completion
    leaseUntil: text('lease_until'),
    attempts: integer('attempts').notNull().default(0),
    status: text('status', { enum: ['queued', 'running', 'done', 'failed'] })
      .notNull()
      .default('queued'),
    lastError: text('last_error'),
    createdAt: text('created_at').notNull(),
  },
  (x) => [index('jobs_due').on(x.status, x.runAt), uniqueIndex('jobs_idem').on(x.idempotencyKey)],
);

export const sessions = t('sessions', {
  id: text('id').primaryKey(),
  createdAt: text('created_at').notNull(),
  expiresAt: text('expires_at').notNull(),
});

export const notifications = t('notifications', {
  id: text('id').primaryKey(),
  key: text('key').notNull().unique(),
  kind: text('kind').notNull(),
  title: text('title').notNull(),
  body: text('body').notNull(),
  severity: text('severity').notNull(),
  status: text('status', { enum: ['pending', 'sent', 'read'] })
    .notNull()
    .default('pending'),
  createdAt: text('created_at').notNull(),
  sentAt: text('sent_at'),
});

// A cycle bundle has a body and a cycle. A selection bundle (STAGE8, "export selection first") has
// neither and lists its activities instead.
export const exports_ = t('exports', {
  id: text('id').primaryKey(),
  bodyId: text('body_id'),
  cycleId: text('cycle_id'),
  activityIds: text('activity_ids', { mode: 'json' }).$type<string[]>(),
  status: text('status', { enum: ['building', 'ready', 'failed'] }).notNull(),
  progress: text('progress', { mode: 'json' }),
  objectKey: text('object_key'),
  createdAt: text('created_at').notNull(),
});

export const importBatches = t('import_batches', {
  id: text('id').primaryKey(),
  filename: text('filename').notNull(),
  rowCount: integer('row_count').notNull(),
  createdAt: text('created_at').notNull(),
});

export const cycleRuleChanges = t('cycle_rule_changes', {
  id: text('id').primaryKey(),
  cycleId: text('cycle_id').notNull(),
  fromRuleVersionId: text('from_rule_version_id').notNull(),
  toRuleVersionId: text('to_rule_version_id').notNull(),
  diff: text('diff', { mode: 'json' }).notNull(),
  changedAt: text('changed_at').notNull(),
});

// ── Catalog (seeded from catalog/bodies/*.yaml) ─────────────────────
export const bodies = t('bodies', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  website: text('website'),
  feeScope: text('fee_scope', { enum: ['membership', 'certification', 'none'] }).notNull(),
});

export const certifications = t('certifications', {
  id: text('id').primaryKey(),
  bodyId: text('body_id')
    .notNull()
    .references(() => bodies.id),
  name: text('name').notNull(),
  abbreviation: text('abbreviation').notNull(),
  creditUnitLabel: text('credit_unit_label').notNull(),
  expires: integer('expires', { mode: 'boolean' }).notNull(),
  retiredOn: text('retired_on'),
});

export const ruleVersions = t(
  'rule_versions',
  {
    id: text('id').primaryKey(), // 'isc2@1'
    bodyId: text('body_id')
      .notNull()
      .references(() => bodies.id),
    version: integer('version').notNull(),
    effectiveFrom: text('effective_from').notNull(),
    sourceUrl: text('source_url').notNull(),
    sourceTitle: text('source_title').notNull(),
    verifiedOn: text('verified_on').notNull(),
    catalogCommit: text('catalog_commit'),
    notes: text('notes'),
  },
  (x) => [uniqueIndex('rv_body_version').on(x.bodyId, x.version)],
);

export const certRequirements = t(
  'cert_requirements',
  {
    id: text('id').primaryKey(),
    ruleVersionId: text('rule_version_id')
      .notNull()
      .references(() => ruleVersions.id),
    certificationId: text('certification_id')
      .notNull()
      .references(() => certifications.id),
    cycleMonths: integer('cycle_months').notNull(),
    totalCreditsX100: integer('total_credits_x100').notNull(),
    annualMinX100: integer('annual_min_x100'),
    annualMinSeverity: text('annual_min_severity', { enum: ['hard', 'soft'] }),
    feeAmountCents: integer('fee_amount_cents'),
    feeCurrency: text('fee_currency'),
    feePeriodMonths: integer('fee_period_months'),
    feeParams: text('fee_params', { mode: 'json' }), // covered_by_higher_cert, waived_if_other_cert_held
  },
  (x) => [uniqueIndex('cr_rv_cert').on(x.ruleVersionId, x.certificationId)],
);

export const creditCategories = t('credit_categories', {
  id: text('id').primaryKey(), // 'isc2@1/A'
  ruleVersionId: text('rule_version_id')
    .notNull()
    .references(() => ruleVersions.id),
  key: text('key').notNull(),
  name: text('name').notNull(),
  parentKey: text('parent_key'),
});

export const creditingRules = t(
  'crediting_rules',
  {
    id: text('id').primaryKey(),
    ruleVersionId: text('rule_version_id')
      .notNull()
      .references(() => ruleVersions.id),
    activityType: text('activity_type').notNull(),
    bodyLabel: text('body_label').notNull(),
    basis: text('basis', { enum: ['per_minutes', 'per_item', 'fixed'] }).notNull(),
    minutesPerCredit: integer('minutes_per_credit'),
    creditsPerItemX100: integer('credits_per_item_x100'),
    rounding: text('rounding', {
      enum: ['floor_quarter', 'floor_half', 'floor_whole', 'nearest_quarter', 'exact'],
    }).notNull(),
    categoryKey: text('category_key'),
    capPerCycleX100: integer('cap_per_cycle_x100'),
    capPerYearX100: integer('cap_per_year_x100'),
    capPerItemX100: integer('cap_per_item_x100'),
    evidenceRequired: integer('evidence_required', { mode: 'boolean' }).notNull().default(true),
    appliesToCertId: text('applies_to_cert_id'),
  },
  (x) => [index('cr_rv_type').on(x.ruleVersionId, x.activityType)],
);

export const constraints = t('constraints', {
  id: text('id').primaryKey(),
  ruleVersionId: text('rule_version_id')
    .notNull()
    .references(() => ruleVersions.id),
  certificationId: text('certification_id'),
  type: text('type', {
    enum: [
      'cycle_total',
      'annual_min',
      'category_min',
      'category_max',
      'activity_type_max',
      'fee_paid',
      'prerequisite_current',
      'attestation',
      'recert_exam',
      'any_of',
    ],
  }).notNull(),
  params: text('params', { mode: 'json' }).notNull(),
  severity: text('severity', { enum: ['hard', 'soft'] })
    .notNull()
    .default('hard'),
});

export const certRelations = t('cert_relations', {
  id: text('id').primaryKey(),
  ruleVersionId: text('rule_version_id')
    .notNull()
    .references(() => ruleVersions.id),
  fromCertId: text('from_cert_id').notNull(),
  toCertId: text('to_cert_id').notNull(),
  relation: text('relation', {
    enum: ['earning_renews', 'credits_flow_down', 'requires_current', 'earning_credits'],
  }).notNull(),
  creditsX100: integer('credits_x100'),
});

// ── User's world ─────────────────────────────────────────────────────
export const memberships = t('memberships', {
  id: text('id').primaryKey(),
  bodyId: text('body_id')
    .notNull()
    .references(() => bodies.id),
  memberNumber: text('member_number'),
  since: text('since'),
});

export const heldCertifications = t('held_certifications', {
  id: text('id').primaryKey(),
  certificationId: text('certification_id')
    .notNull()
    .references(() => certifications.id),
  certNumber: text('cert_number'),
  earnedOn: text('earned_on').notNull(),
  status: text('status', { enum: ['active', 'lapsed', 'retired', 'pursuing'] })
    .notNull()
    .default('active'),
  notes: text('notes'),
});

export const cycles = t(
  'cycles',
  {
    id: text('id').primaryKey(),
    heldCertId: text('held_cert_id')
      .notNull()
      .references(() => heldCertifications.id),
    sequence: integer('sequence').notNull(),
    startsOn: text('starts_on').notNull(),
    endsOn: text('ends_on').notNull(),
    ruleVersionId: text('rule_version_id')
      .notNull()
      .references(() => ruleVersions.id),
    status: text('status', { enum: ['open', 'renewed', 'lapsed'] })
      .notNull()
      .default('open'),
  },
  (x) => [uniqueIndex('cy_held_seq').on(x.heldCertId, x.sequence)],
);

export const activities = t('activities', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  occurredOn: text('occurred_on').notNull(),
  provider: text('provider'),
  durationMinutes: integer('duration_minutes'),
  itemCount: integer('item_count').default(1),
  activityType: text('activity_type').notNull(), // canonical key
  description: text('description'),
  source: text('source', { enum: ['manual', 'extracted', 'import'] }).notNull(),
  status: text('status', { enum: ['draft', 'logged'] })
    .notNull()
    .default('draft'),
  createdAt: text('created_at').notNull(),
});

// The heart of the application.
export const creditApplications = t(
  'credit_applications',
  {
    id: text('id').primaryKey(),
    activityId: text('activity_id')
      .notNull()
      .references(() => activities.id),
    heldCertId: text('held_cert_id')
      .notNull()
      .references(() => heldCertifications.id),
    cycleId: text('cycle_id')
      .notNull()
      .references(() => cycles.id),
    creditsX100: integer('credits_x100').notNull(),
    categoryKey: text('category_key'),
    status: text('status', {
      enum: ['planned', 'claimed', 'submitted', 'accepted', 'rejected'],
    }).notNull(),
    submittedAt: text('submitted_at'),
    resolvedAt: text('resolved_at'),
    issuerReference: text('issuer_reference'),
    ruleVersionId: text('rule_version_id').notNull(),
    creditingRuleId: text('crediting_rule_id'),
    suggestedCreditsX100: integer('suggested_credits_x100'),
    overrideReason: text('override_reason'),
    explanation: text('explanation', { mode: 'json' }),
  },
  (x) => [
    uniqueIndex('ca_activity_cert').on(x.activityId, x.heldCertId),
    index('ca_cycle').on(x.cycleId),
  ],
);

export const evidence = t('evidence', {
  id: text('id').primaryKey(),
  objectKey: text('object_key').notNull(),
  sha256: text('sha256').notNull().unique(),
  filename: text('filename').notNull(),
  contentType: text('content_type').notNull(),
  sizeBytes: integer('size_bytes').notNull(),
  extractedText: text('extracted_text'),
  extractionStatus: text('extraction_status', {
    enum: ['pending', 'done', 'no_text', 'failed', 'manual'],
  }).notNull(),
  extractionMethod: text('extraction_method'),
  uploadedAt: text('uploaded_at').notNull(),
});

export const activityEvidence = t(
  'activity_evidence',
  {
    activityId: text('activity_id')
      .notNull()
      .references(() => activities.id),
    evidenceId: text('evidence_id')
      .notNull()
      .references(() => evidence.id),
  },
  (x) => [uniqueIndex('ae_pk').on(x.activityId, x.evidenceId)],
);

export const payments = t('payments', {
  id: text('id').primaryKey(),
  targetType: text('target_type', { enum: ['cycle', 'membership'] }).notNull(),
  targetId: text('target_id').notNull(),
  periodStart: text('period_start').notNull(),
  periodEnd: text('period_end').notNull(),
  dueOn: text('due_on').notNull(),
  amountCents: integer('amount_cents').notNull(),
  currency: text('currency').notNull().default('USD'),
  paidOn: text('paid_on'),
  confirmationRef: text('confirmation_ref'),
  status: text('status', { enum: ['due', 'paid', 'waived'] })
    .notNull()
    .default('due'),
  waiveReason: text('waive_reason'),
});

export const renewals = t('renewals', {
  id: text('id').primaryKey(),
  closedCycleId: text('closed_cycle_id')
    .notNull()
    .references(() => cycles.id),
  openedCycleId: text('opened_cycle_id').references(() => cycles.id),
  renewedOn: text('renewed_on').notNull(),
  issuerConfirmation: text('issuer_confirmation'),
  notes: text('notes'),
});
