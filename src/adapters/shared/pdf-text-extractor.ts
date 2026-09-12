// PdfTextExtractor via unpdf (pdf.js serverless build). Same class on both targets.
// Budget: page cap and a wall-clock deadline checked between pages. Over budget → 'budget-exceeded'
// so the caller can fall back to a job (AGENTS §6.3(a)).
import { extractText, getDocumentProxy } from 'unpdf';
import type { CpuBudget, Extraction, TextExtractor } from '../../ports';

export class PdfTextExtractor implements TextExtractor {
  supports(contentType: string): boolean {
    return contentType === 'application/pdf';
  }

  async extract(bytes: Uint8Array, contentType: string, budget: CpuBudget): Promise<Extraction> {
    if (!this.supports(contentType)) return { ok: false, reason: 'unsupported' };
    const started = Date.now();
    try {
      // pdf.js takes ownership of (and may detach) the buffer it is given; never hand it the caller's copy.
      const pdf = await getDocumentProxy(bytes.slice());
      if (pdf.numPages > budget.maxPages)
        return {
          ok: false,
          reason: 'budget-exceeded',
          detail: `${pdf.numPages} pages > ${budget.maxPages}`,
        };
      const parts: string[] = [];
      for (let p = 1; p <= pdf.numPages; p++) {
        if (Date.now() - started > budget.deadlineMs)
          return { ok: false, reason: 'budget-exceeded', detail: `deadline after ${p - 1} pages` };
        const page = await pdf.getPage(p);
        const content = await page.getTextContent();
        parts.push(content.items.map((it) => ('str' in it ? it.str : '')).join(' '));
      }
      const text = parts
        .join('\n')
        .replace(/[ \t]+/g, ' ')
        .trim();
      if (!text) return { ok: false, reason: 'no-text-layer' };
      return { ok: true, text, method: 'pdf-text' };
    } catch (e) {
      return { ok: false, reason: 'error', detail: e instanceof Error ? e.message : String(e) };
    }
  }
}

/** Convenience used by tests: whole-document extraction without the page loop. */
export async function extractAll(bytes: Uint8Array): Promise<string> {
  const pdf = await getDocumentProxy(bytes.slice());
  return (await extractText(pdf, { mergePages: true })).text;
}
