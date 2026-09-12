// npm run restore -- backup.zip [--force]     Restores into an empty instance; --force wipes a non-empty one.
import { readFileSync } from 'node:fs';
import { connect } from './lib/client';

const file = process.argv[2];
if (!file) throw new Error('usage: restore <backup.zip> [--force]');
const force = process.argv.includes('--force');
const c = await connect();
const fd = new FormData();
fd.set('file', new Blob([readFileSync(file)]), file);
if (force) fd.set('force', '1');
const res = await c.fetch('/api/backup/restore', { method: 'POST', body: fd });
const json = (await res.json()) as {
  ok?: boolean;
  error?: string;
  statements?: number;
  objects?: number;
  diffs?: unknown[];
};
if (!res.ok && res.status !== 207)
  throw new Error(`restore failed: ${res.status} ${JSON.stringify(json)}`);
console.log(
  `restored ${json.statements} rows, ${json.objects} evidence objects; verified: ${json.ok}`,
);
if (json.diffs?.length) {
  console.log(JSON.stringify(json.diffs, null, 2));
  process.exit(2);
}
