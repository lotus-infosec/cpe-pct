import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DEMO_RESET_CRON } from '../../src/demo';

// wrangler.demo.jsonc must never point at the real deployment's resources, must keep binding names
// the shared `Env` type expects, and must carry the reset cron the entrypoint listens for.
// Strips // and /* */ comments but never inside a string ("/api/*" would otherwise open a comment).
const read = (f: string) =>
  JSON.parse(
    readFileSync(f, 'utf8').replace(/("(?:\\.|[^"\\])*")|\/\/[^\n]*|\/\*[\s\S]*?\*\//g, '$1'),
  ) as any;

describe('wrangler.demo.jsonc', () => {
  const demo = read('wrangler.demo.jsonc');
  const prod = read('wrangler.jsonc');

  it('uses its own Worker, D1 database and R2 bucket', () => {
    expect(demo.name).not.toBe(prod.name);
    expect(demo.d1_databases[0].database_name).not.toBe(prod.d1_databases[0].database_name);
    expect(demo.r2_buckets[0].bucket_name).not.toBe(prod.r2_buckets[0].bucket_name);
    expect(demo.main).toBe('src/entry.demo.ts');
  });

  it('keeps the binding names and migrations of the main config', () => {
    expect(demo.d1_databases[0].binding).toBe(prod.d1_databases[0].binding);
    expect(demo.r2_buckets[0].binding).toBe(prod.r2_buckets[0].binding);
    expect(demo.d1_databases[0].migrations_dir).toBe(prod.d1_databases[0].migrations_dir);
    expect(demo.assets).toEqual(prod.assets);
  });

  it('runs the job cron and the 12-hour reset cron', () => {
    expect(demo.triggers.crons).toEqual(['* * * * *', DEMO_RESET_CRON]);
  });

  it('has no trailing commas', () => {
    expect(readFileSync('wrangler.demo.jsonc', 'utf8').match(/,\s*[}\]]/g)).toBeNull();
  });
});
