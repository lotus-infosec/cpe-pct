import { env } from 'cloudflare:test';
import { describe, it } from 'vitest';
import { R2ObjectStore } from '../../src/adapters/cloudflare/r2-object-store';
import { objectStoreContract } from '../object-store-contract';

describe('R2ObjectStore (Miniflare R2)', () => {
  it('satisfies the ObjectStore contract', () =>
    objectStoreContract(new R2ObjectStore(env.EVIDENCE)));
});
