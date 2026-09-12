// AccessJwtAuth (Cloudflare, optional): validates the Cf-Access-Jwt-Assertion header against the team's
// public keys and checks the audience. An extra gate in front of LocalAuth, not a replacement (D-015).
// Pure WebCrypto; no dependencies. Keys are cached for ten minutes.
import type { Authenticator, Principal } from '../../ports';

interface Jwk {
  kid: string;
  kty: string;
  n: string;
  e: string;
  alg?: string;
}

export class AccessJwtAuth implements Authenticator {
  readonly routes = 'none' as const;
  private keys: { fetchedAt: number; jwks: Jwk[] } | null = null;
  constructor(
    private readonly teamDomain: string, // e.g. "myteam.cloudflareaccess.com"
    private readonly audience: string,
    private readonly fetchFn: typeof fetch = fetch,
    private readonly now: () => number = () => Date.now(),
  ) {}

  async authenticate(req: Request): Promise<Principal | null> {
    const token = req.headers.get('cf-access-jwt-assertion');
    if (!token) return null;
    try {
      return (await this.verify(token)) ? { id: 'owner', via: 'cf-access' } : null;
    } catch {
      return null;
    }
  }

  async verify(token: string): Promise<boolean> {
    const [h, p, s] = token.split('.');
    if (!h || !p || !s) return false;
    const header = JSON.parse(b64urlToString(h)) as { alg: string; kid: string };
    const payload = JSON.parse(b64urlToString(p)) as {
      aud?: string | string[];
      exp?: number;
      iss?: string;
      nbf?: number;
    };
    if (header.alg !== 'RS256') return false;
    const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    if (!aud.includes(this.audience)) return false;
    const nowSec = Math.floor(this.now() / 1000);
    if (payload.exp != null && payload.exp < nowSec) return false;
    if (payload.nbf != null && payload.nbf > nowSec) return false;
    if (payload.iss != null && payload.iss !== `https://${this.teamDomain}`) return false;
    const jwk = (await this.jwks()).find((k) => k.kid === header.kid);
    if (!jwk) return false;
    const key = await crypto.subtle.importKey(
      'jwk',
      { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify'],
    );
    return crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      key,
      b64urlToBytes(s),
      new TextEncoder().encode(`${h}.${p}`),
    );
  }

  private async jwks(): Promise<Jwk[]> {
    if (this.keys && this.now() - this.keys.fetchedAt < 10 * 60_000) return this.keys.jwks;
    const res = await this.fetchFn(`https://${this.teamDomain}/cdn-cgi/access/certs`);
    if (!res.ok) throw new Error(`certs ${res.status}`);
    const body = (await res.json()) as { keys: Jwk[] };
    this.keys = { fetchedAt: this.now(), jwks: body.keys };
    return body.keys;
  }
}

function b64urlToBytes(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  return Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad), (c) =>
    c.charCodeAt(0),
  );
}
function b64urlToString(s: string): string {
  return new TextDecoder().decode(b64urlToBytes(s));
}
