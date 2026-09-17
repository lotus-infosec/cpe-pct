// What "these activities" means for bulk operations (STAGE8): either up to 500 explicit ids, or the
// active list filter plus the count the person was shown. Filter mode refuses to act when the
// matching set has changed since that count, so nobody deletes rows they never saw.
import { z } from 'zod';
import { and, eq, gte, inArray, lte, sql, type SQL } from 'drizzle-orm';
import * as s from '../db/schema';
import type { Db } from '../db/client';
import { ACTIVITY_TYPES } from '../core/domain/activity-types';
import { isoDateParam, qParam, searchAny } from './query';

export const MAX_IDS = 500;
/** Largest set a filter may select in one operation. */
export const MAX_MATCH = 10_000;
/** D1 allows 100 bound parameters per statement; stay well under it. */
export const PARAM_CHUNK = 50;

export const activityFilter = z.object({
  q: qParam,
  type: z.enum(ACTIVITY_TYPES).optional(),
  status: z.enum(['draft', 'logged']).optional(),
  from: isoDateParam.optional(),
  to: isoDateParam.optional(),
});
export type ActivityFilter = z.output<typeof activityFilter>;

export function activityWhere(f: ActivityFilter): SQL | undefined {
  const a = s.activities;
  return and(
    searchAny([a.title, a.provider, a.description], f.q),
    f.type ? eq(a.activityType, f.type) : undefined,
    f.status ? eq(a.status, f.status) : undefined,
    f.from ? gte(a.occurredOn, f.from) : undefined,
    f.to ? lte(a.occurredOn, f.to) : undefined,
  );
}

const selectionFields = {
  ids: z.array(z.string().min(1).max(100)).min(1).max(MAX_IDS).optional(),
  filter: activityFilter.optional(),
  expectedCount: z.number().int().min(1).max(MAX_MATCH).optional(),
};
type SelectionShape = {
  ids?: string[] | undefined;
  filter?: unknown;
  expectedCount?: number | undefined;
};
const oneOf = (b: SelectionShape) => (b.ids ? !b.filter : Boolean(b.filter));
const counted = (b: SelectionShape) => !b.filter || b.expectedCount !== undefined;
const refineSelection = <T extends z.ZodType<SelectionShape>>(schema: T) =>
  schema.refine(oneOf, { message: 'send either ids or filter, not both' }).refine(counted, {
    message: 'filter needs expectedCount, the number of matching activities you were shown',
    path: ['expectedCount'],
  });

export const selectionBody = refineSelection(z.strictObject(selectionFields));
export const bulkDeleteBody = refineSelection(
  z.strictObject({ ...selectionFields, includeSubmitted: z.boolean().optional() }),
);
export type SelectionBody = z.output<typeof selectionBody>;

export const chunks = <T>(xs: T[], n = PARAM_CHUNK): T[][] =>
  Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));

export type Resolved =
  | { ok: true; ids: string[]; unknown: string[] }
  | { ok: false; status: 400 | 409; error: string; matched?: number };

export async function resolveSelection(db: Db, b: SelectionBody): Promise<Resolved> {
  if (b.ids) {
    const wanted = [...new Set(b.ids)];
    const found = new Set<string>();
    for (const part of chunks(wanted))
      for (const r of await db
        .select({ id: s.activities.id })
        .from(s.activities)
        .where(inArray(s.activities.id, part))
        .all())
        found.add(r.id);
    return {
      ok: true,
      ids: wanted.filter((id) => found.has(id)),
      unknown: wanted.filter((id) => !found.has(id)),
    };
  }
  const where = activityWhere(b.filter!);
  const count = await db
    .select({ n: sql<number>`count(*)` })
    .from(s.activities)
    .where(where)
    .get();
  const matched = count?.n ?? 0;
  if (matched > MAX_MATCH) return { ok: false, status: 400, error: 'selection_too_large', matched };
  if (matched !== b.expectedCount)
    return { ok: false, status: 409, error: 'selection_changed', matched };
  const rows = await db.select({ id: s.activities.id }).from(s.activities).where(where).all();
  return { ok: true, ids: rows.map((r) => r.id), unknown: [] };
}

export interface DeletePlan {
  /** Activities that will be deleted. */
  ids: string[];
  refused: { id: string; title: string; reason: string }[];
  applicationsRemoved: number;
  /** Distinct evidence files that lose at least one link. */
  evidenceUnlinked: number;
  /** Of those, files left with no link at all. They are kept and shown as unlinked. */
  evidenceOrphaned: number;
  cyclesAffected: number;
}

/** Counts exactly what a delete would touch. Writes nothing; the delete runs the same plan. */
export async function planDelete(
  db: Db,
  ids: string[],
  includeSubmitted: boolean,
): Promise<DeletePlan> {
  const ca = s.creditApplications;
  const apps: { activityId: string; status: string; cycleId: string }[] = [];
  const links: { activityId: string; evidenceId: string }[] = [];
  for (const part of chunks(ids)) {
    apps.push(
      ...(await db
        .select({ activityId: ca.activityId, status: ca.status, cycleId: ca.cycleId })
        .from(ca)
        .where(inArray(ca.activityId, part))
        .all()),
    );
    links.push(
      ...(await db
        .select({
          activityId: s.activityEvidence.activityId,
          evidenceId: s.activityEvidence.evidenceId,
        })
        .from(s.activityEvidence)
        .where(inArray(s.activityEvidence.activityId, part))
        .all()),
    );
  }

  const lockedIds = [
    ...new Set(
      apps
        .filter((x) => x.status === 'submitted' || x.status === 'accepted')
        .map((x) => x.activityId),
    ),
  ];
  const refused: DeletePlan['refused'] = [];
  if (!includeSubmitted)
    for (const part of chunks(lockedIds))
      for (const r of await db
        .select({ id: s.activities.id, title: s.activities.title })
        .from(s.activities)
        .where(inArray(s.activities.id, part))
        .all())
        refused.push({
          id: r.id,
          title: r.title,
          reason: 'has credit submitted to or accepted by the issuer',
        });
  const refusedIds = new Set(refused.map((r) => r.id));
  const doomed = ids.filter((id) => !refusedIds.has(id));
  const doomedSet = new Set(doomed);

  const myApps = apps.filter((x) => doomedSet.has(x.activityId));
  const myLinks = links.filter((x) => doomedSet.has(x.activityId));
  const evidenceIds = [...new Set(myLinks.map((l) => l.evidenceId))];
  const stillLinked = new Set<string>();
  for (const part of chunks(evidenceIds))
    for (const l of await db
      .select({
        activityId: s.activityEvidence.activityId,
        evidenceId: s.activityEvidence.evidenceId,
      })
      .from(s.activityEvidence)
      .where(inArray(s.activityEvidence.evidenceId, part))
      .all())
      if (!doomedSet.has(l.activityId)) stillLinked.add(l.evidenceId);

  return {
    ids: doomed,
    refused: refused.sort((x, y) => x.title.localeCompare(y.title)),
    applicationsRemoved: myApps.length,
    evidenceUnlinked: evidenceIds.length,
    evidenceOrphaned: evidenceIds.filter((id) => !stillLinked.has(id)).length,
    cyclesAffected: new Set(myApps.map((x) => x.cycleId)).size,
  };
}

/**
 * Deletes applications, evidence links and the activities themselves, 50 ids to a statement and 16
 * chunks to a batch (48 statements, matching the restore path). Evidence rows and their files stay.
 */
export async function executeDelete(db: Db, ids: string[]): Promise<void> {
  const parts = chunks(ids);
  for (let i = 0; i < parts.length; i += 16) {
    const stmts = parts
      .slice(i, i + 16)
      .flatMap((part) => [
        db.delete(s.creditApplications).where(inArray(s.creditApplications.activityId, part)),
        db.delete(s.activityEvidence).where(inArray(s.activityEvidence.activityId, part)),
        db.delete(s.activities).where(inArray(s.activities.id, part)),
      ]);
    await db.batch(stmts as [(typeof stmts)[number], ...typeof stmts]);
  }
}
