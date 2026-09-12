// Zod schema for catalog/bodies/*.yaml. Mirrors catalog/TEMPLATE.yaml exactly.
// Rules are DATA: every version needs at least one source with a retrieval date.
import { z } from 'zod';
import { ACTIVITY_TYPES } from '../src/core/domain/activity-types';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD');
const certId = z.string().regex(/^[a-z0-9-]+\/[a-z0-9-]+$/, '<body>/<slug>');
const money = z.number().nonnegative().multipleOf(0.01);
const credits = z.number().nonnegative().multipleOf(0.01);

export const Rounding = z.enum([
  'floor_quarter',
  'floor_half',
  'floor_whole',
  'nearest_quarter',
  'exact',
]);
export const Basis = z.enum(['per_minutes', 'per_item', 'fixed']);
export const Severity = z.enum(['hard', 'soft']);
export const ConstraintType = z.enum([
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
]);
export const RelationType = z.enum([
  'earning_renews',
  'credits_flow_down',
  'requires_current',
  'earning_credits',
]);

export const Source = z.object({
  url: z.string().url(),
  title: z.string().min(1),
  retrieved_on: isoDate,
  sha256: z
    .string()
    .regex(/^[0-9a-f]{64}$/)
    .optional(),
  pointer: z.string().optional(),
});

export const Fee = z.object({
  amount: money,
  currency: z.string().length(3),
  period_months: z.number().int().positive(),
  covered_by_higher_cert: z.boolean().optional(),
  waived_if_other_cert_held: z.boolean().optional(),
});

export const Requirement = z.object({
  certification: certId,
  cycle_months: z.number().int().positive(),
  total_credits: credits,
  annual_min: credits.optional(),
  annual_min_severity: Severity.optional(),
  fee: Fee.optional(),
});

export const Crediting = z
  .object({
    activity_type: z.enum(ACTIVITY_TYPES),
    body_label: z.string().min(1),
    basis: Basis,
    minutes_per_credit: z.number().int().positive().optional(),
    credits_per_item: credits.optional(),
    rounding: Rounding.default('exact'),
    category: z.string().optional(),
    cap_per_cycle: credits.nullable().optional(),
    cap_per_year: credits.nullable().optional(),
    cap_per_item: credits.nullable().optional(),
    evidence_required: z.boolean().default(true),
    applies_to: certId.nullable().optional(),
  })
  .superRefine((r, ctx) => {
    if (r.basis === 'per_minutes' && !r.minutes_per_credit)
      ctx.addIssue({ code: 'custom', message: 'per_minutes needs minutes_per_credit' });
    if (r.basis !== 'per_minutes' && r.credits_per_item === undefined)
      ctx.addIssue({ code: 'custom', message: `${r.basis} needs credits_per_item` });
  });

export const Constraint = z.object({
  type: ConstraintType,
  params: z.record(z.string(), z.unknown()).default({}),
  severity: Severity.default('hard'),
  applies_to: certId.nullable().optional(),
});

export const Relation = z.object({
  from: certId,
  to: certId,
  relation: RelationType,
  credits: credits.optional(),
});

export const Version = z.object({
  version: z.number().int().positive(),
  effective_from: isoDate,
  verified_on: isoDate,
  sources: z.array(Source).min(1),
  notes: z.string().optional(),
  categories: z
    .array(
      z.object({
        key: z.string().min(1),
        name: z.string().min(1),
        parent_key: z.string().optional(),
      }),
    )
    .default([]),
  requirements: z.array(Requirement).min(1),
  crediting: z.array(Crediting).default([]),
  constraints: z.array(Constraint).default([]),
  relations: z.array(Relation).default([]),
});

export const BodyFile = z
  .object({
    schema: z.literal(1),
    body: z.object({
      id: z.string().regex(/^[a-z0-9-]+$/),
      name: z.string().min(1),
      website: z.string().url().optional(),
      fee_scope: z.enum(['membership', 'certification', 'none']),
    }),
    certifications: z
      .array(
        z.object({
          id: certId,
          name: z.string().min(1),
          abbreviation: z.string().min(1),
          credit_unit_label: z.string().min(1),
          expires: z.boolean(),
          retired_on: isoDate.optional(),
        }),
      )
      .min(1),
    versions: z.array(Version).min(1),
  })
  .superRefine((f, ctx) => {
    const certIds = new Set(f.certifications.map((c) => c.id));
    for (const c of f.certifications)
      if (!c.id.startsWith(`${f.body.id}/`))
        ctx.addIssue({
          code: 'custom',
          message: `certification ${c.id} must start with ${f.body.id}/`,
        });
    const seen = new Set<number>();
    for (const v of f.versions) {
      if (seen.has(v.version))
        ctx.addIssue({ code: 'custom', message: `duplicate version ${v.version}` });
      seen.add(v.version);
      const cats = new Set(v.categories.map((c) => c.key));
      for (const r of v.requirements)
        if (!certIds.has(r.certification))
          ctx.addIssue({
            code: 'custom',
            message: `v${v.version}: unknown certification ${r.certification}`,
          });
      for (const r of v.crediting) {
        if (r.category && !cats.has(r.category))
          ctx.addIssue({
            code: 'custom',
            message: `v${v.version}: unknown category ${r.category}`,
          });
        if (r.applies_to && !certIds.has(r.applies_to))
          ctx.addIssue({
            code: 'custom',
            message: `v${v.version}: unknown applies_to ${r.applies_to}`,
          });
      }
      for (const c of v.constraints)
        if (c.applies_to && !certIds.has(c.applies_to))
          ctx.addIssue({
            code: 'custom',
            message: `v${v.version}: unknown applies_to ${c.applies_to}`,
          });
      // `from` may be another body's certification (e.g. isc2/cissp renews comptia/security-plus); `to` must be ours.
      for (const r of v.relations)
        if (!certIds.has(r.to))
          ctx.addIssue({
            code: 'custom',
            message: `v${v.version}: relation to unknown cert ${r.to}`,
          });
    }
  });

export type BodyFile = z.infer<typeof BodyFile>;
export type VersionBlock = z.infer<typeof Version>;
