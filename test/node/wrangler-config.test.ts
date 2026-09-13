import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// The Deploy to Cloudflare button parsed wrangler.jsonc and refused it ("There was a problem
// parsing the Wrangler configuration file") because the file used trailing commas. Wrangler's own
// parser tolerates them; the button's does not, and no other check in this repo reads the file as
// data. Every button-ready template Cloudflare publishes is strict JSON with comments and nothing
// else, so that is what this asserts.
describe('wrangler.jsonc', () => {
  const raw = readFileSync('wrangler.jsonc', 'utf8');

  it('is strict JSON once comments are stripped', () => {
    const stripped = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');
    expect(() => JSON.parse(stripped) as unknown).not.toThrow();
  });

  it('has no trailing commas', () => {
    expect(raw.match(/,\s*[}\]]/g)).toBeNull();
  });
});
