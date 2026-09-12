// Stage 0 exit criterion: the same src/db/migrations folder, unmodified, applied by BOTH appliers.
//  (a) Drizzle migrate() over libSQL  — what the Docker entrypoint runs
//  (b) `wrangler d1 migrations apply DB --local` — the same wrangler command the deploy script runs remotely
// Then compares the resulting table sets. Run by CI and `npm run db:check`.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { sql } from 'drizzle-orm';
import { openNodeDb } from '../src/adapters/node/db';

const folder = path.resolve('src/db/migrations');
const userTables = (names: string[]) =>
  names.filter((n) => !n.startsWith('_') && !n.startsWith('sqlite_') && n !== 'd1_migrations');

// (a) libSQL
const db = await openNodeDb(':memory:', { migrationsFolder: folder });
const libsqlRows = await db.all<{ name: string }>(
  sql`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`,
);
const libsqlTables = userTables(libsqlRows.map((r) => r.name));
console.log(`libSQL ok: ${libsqlTables.join(', ')}`);

// (b) wrangler local D1, fresh state directory
const persist = mkdtempSync(path.join(os.tmpdir(), 'cpe-pct-d1-'));
const wrangler = (...args: string[]) =>
  execFileSync('npx', ['wrangler', ...args, '--local', '--persist-to', persist], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
    env: { ...process.env, WRANGLER_SEND_METRICS: 'false' },
  });
try {
  console.log(wrangler('d1', 'migrations', 'apply', 'DB').trim());
  const out = wrangler(
    'd1',
    'execute',
    'DB',
    '--json',
    '--command',
    `SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`,
  );
  const json = JSON.parse(out.slice(out.indexOf('['))) as { results: { name: string }[] }[];
  const d1Tables = userTables((json[0]?.results ?? []).map((r) => r.name));
  console.log(`D1 (wrangler --local) ok: ${d1Tables.join(', ')}`);
  if (libsqlTables.join() !== d1Tables.join()) {
    throw new Error(`table sets differ: libSQL=[${libsqlTables}] D1=[${d1Tables}]`);
  }
  console.log('OK: identical table sets from one migrations folder.');
} finally {
  rmSync(persist, { recursive: true, force: true });
}
