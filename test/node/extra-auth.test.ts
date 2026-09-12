import { describe, expect, it } from 'vitest';
import { createApp } from '../../src/app';
import { TrustedHeaderAuth } from '../../src/adapters/node/trusted-header-auth';
import { AccessJwtAuth } from '../../src/adapters/cloudflare/access-jwt-auth';
import { testContext } from './app';

const b64url = (b: ArrayBuffer | Uint8Array | string) => {
  const bytes = typeof b === 'string' ? new TextEncoder().encode(b) : new Uint8Array(b);
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
};

describe('TrustedHeaderAuth (grant mode)', () => {
  it('grants a principal from the header only when configured', async () => {
    const ctx = await testContext();
    await ctx.auth.setup('correct horse battery staple');
    const plain = createApp(ctx);
    expect((await plain.request('/api/held', { headers: { 'remote-user': 'lotus' } })).status).toBe(
      401,
    );
    const trusted = createApp({
      ...ctx,
      extraAuth: { mode: 'grant', authenticator: new TrustedHeaderAuth('Remote-User') },
    });
    expect(
      (await trusted.request('/api/held', { headers: { 'remote-user': 'lotus' } })).status,
    ).toBe(200);
    expect((await trusted.request('/api/held')).status).toBe(401);
  });
});

describe('AccessJwtAuth (gate mode)', () => {
  it('verifies an RS256 assertion against the team certs, checks aud/exp, and gates the app', async () => {
    const { publicKey, privateKey } = await crypto.subtle.generateKey(
      {
        name: 'RSASSA-PKCS1-v1_5',
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: 'SHA-256',
      },
      true,
      ['sign', 'verify'],
    );
    const jwk = (await crypto.subtle.exportKey('jwk', publicKey)) as { n?: string; e?: string };
    const certs = { keys: [{ kid: 'k1', kty: 'RSA', n: jwk.n, e: jwk.e, alg: 'RS256' }] };
    const fetchFn: typeof fetch = async (url) => {
      expect(String(url)).toBe('https://team.cloudflareaccess.com/cdn-cgi/access/certs');
      return new Response(JSON.stringify(certs), {
        headers: { 'content-type': 'application/json' },
      });
    };
    const now = 1_800_000_000_000;
    const sign = async (payload: Record<string, unknown>, kid = 'k1') => {
      const h = b64url(JSON.stringify({ alg: 'RS256', kid, typ: 'JWT' }));
      const p = b64url(JSON.stringify(payload));
      const sig = await crypto.subtle.sign(
        'RSASSA-PKCS1-v1_5',
        privateKey,
        new TextEncoder().encode(`${h}.${p}`),
      );
      return `${h}.${p}.${b64url(sig)}`;
    };
    const auth = new AccessJwtAuth('team.cloudflareaccess.com', 'aud-123', fetchFn, () => now);
    const good = await sign({
      aud: ['aud-123'],
      exp: now / 1000 + 600,
      iss: 'https://team.cloudflareaccess.com',
      email: 'owner@example.test',
    });
    expect(await auth.verify(good)).toBe(true);
    expect(await auth.verify(await sign({ aud: ['other'], exp: now / 1000 + 600 }))).toBe(false);
    expect(await auth.verify(await sign({ aud: ['aud-123'], exp: now / 1000 - 1 }))).toBe(false);
    expect(
      await auth.verify(await sign({ aud: ['aud-123'], exp: now / 1000 + 600 }, 'unknown-kid')),
    ).toBe(false);
    const tampered = good.slice(0, -4) + 'AAAA';
    expect(await auth.verify(tampered)).toBe(false);

    const ctx = await testContext();
    await ctx.auth.setup('correct horse battery staple');
    const session = (await ctx.auth.login('correct horse battery staple'))!;
    const cookie = `cpe_session=${session.sessionId}`;
    const app = createApp({ ...ctx, extraAuth: { mode: 'gate', authenticator: auth } });
    // Gate: even a valid local session is refused without the Access assertion; with it, LocalAuth still decides.
    expect((await app.request('/api/held', { headers: { cookie } })).status).toBe(401);
    expect(
      (await app.request('/api/held', { headers: { cookie, 'cf-access-jwt-assertion': good } }))
        .status,
    ).toBe(200);
    expect(
      (await app.request('/api/held', { headers: { 'cf-access-jwt-assertion': good } })).status,
    ).toBe(401);
    expect(
      (await app.request('/api/setup', { headers: { 'cf-access-jwt-assertion': good } })).status,
    ).toBe(200);
  });
});
