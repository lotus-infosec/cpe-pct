import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(import.meta.dirname, '../..');
const pub = (f: string) => path.join(root, 'web/public', f);
const html = readFileSync(path.join(root, 'web/index.html'), 'utf8');

/** Width, height and colour type from a PNG's IHDR chunk. Colour type 2 is RGB with no alpha. */
function png(file: string) {
  const b = readFileSync(pub(file));
  expect(b.subarray(1, 4).toString('latin1')).toBe('PNG');
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20), colourType: b[25] };
}

describe('brand and public surface', () => {
  it('the app is never indexed', () => {
    expect(html).toMatch(/<meta name="robots" content="noindex, nofollow"/);
  });

  it('every icon, manifest and card the page references exists', () => {
    const refs = [...html.matchAll(/(?:href|content)="(\/[^"]+\.(?:svg|png|webmanifest))"/g)].map(
      (m) => m[1]!,
    );
    expect(refs).toEqual(
      expect.arrayContaining([
        '/favicon.svg',
        '/favicon.png',
        '/apple-touch-icon.png',
        '/site.webmanifest',
        '/og.png',
      ]),
    );
    for (const r of refs) expect(existsSync(pub(r.slice(1))), r).toBe(true);
  });

  it('icons have the sizes their tags declare, and opaque ones carry no alpha', () => {
    expect(png('favicon.png')).toMatchObject({ width: 96, height: 96 });
    // iOS fills transparency with black and masks the corners itself; a social card with alpha
    // loses its white lettering on a light preview.
    for (const [file, w, h] of [
      ['apple-touch-icon.png', 180, 180],
      ['icon-192.png', 192, 192],
      ['icon-512.png', 512, 512],
      ['og.png', 1200, 630],
    ] as const)
      expect(png(file), file).toEqual({ width: w, height: h, colourType: 2 });
  });

  it('the SVG favicon is small and embeds a valid image type', () => {
    const svg = readFileSync(pub('favicon.svg'), 'utf8');
    expect(svg).not.toContain('data:img/');
    expect(svg.length).toBeLessThan(150_000);
  });

  it('the manifest names the app, its colours and both icons', () => {
    const m = JSON.parse(readFileSync(pub('site.webmanifest'), 'utf8'));
    expect(m).toMatchObject({
      name: 'CPE PCT',
      short_name: 'CPE PCT',
      start_url: '/',
      display: 'standalone',
      theme_color: '#0d1117',
      background_color: '#0d1117',
    });
    for (const i of m.icons) {
      expect(existsSync(pub(i.src.slice(1))), i.src).toBe(true);
      const { width, height } = png(i.src.slice(1));
      expect(`${width}x${height}`).toBe(i.sizes);
    }
    expect(m.icons.some((i: { purpose: string }) => i.purpose === 'maskable')).toBe(true);
  });
});
