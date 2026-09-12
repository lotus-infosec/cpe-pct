import { createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import worker from '../../src/entry.cloudflare';
import textPdf from '../fixtures/certificate-text.pdf?raw-bytes';
import scannedPdf from '../fixtures/certificate-scanned.pdf?raw-bytes';
import { openD1 } from '../../src/adapters/cloudflare/db';
import { R2ObjectStore } from '../../src/adapters/cloudflare/r2-object-store';
import { DbJobQueue } from '../../src/adapters/shared/db-job-queue';
import { LocalAuth } from '../../src/adapters/shared/local-auth';
import { PdfTextExtractor } from '../../src/adapters/shared/pdf-text-extractor';
import { systemClock } from '../../src/adapters/shared/clock';
import { tick } from '../../src/app';
import * as s from '../../src/db/schema';

let cookie = '';
async function call(path: string, init: RequestInit = {}) {
  const ctx = createExecutionContext();
  const res = await worker.fetch(
    new Request(`http://x${path}`, {
      ...init,
      headers: { cookie, ...(init.headers as Record<string, string>) },
    }),
    env,
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return res;
}
async function upload(bytes: ArrayBuffer, name: string) {
  const fd = new FormData();
  fd.set('file', new Blob([bytes]), name);
  const res = await call('/api/evidence', { method: 'POST', body: fd });
  return { status: res.status, json: (await res.json()) as any };
}

describe('evidence on workerd + D1 + R2', () => {
  it('sets up, uploads a text-layer PDF, gets a populated draft; scanned → manual draft', async () => {
    const r = await call('/api/setup', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: 'correct horse battery staple' }),
    });
    cookie = r.headers.get('set-cookie')!.split(';')[0]!;
    const up = await upload(textPdf, 'cert.pdf');
    expect(up.status).toBe(201);
    expect(up.json.extractionStatus).toBe('done');
    const a = (await (await call(`/api/activities/${up.json.activityId}`)).json()) as any;
    expect(a).toMatchObject({
      title: 'Incident Response Fundamentals',
      occurredOn: '2026-03-14',
      durationMinutes: 210,
      status: 'draft',
    });
    const again = await upload(textPdf, 'cert.pdf');
    expect(again.json.deduplicated).toBe(true);
    const sc = await upload(scannedPdf, 'scan.pdf');
    expect(sc.json.extractionStatus).toBe('no_text');
    const content = await call(`/api/evidence/${up.json.evidence.id}/content`);
    expect(content.headers.get('content-type')).toBe('application/pdf');
    expect((await content.arrayBuffer()).byteLength).toBe(textPdf.byteLength);
  });

  it('the runner behind scheduled() processes a queued extract_text job against R2', async () => {
    const db = openD1(env.DB);
    const ctx = {
      db,
      clock: systemClock,
      auth: new LocalAuth(db, systemClock),
      objectStore: new R2ObjectStore(env.EVIDENCE),
      textExtractor: new PdfTextExtractor(),
      jobQueue: new DbJobQueue(db, systemClock),
    };
    const ev = (await db
      .select()
      .from(s.evidence)
      .where((await import('drizzle-orm')).eq(s.evidence.extractionStatus, 'done'))
      .get())!;
    // Pretend the inline pass ran out of budget: reset and queue.
    await db
      .update(s.evidence)
      .set({ extractionStatus: 'pending', extractedText: null })
      .where((await import('drizzle-orm')).eq(s.evidence.id, ev.id));
    await ctx.jobQueue.enqueue(
      'extract_text',
      { evidenceId: ev.id },
      { idempotencyKey: `extract_text:${ev.id}:test` },
    );
    const result = await tick(ctx, { maxJobs: 5, softDeadlineMs: 20_000 });
    expect(result.failed).toBe(0);
    expect(result.done).toBeGreaterThanOrEqual(1); // the tick also seeds the daily renewal_scan job
    const after = await db
      .select()
      .from(s.evidence)
      .where((await import('drizzle-orm')).eq(s.evidence.id, ev.id))
      .get();
    expect(after?.extractionStatus).toBe('done');
    expect(after?.extractedText).toContain('Certificate of Completion');
  });
});
