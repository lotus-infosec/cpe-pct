// src/entry.node.ts — self-hosted entrypoint. Serves the API and the built SPA from web/dist.
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { createApp } from './app';
import { openNodeDb } from './adapters/node/db';
import { systemClock } from './adapters/shared/clock';

const DATA_DIR = process.env['DATA_DIR'] ?? './data';
const PORT = Number(process.env['PORT'] ?? 8787);
const WEB_DIST = process.env['WEB_DIST'] ?? './web/dist';
const MIGRATIONS = process.env['MIGRATIONS_DIR'] ?? './src/db/migrations';

await mkdir(DATA_DIR, { recursive: true });
const db = await openNodeDb(path.join(DATA_DIR, 'app.db'), { migrationsFolder: MIGRATIONS });

const root = new Hono();
root.route('/', createApp({ db, clock: systemClock }));
// A mounted sub-app's notFound does not apply here; keep unknown API paths out of the SPA fallback.
root.all('/api/*', (c) => c.json({ error: 'not_found' }, 404));
// Static SPA with deep-link fallback: unknown non-API paths get index.html (mirrors CF assets).
root.use('/*', serveStatic({ root: WEB_DIST }));
root.get('/*', serveStatic({ root: WEB_DIST, path: 'index.html' }));

serve({ fetch: root.fetch, port: PORT }, (info) => {
  console.log(`cpe-pct listening on http://localhost:${info.port} (data: ${DATA_DIR})`);
});
