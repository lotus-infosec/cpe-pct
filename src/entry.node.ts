// src/entry.node.ts — self-hosted entrypoint. Serves the API and the built SPA from web/dist.
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { createApp } from './app';
import { openNodeDb } from './adapters/node/db';
import { systemClock } from './adapters/shared/clock';
import { LocalAuth } from './adapters/shared/local-auth';
import { FsObjectStore } from './adapters/node/fs-object-store';
import { IntervalTickSource } from './adapters/node/interval-tick';
import { PdfTextExtractor } from './adapters/shared/pdf-text-extractor';
import { DbJobQueue } from './adapters/shared/db-job-queue';
import { tick } from './app';

const DATA_DIR = process.env['DATA_DIR'] ?? './data';
const PORT = Number(process.env['PORT'] ?? 8787);
const WEB_DIST = process.env['WEB_DIST'] ?? './web/dist';
const MIGRATIONS = process.env['MIGRATIONS_DIR'] ?? './src/db/migrations';

await mkdir(DATA_DIR, { recursive: true });
const db = await openNodeDb(path.join(DATA_DIR, 'app.db'), { migrationsFolder: MIGRATIONS });

const root = new Hono();
const ctx = {
  db,
  clock: systemClock,
  auth: new LocalAuth(db, systemClock),
  objectStore: new FsObjectStore(DATA_DIR),
  textExtractor: new PdfTextExtractor(),
  jobQueue: new DbJobQueue(db, systemClock),
};
root.route('/', createApp(ctx));
new IntervalTickSource(Number(process.env['TICK_MS'] ?? 15_000)).start((budget) =>
  tick(ctx, budget).then(() => undefined),
);
// A mounted sub-app's notFound does not apply here; keep unknown API paths out of the SPA fallback.
root.all('/api/*', (c) => c.json({ error: 'not_found' }, 404));
// Static SPA with deep-link fallback: unknown non-API paths get index.html (mirrors CF assets).
root.use('/*', serveStatic({ root: WEB_DIST }));
root.get('/*', serveStatic({ root: WEB_DIST, path: 'index.html' }));

serve({ fetch: root.fetch, port: PORT }, (info) => {
  console.log(`cpe-pct listening on http://localhost:${info.port} (data: ${DATA_DIR})`);
});
