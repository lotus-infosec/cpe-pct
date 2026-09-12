import path from 'node:path';
import { defineConfig } from 'vitest/config';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';

// Two projects, one suite each in Stage 0:
//  - node:    the self-hosted adapters against in-memory libSQL
//  - workers: the Worker inside workerd with Miniflare D1/R2, same migrations folder
export default defineConfig(async () => {
  const migrations = await readD1Migrations(path.resolve(import.meta.dirname, 'src/db/migrations'));
  return {
    test: {
      projects: [
        {
          // Pure engine. Imports nothing from adapters; the boundary lint enforces it.
          test: { name: 'core', environment: 'node', include: ['test/core/**/*.test.ts'] },
        },
        {
          test: { name: 'node', environment: 'node', include: ['test/node/**/*.test.ts'] },
        },
        {
          plugins: [
            cloudflareTest({
              wrangler: { configPath: './wrangler.jsonc' },
              miniflare: { bindings: { TEST_MIGRATIONS: migrations } },
            }),
          ],
          test: {
            name: 'workers',
            include: ['test/workers/**/*.test.ts'],
            setupFiles: ['test/workers/setup.ts'],
          },
        },
      ],
    },
  };
});
