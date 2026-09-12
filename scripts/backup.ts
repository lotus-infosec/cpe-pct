// npm run backup -- [out.zip]     CPE_URL=http://host:8787 CPE_PASSWORD=...
import { writeFileSync } from 'node:fs';
import { connect } from './lib/client';

const out = process.argv[2] ?? `cpe-pct-backup-${new Date().toISOString().slice(0, 10)}.zip`;
const c = await connect();
const res = await c.fetch('/api/backup');
if (!res.ok) throw new Error(`backup failed: ${res.status} ${await res.text()}`);
writeFileSync(out, new Uint8Array(await res.arrayBuffer()));
console.log(`wrote ${out}`);
