import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import type { createApp } from '../../src/app';
import type { AppContext } from '../../src/app/context';
import type { Extraction, TextExtractor } from '../../src/ports';
import { testApp } from './app';

const clock = { now: () => new Date('2026-09-12T12:00:00Z') };
let app: ReturnType<typeof createApp>;
let ctx: AppContext;
let cookie = '';
const fixture = (f: string) => new Uint8Array(readFileSync(`test/fixtures/${f}`));

async function upload(file: Uint8Array, name: string, activityId?: string) {
  const fd = new FormData();
  fd.set('file', new Blob([file]), name);
  if (activityId) fd.set('activityId', activityId);
  const res = await app.request('/api/evidence', { method: 'POST', body: fd, headers: { cookie } });
  return { status: res.status, json: (await res.json()) as any };
}
const get = async (path: string) => {
  const r = await app.request(path, { headers: { cookie } });
  return { status: r.status, json: (await r.json()) as any, headers: r.headers };
};

beforeAll(async () => {
  ({ app, ctx } = await testApp(clock));
  const r = await app.request('/api/setup', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password: 'correct horse battery staple' }),
  });
  cookie = r.headers.get('set-cookie')!.split(';')[0]!;
});

describe('evidence upload', () => {
  let evidenceId = '';
  let draftId = '';
  it('text-layer PDF → stored, extracted inline, draft populated from the document', async () => {
    const r = await upload(fixture('certificate-text.pdf'), 'cert.pdf');
    expect(r.status).toBe(201);
    expect(r.json).toMatchObject({ deduplicated: false, extractionStatus: 'done' });
    expect(r.json.from).toMatchObject({
      title: 'extracted',
      occurredOn: 'extracted',
      durationMinutes: 'extracted',
      provider: 'extracted',
    });
    evidenceId = r.json.evidence.id;
    draftId = r.json.activityId;
    const a = await get(`/api/activities/${draftId}`);
    expect(a.json).toMatchObject({
      status: 'draft',
      source: 'extracted',
      title: 'Incident Response Fundamentals',
      occurredOn: '2026-03-14',
      durationMinutes: 210,
      provider: 'Example Training Co',
      activityType: 'attend_training',
    });
    const ev = await get(`/api/evidence/${evidenceId}`);
    expect(ev.json).toMatchObject({
      contentType: 'application/pdf',
      extractionStatus: 'done',
      extractionMethod: 'pdf-text',
      activityIds: [draftId],
    });
    expect(ev.json.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(ev.json.objectKey).toBe(
      `evidence/${ev.json.sha256.slice(0, 2)}/${ev.json.sha256.slice(2, 4)}/${ev.json.sha256}`,
    );
  });
  it('same PDF again → one object, a second activity link', async () => {
    const r = await upload(fixture('certificate-text.pdf'), 'cert-copy.pdf');
    expect(r.status).toBe(201);
    expect(r.json).toMatchObject({ deduplicated: true, evidence: { id: evidenceId } });
    expect(r.json.activityId).not.toBe(draftId);
    const ev = await get(`/api/evidence/${evidenceId}`);
    expect(ev.json.activityIds.length).toBe(2);
    const all = await get('/api/evidence');
    expect(all.json.length).toBe(1);
    let n = 0;
    for await (const _ of ctx.objectStore.list('evidence/')) n += 1;
    expect(n).toBe(1);
  });
  it('linking to an existing activity fills its blanks and does not create a draft', async () => {
    const a = await app.request('/api/activities', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        title: 'My own title',
        occurredOn: '2026-01-01',
        activityType: 'other',
      }),
    });
    const id = ((await a.json()) as any).id;
    const r = await upload(fixture('certificate-text.pdf'), 'cert.pdf', id);
    expect(r.json).toMatchObject({ deduplicated: true, activityId: id });
    const after = await get(`/api/activities/${id}`);
    expect(after.json).toMatchObject({
      title: 'My own title',
      occurredOn: '2026-03-14',
      activityType: 'attend_training',
      provider: 'Example Training Co',
    });
    const links = await get(`/api/activities/${id}/evidence`);
    expect(links.json.length).toBe(1);
  });
  it('scanned PDF → no_text, empty draft; PNG → manual', async () => {
    const s = await upload(fixture('certificate-scanned.pdf'), 'scan.pdf');
    expect(s.json.extractionStatus).toBe('no_text');
    const d = await get(`/api/activities/${s.json.activityId}`);
    expect(d.json).toMatchObject({
      status: 'draft',
      source: 'extracted',
      title: 'scan',
      activityType: 'other',
    });
    const p = await upload(fixture('tiny.png'), 'photo.png');
    expect(p.json.extractionStatus).toBe('manual');
    expect(p.json.evidence.contentType).toBe('image/png');
  });
  it('rejects unsupported types and content-type spoofing', async () => {
    const r = await upload(new TextEncoder().encode('%PDX not really'), 'evil.pdf');
    expect(r.status).toBe(415);
  });
  it('streams the content with the sniffed type', async () => {
    const r = await app.request(`/api/evidence/${evidenceId}/content`, { headers: { cookie } });
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toBe('application/pdf');
    expect((await r.arrayBuffer()).byteLength).toBe(fixture('certificate-text.pdf').byteLength);
  });
  it('requires auth', async () => {
    expect((await app.request('/api/evidence')).status).toBe(401);
  });
});

describe('over-budget upload falls back to the extract_text job', () => {
  it('queues, then a tick extracts and fills the draft', async () => {
    let calls = 0;
    const real = ctx.textExtractor;
    const flaky: TextExtractor = {
      supports: (t) => real.supports(t),
      extract: async (b, t, budget): Promise<Extraction> =>
        calls++ === 0 ? { ok: false, reason: 'budget-exceeded' } : real.extract(b, t, budget),
    };
    ctx.textExtractor = flaky;
    // A distinct file so it is not deduplicated against the earlier upload.
    const bytes = fixture('certificate-text.pdf');
    const distinct = new Uint8Array([...bytes, 0x0a, 0x25, 0x20, 0x78]); // trailing comment bytes keep it a valid PDF
    const r = await upload(distinct, 'big.pdf');
    expect(r.json.extractionStatus).toBe('pending');
    const before = await get(`/api/activities/${r.json.activityId}`);
    expect(before.json.title).toBe('big');
    const jobs = await get('/api/jobs');
    expect(jobs.json).toEqual([
      expect.objectContaining({ type: 'extract_text', status: 'queued' }),
    ]);
    const t = await app.request('/api/jobs/tick', { method: 'POST', headers: { cookie } });
    expect(await t.json()).toEqual({ picked: 1, done: 1, failed: 0 });
    const ev = await get(`/api/evidence/${r.json.evidence.id}`);
    expect(ev.json.extractionStatus).toBe('done');
    const after = await get(`/api/activities/${r.json.activityId}`);
    expect(after.json).toMatchObject({
      title: 'Incident Response Fundamentals',
      occurredOn: '2026-03-14',
      source: 'extracted',
    });
    ctx.textExtractor = real;
  });
});
