// LocalAuth: single owner, PBKDF2-SHA256 via WebCrypto, DB-backed sessions, HttpOnly SameSite=Lax cookie.
// Same class on both targets (WebCrypto and Drizzle are available on each). DECISIONS D-015, D-016.
import { eq, lt } from 'drizzle-orm';
import type { Db } from '../../db/client';
import { sessions, settings } from '../../db/schema';
import type { Authenticator, Clock, Principal } from '../../ports';

export const SESSION_COOKIE = 'cpe_session';
const SESSION_DAYS = 30;
// VERIFY A11: iterations chosen to stay well inside Workers Paid CPU budget; measured in Stage 1 tests.
export const PBKDF2_ITERATIONS = 210_000;

const enc = new TextEncoder();
const b64 = (u8: Uint8Array) => btoa(String.fromCharCode(...u8));
const unb64 = (s: string): Uint8Array<ArrayBuffer> =>
  Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const hex = (u8: Uint8Array) => [...u8].map((b) => b.toString(16).padStart(2, '0')).join('');

export async function hashPassword(
  password: string,
  iterations = PBKDF2_ITERATIONS,
): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const bits = await derive(password, salt, iterations);
  return `pbkdf2-sha256$${iterations}$${b64(salt)}$${b64(bits)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algo, iter, salt, hash] = stored.split('$');
  if (algo !== 'pbkdf2-sha256' || !iter || !salt || !hash) return false;
  const bits = await derive(password, unb64(salt), Number(iter));
  return timingSafeEqual(bits, unb64(hash));
}

async function derive(
  password: string,
  salt: Uint8Array<ArrayBuffer>,
  iterations: number,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, [
    'deriveBits',
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    key,
    256,
  );
  return new Uint8Array(bits);
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
