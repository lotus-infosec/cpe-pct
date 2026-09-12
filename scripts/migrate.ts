// Applies src/db/migrations to $DATA_DIR/app.db. Used by docker/entrypoint.sh and `npm run db:migrate`.
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { openNodeDb } from '../src/adapters/node/db';

const DATA_DIR = process.env['DATA_DIR'] ?? './data';
const MIGRATIONS = process.env['MIGRATIONS_DIR'] ?? './src/db/migrations';
await mkdir(DATA_DIR, { recursive: true });
await openNodeDb(path.join(DATA_DIR, 'app.db'), { migrationsFolder: MIGRATIONS });
console.log(`migrations applied: ${MIGRATIONS} -> ${path.join(DATA_DIR, 'app.db')}`);
