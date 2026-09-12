// libSQL file database for the self-hosted target.
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';
import * as schema from '../../db/schema';

export async function openNodeDb(file: string, opts: { migrationsFolder?: string } = {}) {
  const client = createClient({ url: `file:${file}` });
  // SQLite/libSQL default is OFF per connection; D1 always enforces. Keep parity (VERIFY A6).
  await client.execute('PRAGMA foreign_keys = ON');
  const db = drizzle(client, { schema });
  if (opts.migrationsFolder) {
    await migrate(db, { migrationsFolder: opts.migrationsFolder });
  }
  return db;
}
