// Evidence intake shared by the upload route and the extract_text job.
import { eq } from 'drizzle-orm';
import * as s from '../db/schema';
import { draft } from '../core/intake/draft';
import type { Extraction } from '../ports';
import { newId, type AppContext } from './context';

export const objectKey = (sha256: string) =>
  `evidence/${sha256.slice(0, 2)}/${sha256.slice(2, 4)}/${sha256}`;

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return [...d].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export type ExtractionStatus = (typeof s.evidence.$inferSelect)['extractionStatus'];

export function statusFor(x: Extraction): {
  status: ExtractionStatus;
  text: string | null;
  method: string | null;
} {
  if (x.ok) return { status: 'done', text: x.text, method: x.method };
  if (x.reason === 'budget-exceeded') return { status: 'pending', text: null, method: null };
  if (x.reason === 'no-text-layer' || x.reason === 'unsupported')
    return { status: 'no_text', text: null, method: null };
  return { status: 'failed', text: null, method: null };
}

/** Builds the draft activity row for an evidence file. Fields not extracted stay empty for the user. */
export function draftActivity(ctx: AppContext, text: string | null, filename: string) {
  const d = text ? draft(text) : { from: {} as Record<string, 'extracted'> };
  return {
    row: {
      id: newId(),
      title: d.title ?? filename.replace(/\.[a-z0-9]+$/i, ''),
      occurredOn: d.occurredOn ?? ctx.clock.now().toISOString().slice(0, 10),
      provider: d.provider ?? null,
      durationMinutes: d.durationMinutes ?? null,
      itemCount: 1,
      activityType: d.activityType ?? 'other',
      description:
        [
          d.creditsHint != null ? `document states ${d.creditsHint} credits` : null,
          Object.keys(d.from).length ? `extracted:${Object.keys(d.from).join(',')}` : null,
        ]
          .filter(Boolean)
          .join('\n') || null,
      // Evidence-born drafts are 'extracted' even before text arrives, so a later fill may replace placeholders.
      source: 'extracted' as const,
      status: 'draft' as const,
      createdAt: ctx.clock.now().toISOString(),
    } satisfies typeof s.activities.$inferInsert,
    from: d.from,
  };
}

/** Applies extracted text to an existing draft activity that still has placeholder values. */
export async function fillDraftFromText(
  ctx: AppContext,
  activityId: string,
  text: string,
): Promise<void> {
  const a = await ctx.db.select().from(s.activities).where(eq(s.activities.id, activityId)).get();
  if (!a || a.status !== 'draft') return;
  const d = draft(text);
  const patch: Partial<typeof s.activities.$inferInsert> = {};
  if (d.title && a.source !== 'manual') patch.title = d.title;
  if (d.occurredOn) patch.occurredOn = d.occurredOn;
  if (d.provider && !a.provider) patch.provider = d.provider;
  if (d.durationMinutes && !a.durationMinutes) patch.durationMinutes = d.durationMinutes;
  if (d.activityType && a.activityType === 'other') patch.activityType = d.activityType;
  patch.source = 'extracted';
  patch.description = [
    a.description,
    d.creditsHint != null ? `document states ${d.creditsHint} credits` : null,
    `extracted:${Object.keys(d.from).join(',')}`,
  ]
    .filter(Boolean)
    .join('\n');
  await ctx.db.update(s.activities).set(patch).where(eq(s.activities.id, activityId));
}
