import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { FsObjectStore } from '../../src/adapters/node/fs-object-store';
import { objectStoreContract } from '../object-store-contract';
import { sniff } from '../../src/adapters/shared/sniff';
import { readFileSync } from 'node:fs';

describe('FsObjectStore', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'cpe-objstore-'));
  const store = new FsObjectStore(root);
  it('satisfies the ObjectStore contract', () => objectStoreContract(store));
  it('rejects traversal and absolute keys', async () => {
    for (const bad of ['../x', 'evidence/../../x', '/etc/passwd', 'a//b', 'evidence/./x', '']) {
      await expect(store.put(bad, new Uint8Array(1), { contentType: 'x' })).rejects.toThrow();
    }
  });
});

describe('sniff()', () => {
  it.each([
    ['certificate-text.pdf', 'application/pdf'],
    ['certificate-scanned.pdf', 'application/pdf'],
    ['tiny.png', 'image/png'],
    ['tiny.jpg', 'image/jpeg'],
    ['tiny.webp', 'image/webp'],
  ])('%s → %s', (f, t) => expect(sniff(readFileSync(path.join('test/fixtures', f)))).toBe(t));
  it('rejects text and empty', () => {
    expect(sniff(new TextEncoder().encode('hello'))).toBeNull();
    expect(sniff(new Uint8Array(0))).toBeNull();
  });
});
