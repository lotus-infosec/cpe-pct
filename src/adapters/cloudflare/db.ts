// D1 database for the Cloudflare target. Migrations are applied by wrangler at deploy time.
import { drizzle } from 'drizzle-orm/d1';
import * as schema from '../../db/schema';

export function openD1(binding: D1Database) {
  return drizzle(binding, { schema });
}
