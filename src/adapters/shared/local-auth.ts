// LocalAuth: single owner, PBKDF2-SHA256 via WebCrypto, DB-backed sessions, HttpOnly SameSite=Lax cookie.
// Same class on both targets (WebCrypto and Drizzle are available on each). DECISIONS D-015, D-016.
import { eq, lt } from 'drizzle-orm';
import type { Db } from '../../db/client';
import { sessions, settings } from '../../db/schema';
import type { Authenticator, Clock, Principal } from '../../ports';

export const SESSION_COOKIE = 'cpe_session';
const SESSION_DAYS = 30;
// The Workers runtime rejects a single PBKDF2 deriveBits call above 100,000 iterations
// ("Pbkdf2 failed: iteration counts above 100000 are not supported"). Local workerd does not
// enforce that ceiling, so only a real deploy shows it. The target work factor is reached by
// chaining rounds, each one under the cap and each fed the previous round's output, so a guess
// still costs ITERATIONS * ROUNDS sequential iterations. VERIFY A11.
export const PBKDF2_MAX_ITERATIONS = 100_000;
export const PBKDF2_ITERATIONS = 100_000;
/** 6 * 100k = 600k, the OWASP figure for PBKDF2-HMAC-SHA256. */
export const PBKDF2_ROUNDS = 6;

const enc = new TextEncoder();
const b64 = (u8: Uint8Array) => btoa(String.fromCharCode(...u8));
const unb64 = (s: string): Uint8Array<ArrayBuffer> =>
  Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const hex = (u8: Uint8Array) => [...u8].map((b) => b.toString(16).padStart(2, '0')).join('');

export async function hashPassword(
  password: string,
  iterations = PBKDF2_ITERATIONS,
  rounds = PBKDF2_ROUNDS,
): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const bits = await derive(password, salt, iterations, rounds);
  return `pbkdf2-sha256$${rounds}x${iterations}$${b64(salt)}$${b64(bits)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algo, cost, salt, hash] = stored.split('$');
  if (algo !== 'pbkdf2-sha256' || !cost || !salt || !hash) return false;
  // `<rounds>x<iterations>`; a bare number is a single round, the pre-chaining format.
  const [a, b] = cost.split('x');
  const rounds = b === undefined ? 1 : Number(a);
  const iterations = Number(b === undefined ? a : b);
  if (!Number.isInteger(rounds) || !Number.isInteger(iterations)) return false;
  const bits = await derive(password, unb64(salt), iterations, rounds);
  return timingSafeEqual(bits, unb64(hash));
}

async function derive(
  password: string,
  salt: Uint8Array<ArrayBuffer>,
  iterations: number,
  rounds: number,
): Promise<Uint8Array> {
  // Copied into its own ArrayBuffer so the type matches what deriveBits accepts on both targets.
  let material: Uint8Array<ArrayBuffer> = new Uint8Array(enc.encode(password));
  for (let round = 0; round < rounds; round++) {
    const key = await crypto.subtle.importKey('raw', material, 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits(
      // The round index is mixed into the salt so no two rounds are the same function.
      { name: 'PBKDF2', hash: 'SHA-256', salt: roundSalt(salt, round), iterations },
      key,
      256,
    );
    material = new Uint8Array(bits);
  }
  return material;
}

function roundSalt(salt: Uint8Array<ArrayBuffer>, round: number): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(salt.length + 1);
  out.set(salt);
  out[salt.length] = round;
  return out;
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

/** Session ids are random; the DB row is the credential. Stored as SHA-256(id) so a DB leak is not a session leak. */
async function sessionKey(id: string): Promise<string> {
  return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(id))));
}

export class LocalAuth implements Authenticator {
  readonly routes = 'local' as const;
  constructor(
    private readonly db: Db,
    private readonly clock: Clock,
  ) {}

  async isSetUp(): Promise<boolean> {
    const row = await this.db
      .select()
      .from(settings)
      .where(eq(settings.key, 'owner.password_hash'))
      .get();
    return row != null;
  }

  async setup(password: string): Promise<void> {
    if (await this.isSetUp()) throw new Error('already_set_up');
    const now = this.clock.now().toISOString();
    const hash = await hashPassword(password);
    const signingKey = hex(crypto.getRandomValues(new Uint8Array(32)));
    await this.db.batch([
      this.db.insert(settings).values({ key: 'owner.password_hash', value: hash, updatedAt: now }),
      this.db
        .insert(settings)
        .values({ key: 'session.signing_key', value: signingKey, updatedAt: now }),
      this.db.insert(settings).values({ key: 'setup.completed_at', value: now, updatedAt: now }),
    ]);
  }

  /** Returns a session id to set as the cookie value, or null on bad password. */
  async login(password: string): Promise<{ sessionId: string; expiresAt: string } | null> {
    const row = await this.db
      .select()
      .from(settings)
      .where(eq(settings.key, 'owner.password_hash'))
      .get();
    if (!row || !(await verifyPassword(password, row.value))) return null;
    const id = hex(crypto.getRandomValues(new Uint8Array(32)));
    const now = this.clock.now();
    const expiresAt = new Date(now.getTime() + SESSION_DAYS * 86_400_000).toISOString();
    await this.db.batch([
      this.db
        .insert(sessions)
        .values({ id: await sessionKey(id), createdAt: now.toISOString(), expiresAt }),
      this.db.delete(sessions).where(lt(sessions.expiresAt, now.toISOString())),
    ]);
    return { sessionId: id, expiresAt };
  }

  async logout(sessionId: string): Promise<void> {
    await this.db.delete(sessions).where(eq(sessions.id, await sessionKey(sessionId)));
  }

  async authenticate(req: Request): Promise<Principal | null> {
    const id = readCookie(req.headers.get('cookie'), SESSION_COOKIE);
    if (!id) return null;
    const row = await this.db
      .select()
      .from(sessions)
      .where(eq(sessions.id, await sessionKey(id)))
      .get();
    if (!row || row.expiresAt <= this.clock.now().toISOString()) return null;
    return { id: 'owner', via: 'local' };
  }
}

export function readCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

export function sessionCookie(id: string, expiresAt: string, secure: boolean): string {
  const attrs = [
    `${SESSION_COOKIE}=${encodeURIComponent(id)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Expires=${new Date(expiresAt).toUTCString()}`,
  ];
  if (secure) attrs.push('Secure');
  return attrs.join('; ');
}

export function clearSessionCookie(secure: boolean): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? '; Secure' : ''}`;
}
