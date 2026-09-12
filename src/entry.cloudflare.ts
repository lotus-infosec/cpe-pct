// src/entry.cloudflare.ts — Workers entrypoint. Static assets are served by the platform;
// only /api/* (run_worker_first) and non-navigation misses reach this script.
import { createApp } from './app';
import { openD1 } from './adapters/cloudflare/db';
import { systemClock } from './adapters/shared/clock';
import { LocalAuth } from './adapters/shared/local-auth';

// `Env` is generated into worker-configuration.d.ts by `wrangler types` from wrangler.jsonc.

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const db = openD1(env.DB);
    const app = createApp({ db, clock: systemClock, auth: new LocalAuth(db, systemClock) });
    return app.fetch(request, env);
  },
  async scheduled(
    _controller: ScheduledController,
    _env: Env,
    _ctx: ExecutionContext,
  ): Promise<void> {
    // Stage 3 wires the job runner here. The trigger exists so the deploy contract is proven early.
  },
} satisfies ExportedHandler<Env>;
