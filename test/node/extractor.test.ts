import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PdfTextExtractor } from '../../src/adapters/shared/pdf-text-extractor';

const x = new PdfTextExtractor();
const text = new Uint8Array(readFileSync('test/fixtures/certificate-text.pdf'));
const scanned = new Uint8Array(readFileSync('test/fixtures/certificate-scanned.pdf'));

describe('PdfTextExtractor', () => {
  it('extracts a text layer', async () => {
    const r = await x.extract(text, 'application/pdf', { maxPages: 20, deadlineMs: 5000 });
    expect(r.ok && r.text).toContain('Certificate of Completion');
  });
  it('reports no-text-layer for a scanned page', async () => {
    expect(await x.extract(scanned, 'application/pdf', { maxPages: 20, deadlineMs: 5000 })).toEqual(
      { ok: false, reason: 'no-text-layer' },
    );
  });
  it('reports budget-exceeded on page cap and on deadline', async () => {
    expect((await x.extract(text, 'application/pdf', { maxPages: 0, deadlineMs: 5000 })).ok).toBe(
      false,
    );
    expect(
      await x.extract(text, 'application/pdf', { maxPages: 20, deadlineMs: -1 }),
    ).toMatchObject({ ok: false, reason: 'budget-exceeded' });
  });
  it('rejects unsupported types and garbage', async () => {
    expect(await x.extract(text, 'image/png', { maxPages: 1, deadlineMs: 1 })).toEqual({
      ok: false,
      reason: 'unsupported',
    });
    expect(
      (
        await x.extract(new TextEncoder().encode('nope'), 'application/pdf', {
          maxPages: 1,
          deadlineMs: 1000,
        })
      ).ok,
    ).toBe(false);
  });
});
