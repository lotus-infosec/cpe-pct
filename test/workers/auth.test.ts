import { describe, expect, it } from 'vitest';
import {
  hashPassword,
  PBKDF2_ITERATIONS,
  PBKDF2_MAX_ITERATIONS,
  PBKDF2_ROUNDS,
  verifyPassword,
} from '../../src/adapters/shared/local-auth';

// VERIFY A11: PBKDF2 cost inside workerd. Logged so the number is visible in CI output.
describe('LocalAuth PBKDF2 on workerd', () => {
  // Production workerd rejects a deriveBits call above 100k iterations; the local runtime does
  // not, so this assertion is what stands between a change here and a broken deploy.
  it('keeps a single deriveBits call under the runtime ceiling', () => {
    expect(PBKDF2_ITERATIONS).toBeLessThanOrEqual(PBKDF2_MAX_ITERATIONS);
    expect(PBKDF2_MAX_ITERATIONS).toBe(100_000);
  });

  it('hashes and verifies within budget', async () => {
    const t0 = performance.now();
    const hash = await hashPassword('correct horse battery staple');
    const t1 = performance.now();
    expect(hash.split('$')[1]).toBe(`${PBKDF2_ROUNDS}x${PBKDF2_ITERATIONS}`);
    expect(await verifyPassword('correct horse battery staple', hash)).toBe(true);
    expect(await verifyPassword('wrong', hash)).toBe(false);
    const ms = t1 - t0;
    console.log(
      `PBKDF2-SHA256 ${PBKDF2_ROUNDS}x${PBKDF2_ITERATIONS} iterations: ${ms.toFixed(0)} ms (workerd)`,
    );
    expect(ms).toBeLessThan(5000);
  });

  it('still verifies a single-round hash written before chaining', async () => {
    const legacy = await hashPassword('correct horse battery staple', 50_000, 1);
    expect(legacy.split('$')[1]).toBe('1x50000');
    const bare = legacy.replace('$1x50000$', '$50000$');
    expect(await verifyPassword('correct horse battery staple', bare)).toBe(true);
    expect(await verifyPassword('wrong', bare)).toBe(false);
  });
});
