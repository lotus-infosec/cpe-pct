import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { openD1 } from '../../src/adapters/cloudflare/db';
import { R2ObjectStore } from '../../src/adapters/cloudflare/r2-object-store';
import { DbJobQueue } from '../../src/adapters/shared/db-job-queue';
import { LocalAuth } from '../../src/adapters/shared/local-auth';
import { PdfTextExtractor } from '../../src/adapters/shared/pdf-text-extractor';
import { renewalScan } from '../../src/app/jobs/renewal-scan';
import * as s from '../../src/db/schema';
import { seedOwnerWorld } from '../seed-world';

// Exit criterion: both tick sources produce identical notification rows for the same data.
// The node project runs the same seed + scan; the keys asserted here must match test/node/scan.test.ts.
describe('renewal_scan on workerd + D1', () => {
  it('produces the same notification keys as Node for the same world', async () => {
    const clock = { now: () => new Date('2026-09-12T09:00:00Z') };
    const db = openD1(env.DB);
    const ctx = {
      db,
      clock,
      auth: new LocalAuth(db, clock),
      objectStore: new R2ObjectStore(env.EVIDENCE),
      textExtractor: new PdfTextExtractor(),
      jobQueue: new DbJobQueue(db, clock),
    };
    await seedOwnerWorld(db, clock.now().toISOString());
    const r1 = await renewalScan(ctx, '2026-09-12');
    expect(r1.inserted).toBe(3);
    const keys = (await db.select({ key: s.notifications.key }).from(s.notifications).all())
      .map((r) => r.key)
      .sort();
    expect(keys).toEqual([
      'cy-cissp:annual_floor_at_risk:1',
      'cy-cissp:fee_overdue:2026-09-11',
      'cy-secplus:cycle_ending:30',
    ]);
    const r2 = await renewalScan(ctx, '2026-09-12');
    expect(r2.inserted).toBe(0);
  });
});
