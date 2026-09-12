import { describe, expect, it } from 'vitest';
import { openNodeDb } from '../../src/adapters/node/db';
import { systemClock } from '../../src/adapters/shared/clock';
import { testApp } from './app';

describe('GET /api/health (node + libSQL in-memory)', () => {
  it('increments across calls', async () => {
    const { app } = await testApp(systemClock);
    const call = async () => {
      const res = await app.request('/api/health');
      expect(res.status).toBe(200);
      return (await res.json()) as { ok: boolean; pings: number };
    };
    const a = await call();
    const b = await call();
    expect(a.ok).toBe(true);
    expect(b.pings).toBe(a.pings + 1);
  });

  it('enforces foreign keys on the libSQL connection (VERIFY A6)', async () => {
    const db = await openNodeDb(':memory:');
    const { sql } = await import('drizzle-orm');
    const rows = await db.all<{ foreign_keys: number }>(sql`PRAGMA foreign_keys`);
    expect(rows[0]?.foreign_keys).toBe(1);
  });
});
