import { applyD1Migrations, env } from 'cloudflare:test';

// Same src/db/migrations folder wrangler applies in production, applied to Miniflare D1.
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
