import { describe, expect, it } from 'vitest';
import {
  hashPassword,
  PBKDF2_ITERATIONS,
  verifyPassword,
} from '../../src/adapters/shared/local-auth';

// VERIFY A11: PBKDF2 cost inside workerd. Logged so the number is visible in CI output.
describe('LocalAuth PBKDF2 on workerd', () => {
  it('hashes and verifies within budget', async () => {
    const t0 = performance.now();
    const hash = await hashPassword('correct horse battery staple');
    const t1 = performance.now();
    expect(await verifyPassword('correct horse battery staple', hash)).toBe(true);
    expect(await verifyPassword('wrong', hash)).toBe(false);
    const ms = t1 - t0;
    console.log(`PBKDF2-SHA256 ${PBKDF2_ITERATIONS} iterations: ${ms.toFixed(0)} ms (workerd)`);
    expect(ms).toBeLessThan(5000);
  });
});
