// src/entry.cloudflare.ts — Workers entrypoint. Static assets are served by the platform;
// only /api/* (run_worker_first) and non-navigation misses reach this script.
import { createApp } from './app';
import { openD1 } from './adapters/cloudflare/db';
import { systemClock } from './adapters/shared/clock';
import { LocalAuth } from './adapters/shared/local-auth';
import { R2ObjectStore } from './adapters/cloudflare/r2-object-store';
import { PdfTextExtractor } from './adapters/shared/pdf-text-extractor';
import { DbJobQueue } from './adapters/shared/db-job-queue';
import { tick } from './app';

// `Env` is generated into worker-configuration.d.ts by `wrangler types` from wrangler.jsonc.

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
    return createApp(context(env)).fetch(request, env);
  },
  async scheduled(
    _controller: ScheduledController,
    env: Env,
    ectx: ExecutionContext,
  ): Promise<void> {
    // One bounded pass per cron fire; the wall-clock budget stays far under limits.cpu_ms.
    ectx.waitUntil(
      tick(context(env), { maxJobs: 10, softDeadlineMs: 20_000 }).then(() => undefined),
    );
  },
} satisfies ExportedHandler<Env>;
