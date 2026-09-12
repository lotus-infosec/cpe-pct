import { defineConfig } from 'drizzle-kit';

// Generates SQL only. Applying is done by wrangler (Cloudflare) and drizzle migrate() (Node),
// both reading the same src/db/migrations folder unmodified. See DECISIONS D-007.
export default defineConfig({
  dialect: 'sqlite',
  schema: './src/db/schema.ts',
  out: './src/db/migrations',
  strict: true,
  verbose: true,
});
