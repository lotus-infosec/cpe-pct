// npm run verify-restore -- backup.zip     Compares the live instance with the manifest inside a backup.
import { readFileSync } from 'node:fs';
import { unzipSync } from 'fflate';
import { connect } from './lib/client';

const file = process.argv[2];
if (!file) throw new Error('usage: verify-restore <backup.zip>');
const files = unzipSync(new Uint8Array(readFileSync(file)));
const manifest = new TextDecoder().decode(files['manifest.json']!);
const c = await connect();
const res = await c.fetch('/api/backup/verify', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: manifest,
});
const json = (await res.json()) as { ok: boolean; diffs: unknown[]; actual: unknown };
console.log(json.ok ? 'OK: zero differences' : `DIFFERENCES: ${json.diffs.length}`);
if (!json.ok) {
  console.log(JSON.stringify(json.diffs, null, 2));
  process.exit(2);
}
