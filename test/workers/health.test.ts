import { createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import worker from '../../src/entry.cloudflare';

describe('GET /api/health (workerd + D1)', () => {
  it('increments across calls', async () => {
    const call = async () => {
      const ctx = createExecutionContext();
      const res = await worker.fetch(new Request('http://x/api/health'), env, ctx);
      await waitOnExecutionContext(ctx);
      expect(res.status).toBe(200);
      return (await res.json()) as { ok: boolean; pings: number };
    };
    const a = await call();
    const b = await call();
    expect(a.ok).toBe(true);
    expect(b.pings).toBe(a.pings + 1);
  });
});
