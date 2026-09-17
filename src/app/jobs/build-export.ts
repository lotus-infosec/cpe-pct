// build_export: load the cycle's applications + evidence, run the body's pure builder, zip in STORE mode
// (fflate), write to the ObjectStore, mark ready, notify. Progress is recorded per evidence file for the UI.
// Not resumable across ticks: a failed run restarts from scratch (idempotent by construction).
import { and, eq, inArray } from 'drizzle-orm';
import { zipSync } from 'fflate';
import * as s from '../../db/schema';
import { newId, type AppContext } from '../context';
import {
  builders,
  generic,
  selectionBundle,
  type ExportApplication,
  type ExportInput,
  type SelectionActivity,
  type SelectionInput,
} from '../../core/exports';
import { chunks } from '../activity-selection';
import type { ActivityType } from '../../core/domain/activity-types';
import { sendPending } from './renewal-scan';

export const exportKey = (id: string) => `exports/${id}.zip`;

export async function loadExportInput(
  ctx: AppContext,
  cycleId: string,
): Promise<ExportInput | null> {
  const db = ctx.db;
  const cycle = await db.select().from(s.cycles).where(eq(s.cycles.id, cycleId)).get();
  if (!cycle) return null;
  const held = await db
    .select({ h: s.heldCertifications, c: s.certifications, b: s.bodies })
    .from(s.heldCertifications)
    .innerJoin(s.certifications, eq(s.certifications.id, s.heldCertifications.certificationId))
    .innerJoin(s.bodies, eq(s.bodies.id, s.certifications.bodyId))
    .where(eq(s.heldCertifications.id, cycle.heldCertId))
    .get();
  if (!held) return null;
  const req = await db
    .select()
    .from(s.certRequirements)
    .where(
      and(
        eq(s.certRequirements.ruleVersionId, cycle.ruleVersionId),
        eq(s.certRequirements.certificationId, held.c.id),
      ),
    )
    .get();
  const membership = await db
    .select()
    .from(s.memberships)
    .where(eq(s.memberships.bodyId, held.b.id))
    .get();
  const apps = await db
    .select({ a: s.creditApplications, act: s.activities })
    .from(s.creditApplications)
    .innerJoin(s.activities, eq(s.activities.id, s.creditApplications.activityId))
    .where(eq(s.creditApplications.cycleId, cycle.id))
    .all();
  const rules = await db
    .select()
    .from(s.creditingRules)
    .where(eq(s.creditingRules.ruleVersionId, cycle.ruleVersionId))
    .all();
  const activityIds = apps.map((x) => x.act.id);
  const links = activityIds.length
    ? await db
        .select({ l: s.activityEvidence, e: s.evidence })
        .from(s.activityEvidence)
        .innerJoin(s.evidence, eq(s.evidence.id, s.activityEvidence.evidenceId))
        .where(inArray(s.activityEvidence.activityId, activityIds))
        .all()
    : [];
  const applications: ExportApplication[] = apps
    .sort((x, y) => x.act.occurredOn.localeCompare(y.act.occurredOn))
    .map(({ a, act }) => ({
      activityId: act.id,
      title: act.title,
      activityType: act.activityType as ActivityType,
      occurredOn: act.occurredOn,
      provider: act.provider,
      description:
        act.description
          ?.split('\n')
          .filter((l) => !l.startsWith('extracted:') && !l.startsWith('related:'))
          .join(' ') || null,
      durationMinutes: act.durationMinutes,
      itemCount: act.itemCount,
      creditsX100: a.creditsX100,
      categoryKey: a.categoryKey,
      bodyLabel: rules.find((r) => r.id === a.creditingRuleId)?.bodyLabel ?? null,
      status: a.status,
      issuerReference: a.issuerReference,
      evidence: links
        .filter((l) => l.l.activityId === act.id)
        .map((l) => ({
          evidenceId: l.e.id,
          filename: l.e.filename,
          sha256: l.e.sha256,
          objectKey: l.e.objectKey,
          contentType: l.e.contentType,
          sizeBytes: l.e.sizeBytes,
        })),
    }));
  return {
    bodyId: held.b.id,
    bodyName: held.b.name,
    certificationId: held.c.id,
    certificationName: held.c.name,
    abbreviation: held.c.abbreviation,
    creditUnitLabel: held.c.creditUnitLabel,
    certNumber: held.h.certNumber,
    memberNumber: membership?.memberNumber ?? null,
    cycle: {
      id: cycle.id,
      sequence: cycle.sequence,
      startsOn: cycle.startsOn,
      endsOn: cycle.endsOn,
      ruleVersionId: cycle.ruleVersionId,
    },
    requiredX100: req?.totalCreditsX100 ?? 0,
    applications,
    generatedAt: ctx.clock.now().toISOString(),
  };
}

export async function loadSelectionInput(
  ctx: AppContext,
  activityIds: string[],
): Promise<SelectionInput> {
  const db = ctx.db;
  const activities: SelectionActivity[] = [];
  for (const part of chunks(activityIds)) {
    const acts = await db.select().from(s.activities).where(inArray(s.activities.id, part)).all();
    const apps = await db
      .select({ a: s.creditApplications, c: s.certifications, b: s.bodies, cy: s.cycles })
      .from(s.creditApplications)
      .innerJoin(s.heldCertifications, eq(s.heldCertifications.id, s.creditApplications.heldCertId))
      .innerJoin(s.certifications, eq(s.certifications.id, s.heldCertifications.certificationId))
      .innerJoin(s.bodies, eq(s.bodies.id, s.certifications.bodyId))
      .innerJoin(s.cycles, eq(s.cycles.id, s.creditApplications.cycleId))
      .where(inArray(s.creditApplications.activityId, part))
      .all();
    const links = await db
      .select({ l: s.activityEvidence, e: s.evidence })
      .from(s.activityEvidence)
      .innerJoin(s.evidence, eq(s.evidence.id, s.activityEvidence.evidenceId))
      .where(inArray(s.activityEvidence.activityId, part))
      .all();
    for (const act of acts)
      activities.push({
        id: act.id,
        title: act.title,
        activityType: act.activityType as ActivityType,
        occurredOn: act.occurredOn,
        provider: act.provider,
        description: act.description,
        durationMinutes: act.durationMinutes,
        itemCount: act.itemCount,
        status: act.status,
        applications: apps
          .filter((x) => x.a.activityId === act.id)
          .map((x) => ({
            certification: x.c.abbreviation,
            bodyName: x.b.name,
            cycleSequence: x.cy.sequence,
            creditsX100: x.a.creditsX100,
            categoryKey: x.a.categoryKey,
            status: x.a.status,
            issuerReference: x.a.issuerReference,
          })),
        evidence: links
          .filter((l) => l.l.activityId === act.id)
          .map((l) => ({
            evidenceId: l.e.id,
            filename: l.e.filename,
            sha256: l.e.sha256,
            objectKey: l.e.objectKey,
            contentType: l.e.contentType,
            sizeBytes: l.e.sizeBytes,
          })),
      });
  }
  return { activities, generatedAt: ctx.clock.now().toISOString() };
}

/** The bundle to zip, and the words the ready notification uses for it. */
async function loadBundle(ctx: AppContext, row: typeof s.exports_.$inferSelect) {
  if (row.activityIds) {
    const input = await loadSelectionInput(ctx, row.activityIds);
    const bundle = selectionBundle(input);
    return {
      bundle,
      key: `selection:export_ready:${row.id}`,
      title: `Selection export ready`,
      body: (files: number, kb: string) =>
        `${input.activities.length} activities with ${bundle.files.length} data files and ${files} evidence files (${kb} KB).`,
    };
  }
  const input = row.cycleId ? await loadExportInput(ctx, row.cycleId) : null;
  if (!input) throw new Error('cycle missing');
  const build = builders[input.bodyId] ?? generic;
  return {
    bundle: build(input),
    key: `${row.cycleId}:export_ready:${row.id}`,
    title: `${input.abbreviation} (${input.bodyName}): export ready`,
    body: (files: number, kb: string) =>
      `Cycle ${input.cycle.sequence} bundle with ${input.applications.length} applications and ${files} evidence files (${kb} KB).`,
  };
}

export async function buildExport(ctx: AppContext, exportId: string): Promise<void> {
  const row = await ctx.db.select().from(s.exports_).where(eq(s.exports_.id, exportId)).get();
  if (!row) return;
  const { bundle, key: notificationKey, title, body } = await loadBundle(ctx, row);
  const enc = new TextEncoder();
  const entries: Record<string, [Uint8Array, { level: 0 }]> = {};
  for (const f of bundle.files) entries[f.name] = [enc.encode(f.content), { level: 0 }];
  let done = 0;
  const missing: string[] = [];
  for (const e of bundle.evidence) {
    const obj = await ctx.objectStore.get(e.objectKey);
    if (!obj) {
      missing.push(e.zipPath);
      continue;
    }
    entries[e.zipPath] = [new Uint8Array(await new Response(obj.body).arrayBuffer()), { level: 0 }];
    done += 1;
    await ctx.db
      .update(s.exports_)
      .set({ progress: { done, total: bundle.evidence.length } })
      .where(eq(s.exports_.id, exportId));
  }
  if (missing.length)
    entries['MISSING-EVIDENCE.txt'] = [enc.encode(missing.join('\n') + '\n'), { level: 0 }];
  const zip = zipSync(entries, { level: 0 });
  const key = exportKey(exportId);
  await ctx.objectStore.put(key, zip, { contentType: 'application/zip', size: zip.byteLength });
  const now = ctx.clock.now().toISOString();
  await ctx.db.batch([
    ctx.db
      .update(s.exports_)
      .set({
        status: 'ready',
        objectKey: key,
        progress: { done, total: bundle.evidence.length, bytes: zip.byteLength },
      })
      .where(eq(s.exports_.id, exportId)),
    ctx.db
      .insert(s.notifications)
      .values({
        id: newId(),
        key: notificationKey,
        kind: 'export_ready',
        severity: 'info',
        title,
        body: body(done, (zip.byteLength / 1024).toFixed(0)),
        status: 'pending',
        createdAt: now,
      })
      .onConflictDoNothing(),
  ]);
  await sendPending(ctx);
}
