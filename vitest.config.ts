import path from 'node:path';
import { readFileSync } from 'node:fs';
import { defineConfig, type Plugin } from 'vitest/config';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';

// Two projects, one suite each in Stage 0:
//  - node:    the self-hosted adapters against in-memory libSQL
//  - workers: the Worker inside workerd with Miniflare D1/R2, same migrations folder
/** `import x from './file.pdf?raw-bytes'` → ArrayBuffer (fixtures for the Workers runtime, which has no fs). */
const rawBytes: Plugin = {
  name: 'raw-bytes',
  enforce: 'pre',
  resolveId(source, importer) {
    if (!source.endsWith('?raw-bytes')) return null;
    const file = path.resolve(path.dirname(importer ?? ''), source.slice(0, -'?raw-bytes'.length));
    return `\0raw-bytes:${file}`;
  },
  load(id) {
    if (!id.startsWith('\0raw-bytes:')) return null;
    const b64 = readFileSync(id.slice('\0raw-bytes:'.length)).toString('base64');
    return `export default Uint8Array.from(atob(${JSON.stringify(b64)}), (c) => c.charCodeAt(0)).buffer;`;
  },
};

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
          // Pure display helpers from the web app. No DOM: formatting must not depend on one.
          test: { name: 'web', environment: 'node', include: ['test/web/**/*.test.ts'] },
        },
        {
          plugins: [
            rawBytes,
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
