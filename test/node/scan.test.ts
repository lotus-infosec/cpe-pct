import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import type { AppContext } from '../../src/app/context';
import { ensureRecurringJobs, renewalScan, sendPending } from '../../src/app/jobs/renewal-scan';
import { tick } from '../../src/app';
import * as s from '../../src/db/schema';
import { testContext } from './app';
import { seedOwnerWorld } from '../seed-world';

// Fixed "today"; the seeded world puts a CISSP AMF due yesterday and a Security+ cycle ending in 25 days.
const clock = { now: () => new Date('2026-09-12T09:00:00Z') };
let ctx: AppContext;
const sent: { url: string; body: any }[] = [];
const fakeFetch: typeof fetch = async (url, init) => {
  sent.push({ url: String(url), body: JSON.parse(String(init?.body)) });
  return new Response(null, { status: 204 });
};

beforeAll(async () => {
  ctx = await testContext(clock);
  await seedOwnerWorld(ctx.db, clock.now().toISOString());
  await ctx.db.insert(s.settings).values({
    key: 'notify.discord_url',
    value: 'https://discord.example/webhook',
    updatedAt: '2026-09-12',
  });
});

describe('renewal_scan', () => {
  it('derives, inserts, and sends once; a second run adds nothing and re-sends nothing', async () => {
    const r1 = await renewalScan(ctx, '2026-09-12');
    // CISSP: year-1 soft floor missed yesterday + AMF overdue; Security+: cycle ends in 25 days
    expect(r1.inserted).toBe(3);
    const rows = await ctx.db.select().from(s.notifications).all();
    expect(rows.map((n) => n.key).sort()).toEqual([
      'cy-cissp:annual_floor_at_risk:1',
      'cy-cissp:fee_overdue:2026-09-11',
      'cy-secplus:cycle_ending:30',
    ]);
    expect(rows.every((n) => n.status === 'pending')).toBe(true); // real fetch not used in this test
    const first = await sendPending(ctx, fakeFetch);
    expect(first).toEqual({ sent: 3, failed: 0 });
    expect(sent.length).toBe(3);
    expect(sent.map((x) => x.body.embeds[0].footer.text).join(' ')).toContain('fee_overdue');
    const r2 = await renewalScan(ctx, '2026-09-12');
    expect(r2).toMatchObject({ inserted: 0, sent: 0 });
    await sendPending(ctx, fakeFetch);
    expect(sent.length).toBe(3); // no duplicate
  });
  it('a failed send stays pending and retries next time', async () => {
    await ctx.db
      .update(s.notifications)
      .set({ status: 'pending' })
      .where(eq(s.notifications.key, 'cy-secplus:cycle_ending:30'));
    const failing: typeof fetch = async () => new Response('nope', { status: 500 });
    expect(await sendPending(ctx, failing)).toEqual({ sent: 0, failed: 1 });
    expect(
      (await ctx.db
        .select()
        .from(s.notifications)
        .where(eq(s.notifications.key, 'cy-secplus:cycle_ending:30'))
        .get())!.status,
    ).toBe('pending');
    expect(await sendPending(ctx, fakeFetch)).toEqual({ sent: 1, failed: 0 });
  });
  it('the daily job is seeded once by the tick and rescheduled after running', async () => {
    await tick(ctx, { maxJobs: 5, softDeadlineMs: 5000 });
    await tick(ctx, { maxJobs: 5, softDeadlineMs: 5000 });
    await ensureRecurringJobs(ctx);
    const jobs = await ctx.db.select().from(s.jobs).where(eq(s.jobs.type, 'renewal_scan')).all();
    expect(jobs.map((j) => j.status).sort()).toEqual(['done', 'queued']);
    expect(jobs.find((j) => j.status === 'queued')!.runAt).toBe('2026-09-13T06:00:00.000Z');
  });
  it('renewed cycle keeps its applications and pinned version', async () => {
    const closed = await ctx.db.select().from(s.cycles).where(eq(s.cycles.id, 'cy-renewed')).get();
    expect(closed).toMatchObject({ status: 'renewed', ruleVersionId: 'comptia@1' });
    const apps = await ctx.db
      .select()
      .from(s.creditApplications)
      .where(eq(s.creditApplications.cycleId, 'cy-renewed'))
      .all();
    expect(apps.length).toBe(1);
  });
});
