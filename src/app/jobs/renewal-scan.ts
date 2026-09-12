// renewal_scan: for every open cycle, derive warnings, insert new notifications (dedup on key),
// then send every still-pending notification through the configured notifiers.
import { eq, inArray } from 'drizzle-orm';
import * as s from '../../db/schema';
import { newId, type AppContext } from '../context';
import { feeSchedule } from '../../core/rules/fees';
import { standing } from '../../core/rules';
import { derive } from '../../core/warnings/derive';
import { standingContext } from '../rulesets';
import { notifiersFromSettings } from '../../adapters/shared/notifiers';
import type { Notification } from '../../ports';

export const SCAN_CRON = '0 6 * * *';
export const SCAN_KEY = 'renewal_scan:daily';

export async function readSettings(
  ctx: AppContext,
  keys: string[],
): Promise<Record<string, string>> {
  const rows = keys.length
    ? await ctx.db.select().from(s.settings).where(inArray(s.settings.key, keys)).all()
    : [];
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

export async function renewalScan(
  ctx: AppContext,
  asOf: string,
): Promise<{ derived: number; inserted: number; sent: number; failed: number }> {
  const cycles = await ctx.db.select().from(s.cycles).where(eq(s.cycles.status, 'open')).all();
  const certs = await ctx.db
    .select({ h: s.heldCertifications, c: s.certifications, b: s.bodies })
    .from(s.heldCertifications)
    .innerJoin(s.certifications, eq(s.certifications.id, s.heldCertifications.certificationId))
    .innerJoin(s.bodies, eq(s.bodies.id, s.certifications.bodyId))
    .all();
  const derived: Notification[] = [];
  for (const cycle of cycles) {
    const sctx = await standingContext(ctx.db, cycle, asOf);
    if (!sctx) continue;
    const meta = certs.find((x) => x.h.id === cycle.heldCertId);
    const req = sctx.rules.requirements.find(
      (r) => r.certificationId === sctx.held.certificationId,
    );
    derived.push(
      ...derive({
        standing: standing(cycle, sctx),
        fees: feeSchedule(cycle, sctx, req),
        label: meta ? `${meta.c.abbreviation} (${meta.b.name})` : cycle.heldCertId,
        cycleEndsOn: cycle.endsOn,
        asOf,
      }),
    );
  }
  const now = ctx.clock.now().toISOString();
  let inserted = 0;
  if (derived.length) {
    const before = new Set(
      (
        await ctx.db
          .select({ key: s.notifications.key })
          .from(s.notifications)
          .where(
            inArray(
              s.notifications.key,
              derived.map((n) => n.key),
            ),
          )
          .all()
      ).map((r) => r.key),
    );
    const fresh = derived.filter((n) => !before.has(n.key));
    if (fresh.length) {
      const inserts = fresh.map((n) =>
        ctx.db
          .insert(s.notifications)
          .values({
            id: newId(),
            key: n.key,
            kind: n.kind,
            title: n.title,
            body: n.body,
            severity: n.severity,
            status: 'pending',
            createdAt: now,
          })
          .onConflictDoNothing(),
      );
      await ctx.db.batch(inserts as [(typeof inserts)[number], ...typeof inserts]);
      inserted = fresh.length;
    }
  }
  return { derived: derived.length, inserted, ...(await sendPending(ctx)) };
}

/** Sends every pending notification through the configured notifiers; marks sent only when all succeed. */
export async function sendPending(
  ctx: AppContext,
  fetchFn: typeof fetch = fetch,
): Promise<{ sent: number; failed: number }> {
  const pending = await ctx.db
    .select()
    .from(s.notifications)
    .where(eq(s.notifications.status, 'pending'))
    .all();
  if (!pending.length) return { sent: 0, failed: 0 };
  const notifiers = notifiersFromSettings(
    await readSettings(ctx, ['notify.webhook_url', 'notify.discord_url']),
    fetchFn,
  );
  let sent = 0,
    failed = 0;
  for (const row of pending) {
    const n: Notification = {
      key: row.key,
      kind: row.kind as Notification['kind'],
      title: row.title,
      body: row.body,
      severity: row.severity as Notification['severity'],
    };
    const results = await Promise.all(notifiers.map((x) => x.send(n)));
    if (results.every((r) => r.ok)) {
      await ctx.db
        .update(s.notifications)
        .set({ status: 'sent', sentAt: ctx.clock.now().toISOString() })
        .where(eq(s.notifications.id, row.id));
      sent += 1;
    } else failed += 1;
  }
  return { sent, failed };
}

/** Idempotently enqueues the daily scan. Called on every tick; the idempotency key makes it a no-op after the first. */
export async function ensureRecurringJobs(ctx: AppContext): Promise<void> {
  const existing = await ctx.db
    .select({ id: s.jobs.id })
    .from(s.jobs)
    .where(inArray(s.jobs.status, ['queued', 'running']))
    .all();
  const hasScan =
    (
      await ctx.db
        .select({ id: s.jobs.id })
        .from(s.jobs)
        .where(eq(s.jobs.type, 'renewal_scan'))
        .all()
    ).length > 0;
  void existing;
  if (!hasScan)
    await ctx.jobQueue.enqueue(
      'renewal_scan',
      { asOf: ctx.clock.now().toISOString().slice(0, 10) },
      { idempotencyKey: SCAN_KEY, cron: SCAN_CRON },
    );
}
