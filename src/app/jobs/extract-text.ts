// extract_text job: the fallback when inline extraction ran out of budget at upload.
import { eq } from 'drizzle-orm';
import * as s from '../../db/schema';
import { JOB_BUDGET, type AppContext } from '../context';
import { fillDraftFromText, statusFor } from '../evidence';
import type { Handlers } from '../../core/jobs/runner';
import { renewalScan } from './renewal-scan';

export function jobHandlers(ctx: AppContext): Handlers {
  return {
    renewal_scan: async () => {
      await renewalScan(ctx, ctx.clock.now().toISOString().slice(0, 10));
    },
    extract_text: async ({ evidenceId }) => {
      const ev = await ctx.db.select().from(s.evidence).where(eq(s.evidence.id, evidenceId)).get();
      if (!ev) return;
      const obj = await ctx.objectStore.get(ev.objectKey);
      if (!obj) throw new Error(`object missing: ${ev.objectKey}`);
      const bytes = new Uint8Array(await new Response(obj.body).arrayBuffer());
      const x = await ctx.textExtractor.extract(bytes, ev.contentType, JOB_BUDGET);
      const r = statusFor(x);
      const status = r.status === 'pending' ? 'failed' : r.status; // out of budget even as a job → give up honestly
      await ctx.db
        .update(s.evidence)
        .set({ extractionStatus: status, extractedText: r.text, extractionMethod: r.method })
        .where(eq(s.evidence.id, ev.id));
      if (r.text) {
        const links = await ctx.db
          .select()
          .from(s.activityEvidence)
          .where(eq(s.activityEvidence.evidenceId, ev.id))
          .all();
        for (const l of links) await fillDraftFromText(ctx, l.activityId, r.text);
      }
    },
  };
}
