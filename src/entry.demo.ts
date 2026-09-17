// src/entry.demo.ts — Workers entrypoint for the public demo (demo branch only; wrangler.demo.jsonc).
// Same adapters as entry.cloudflare.ts, wrapped by demoApp: no accounts, capped growth, refused
// file serving and outbound sends. The every-minute cron runs jobs; the 12-hour cron empties the demo.
import { tick } from './app';
import { openD1 } from './adapters/cloudflare/db';
import { R2ObjectStore } from './adapters/cloudflare/r2-object-store';
import { systemClock } from './adapters/shared/clock';
import { DbJobQueue } from './adapters/shared/db-job-queue';
import { LocalAuth } from './adapters/shared/local-auth';
import { PdfTextExtractor } from './adapters/shared/pdf-text-extractor';
import { DEMO_RESET_CRON, demoApp, resetDemo } from './demo';

function context(env: Env) {
  const db = openD1(env.DB);
  return {
    db,
    clock: systemClock,
    auth: new LocalAuth(db, systemClock),
    objectStore: new R2ObjectStore(env.EVIDENCE),
    textExtractor: new PdfTextExtractor(),
    jobQueue: new DbJobQueue(db, systemClock),
  };
}

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    return demoApp(context(env)).fetch(request, env);
  },
  async scheduled(
    controller: ScheduledController,
    env: Env,
    ectx: ExecutionContext,
  ): Promise<void> {
    const ctx = context(env);
    if (controller.cron === DEMO_RESET_CRON) ectx.waitUntil(resetDemo(ctx));
    else ectx.waitUntil(tick(ctx, { maxJobs: 10, softDeadlineMs: 20_000 }).then(() => undefined));
  },
} satisfies ExportedHandler<Env>;
