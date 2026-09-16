import { Hono } from 'hono';
import { and, eq, getTableColumns, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import * as s from '../../db/schema';
import { EVIDENCE_MAX_BYTES, INLINE_BUDGET, newId, type Vars } from '../context';
import { sniff } from '../../adapters/shared/sniff';
import { listQuery, offsetOf, orderBy, paged, searchAny, validList } from '../query';
import { draftActivity, fillDraftFromText, objectKey, sha256Hex, statusFor } from '../evidence';

const { extractedText: _text, ...listColumns } = getTableColumns(s.evidence);
const hasLink = sql`(SELECT 1 FROM ${s.activityEvidence} WHERE ${s.activityEvidence.evidenceId} = ${s.evidence.id})`;
const EVIDENCE_SORTS = {
  uploadedAt: s.evidence.uploadedAt,
  size: s.evidence.sizeBytes,
  filename: sql`lower(${s.evidence.filename})`,
} as const;
const evidenceList = listQuery(
  Object.keys(EVIDENCE_SORTS) as [keyof typeof EVIDENCE_SORTS],
  { sort: 'uploadedAt', dir: 'desc' },
  {
    status: z.enum(['pending', 'done', 'no_text', 'failed', 'manual']).optional(),
    // Files are kept when their activities are deleted (STAGE8); this finds the ones left behind.
    linked: z.enum(['linked', 'unlinked']).optional(),
  },
);

export const evidence = new Hono<Vars>()
  .get('/', validList(evidenceList), async (c) => {
    const { db } = c.get('ctx');
    const p = c.req.valid('query');
    const e = s.evidence;
    const where = and(
      searchAny([e.filename], p.q),
      p.status ? eq(e.extractionStatus, p.status) : undefined,
      p.linked === 'linked' ? sql`EXISTS ${hasLink}` : undefined,
      p.linked === 'unlinked' ? sql`NOT EXISTS ${hasLink}` : undefined,
    );
    const [count, rows] = await Promise.all([
      db
        .select({ n: sql<number>`count(*)` })
        .from(e)
        .where(where)
        .get(),
      db
        .select(listColumns)
        .from(e)
        .where(where)
        .orderBy(...orderBy(EVIDENCE_SORTS[p.sort], e.id, p.dir))
        .limit(p.per_page)
        .offset(offsetOf(p))
        .all(),
    ]);
    const links = rows.length
      ? await db
          .select()
          .from(s.activityEvidence)
          .where(
            inArray(
              s.activityEvidence.evidenceId,
              rows.map((r) => r.id),
            ),
          )
          .all()
      : [];
    return c.json(
      paged(
        rows.map((r) => ({
          ...r,
          activityIds: links.filter((l) => l.evidenceId === r.id).map((l) => l.activityId),
        })),
        count?.n ?? 0,
        p,
      ),
    );
  })
  .get('/:id', async (c) => {
    const { db } = c.get('ctx');
    const e = await db
      .select()
      .from(s.evidence)
      .where(eq(s.evidence.id, c.req.param('id')))
      .get();
    if (!e) return c.json({ error: 'not_found' }, 404);
    const links = await db
      .select()
      .from(s.activityEvidence)
      .where(eq(s.activityEvidence.evidenceId, e.id))
      .all();
    return c.json({ ...e, activityIds: links.map((l) => l.activityId) });
  })
  .get('/:id/content', async (c) => {
    const { db, objectStore } = c.get('ctx');
    const e = await db
      .select()
      .from(s.evidence)
      .where(eq(s.evidence.id, c.req.param('id')))
      .get();
    if (!e) return c.json({ error: 'not_found' }, 404);
    const obj = await objectStore.get(e.objectKey);
    if (!obj) return c.json({ error: 'object_missing' }, 404);
    return new Response(obj.body, {
      headers: {
        'content-type': e.contentType,
        'content-length': String(obj.size),
        'content-disposition': `inline; filename="${e.filename.replace(/["\r\n]/g, '')}"`,
        'x-content-type-options': 'nosniff',
        'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'",
      },
    });
  })
  .delete('/:id', async (c) => {
    const { db, objectStore } = c.get('ctx');
    const e = await db
      .select()
      .from(s.evidence)
      .where(eq(s.evidence.id, c.req.param('id')))
      .get();
    if (!e) return c.json({ error: 'not_found' }, 404);
    await db.batch([
      db.delete(s.activityEvidence).where(eq(s.activityEvidence.evidenceId, e.id)),
      db.delete(s.evidence).where(eq(s.evidence.id, e.id)),
    ]);
    await objectStore.delete(e.objectKey);
    return c.json({ ok: true });
  })
  /**
   * multipart: file=<binary> [activityId=<existing activity to link>]
   * Flow (AGENTS §6.3(a)): hash → store (dedup on sha256) → sniff → PDF: inline extract with deadline,
   * over budget → extract_text job; image: manual. Draft activity + link written in one batch.
   */
  .post('/', async (c) => {
    const ctx = c.get('ctx');
    const { db, objectStore, textExtractor, jobQueue } = ctx;
    const len = Number(c.req.header('content-length') ?? 0);
    if (len > EVIDENCE_MAX_BYTES + 4096)
      return c.json({ error: 'too_large', maxBytes: EVIDENCE_MAX_BYTES }, 413);
    const body = await c.req.parseBody();
    const file = body['file'];
    const activityId =
      typeof body['activityId'] === 'string' && body['activityId'] ? body['activityId'] : null;
    if (!(file instanceof File)) return c.json({ error: 'file_required' }, 400);
    if (file.size > EVIDENCE_MAX_BYTES)
      return c.json({ error: 'too_large', maxBytes: EVIDENCE_MAX_BYTES }, 413);
    const bytes = new Uint8Array(await file.arrayBuffer());
    const contentType = sniff(bytes.subarray(0, 16));
    if (!contentType)
      return c.json(
        {
          error: 'unsupported_type',
          accepted: ['application/pdf', 'image/png', 'image/jpeg', 'image/webp'],
        },
        415,
      );
    if (
      activityId &&
      !(await db
        .select({ id: s.activities.id })
        .from(s.activities)
        .where(eq(s.activities.id, activityId))
        .get())
    )
      return c.json({ error: 'unknown_activity' }, 400);

    const sha256 = await sha256Hex(bytes);
    const now = ctx.clock.now().toISOString();
    let ev = await db.select().from(s.evidence).where(eq(s.evidence.sha256, sha256)).get();
    let created = false;
    let extraction: ReturnType<typeof statusFor> | null = null;
    if (!ev) {
      created = true;
      const key = objectKey(sha256);
      await objectStore.put(key, bytes, { contentType, size: bytes.length });
      if (contentType === 'application/pdf')
        extraction = statusFor(await textExtractor.extract(bytes, contentType, INLINE_BUDGET));
      else extraction = { status: 'manual', text: null, method: null };
      ev = {
        id: newId(),
        objectKey: key,
        sha256,
        filename: file.name || 'evidence',
        contentType,
        sizeBytes: bytes.length,
        extractedText: extraction.text,
        extractionStatus: extraction.status,
        extractionMethod: extraction.method,
        uploadedAt: now,
      };
    }

    // Link to the given activity, or create a draft from what we know.
    let linkedActivityId = activityId;
    let from: Record<string, 'extracted'> = {};
    const ops = [];
    if (created) ops.push(db.insert(s.evidence).values(ev));
    if (!linkedActivityId) {
      const d = draftActivity(ctx, ev.extractedText, ev.filename);
      linkedActivityId = d.row.id;
      from = d.from;
      ops.push(db.insert(s.activities).values(d.row));
    }
    const alreadyLinked = await db
      .select()
      .from(s.activityEvidence)
      .where(
        and(
          eq(s.activityEvidence.activityId, linkedActivityId),
          eq(s.activityEvidence.evidenceId, ev.id),
        ),
      )
      .get();
    if (!alreadyLinked)
      ops.push(
        db.insert(s.activityEvidence).values({ activityId: linkedActivityId, evidenceId: ev.id }),
      );
    if (created && extraction?.status === 'pending') {
      // Over the inline budget: queue the job in the same batch via the queue (idempotent on evidence id).
      ops.push(
        db
          .insert(s.jobs)
          .values({
            id: newId(),
            type: 'extract_text',
            payload: { evidenceId: ev.id },
            idempotencyKey: `extract_text:${ev.id}`,
            runAt: now,
            attempts: 0,
            status: 'queued',
            createdAt: now,
          })
          .onConflictDoNothing(),
      );
    }
    if (ops.length) await db.batch(ops as [(typeof ops)[number], ...typeof ops]);
    void jobQueue;
    // Existing activity + fresh text: fill in blanks.
    if (activityId && ev.extractedText) await fillDraftFromText(ctx, activityId, ev.extractedText);
    return c.json(
      {
        evidence: { ...ev, extractedText: undefined },
        activityId: linkedActivityId,
        deduplicated: !created,
        extractionStatus: ev.extractionStatus,
        from,
      },
      201,
    );
  });

export const activityEvidenceRoute = new Hono<Vars>().get('/:id/evidence', async (c) => {
  const { db } = c.get('ctx');
  const rows = await db
    .select({ e: s.evidence })
    .from(s.activityEvidence)
    .innerJoin(s.evidence, eq(s.evidence.id, s.activityEvidence.evidenceId))
    .where(eq(s.activityEvidence.activityId, c.req.param('id')))
    .all();
  return c.json(
    rows.map((r) => ({ ...r.e, extractedText: undefined, hasText: r.e.extractedText != null })),
  );
});
