// "Check for catalog updates": the ONE outbound call this app ever makes on its own, and only when the
// owner presses the button (DECISIONS D-024). It fetches exactly one file — catalog/lock.json from this
// repository's main branch — and compares it with the lock compiled into this build. Nothing is sent.
import { Hono } from 'hono';
import type { Vars } from '../context';
import localLock from '../../../catalog/lock.json';

export const CATALOG_LOCK_URL =
  'https://raw.githubusercontent.com/lotus-infosec/cpe-pct/main/catalog/lock.json';

type Lock = Record<string, { hash: string; migration: string; verified_on: string }>;

export function compareLocks(local: Lock, remote: Lock) {
  const bodyOf = (k: string) => k.split('@')[0]!;
  const latest = (lock: Lock) => {
    const m = new Map<string, { version: number; verified_on: string }>();
    for (const [k, v] of Object.entries(lock)) {
      const [body, ver] = k.split('@');
      const n = Number(ver);
      const cur = m.get(body!);
      if (!cur || n > cur.version) m.set(body!, { version: n, verified_on: v.verified_on });
    }
    return m;
  };
  const l = latest(local),
    r = latest(remote);
  const updates: { body: string; local: number | null; remote: number; verified_on: string }[] = [];
  for (const [body, rv] of r) {
    const lv = l.get(body);
    if (!lv || rv.version > lv.version)
      updates.push({
        body,
        local: lv?.version ?? null,
        remote: rv.version,
        verified_on: rv.verified_on,
      });
  }
  void bodyOf;
  return { updates, localBodies: [...l.keys()].sort(), remoteBodies: [...r.keys()].sort() };
}

export const catalogUpdates = new Hono<Vars>().post('/check', async (c) => {
  let res: Response;
  try {
    res = await fetch(CATALOG_LOCK_URL, { headers: { accept: 'application/json' } });
  } catch (e) {
    return c.json(
      {
        error: 'fetch_failed',
        detail: e instanceof Error ? e.message : String(e),
        url: CATALOG_LOCK_URL,
      },
      502,
    );
  }
  if (!res.ok)
    return c.json({ error: 'fetch_failed', status: res.status, url: CATALOG_LOCK_URL }, 502);
  const remote = (await res.json()) as Lock;
  return c.json({
    url: CATALOG_LOCK_URL,
    checkedAt: c.get('ctx').clock.now().toISOString(),
    ...compareLocks(localLock as Lock, remote),
  });
});
