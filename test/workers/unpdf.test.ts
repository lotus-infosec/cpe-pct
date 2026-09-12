import { describe, expect, it } from 'vitest';
import { extractText, getDocumentProxy } from 'unpdf';
import textPdf from '../fixtures/certificate-text.pdf?raw-bytes';
import scannedPdf from '../fixtures/certificate-scanned.pdf?raw-bytes';

// VERIFY A4: unpdf (pdf.js serverless build) inside workerd, no canvas.
describe('unpdf on workerd', () => {
  it('extracts a text layer', async () => {
    const t0 = performance.now();
    const pdf = await getDocumentProxy(new Uint8Array(textPdf));
    const { totalPages, text } = await extractText(pdf, { mergePages: true });
    console.log(
      `unpdf: ${totalPages} page(s) in ${(performance.now() - t0).toFixed(0)} ms (workerd)`,
    );
    expect(totalPages).toBe(1);
    expect(text).toContain('Certificate of Completion');
    expect(text).toContain('March 14, 2026');
  });
  it('returns empty text for an image-only page', async () => {
    const pdf = await getDocumentProxy(new Uint8Array(scannedPdf));
    const { text } = await extractText(pdf, { mergePages: true });
    expect(text.trim()).toBe('');
  });
});
