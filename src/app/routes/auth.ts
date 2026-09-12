import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import {
  clearSessionCookie,
  readCookie,
  SESSION_COOKIE,
  sessionCookie,
} from '../../adapters/shared/local-auth';
import type { Vars } from '../context';

const password = z.object({ password: z.string().min(12).max(1024) });
const secure = (url: string) => new URL(url).protocol === 'https:';

export const auth = new Hono<Vars>()
  .get('/setup', async (c) => c.json({ setUp: await c.get('ctx').auth.isSetUp() }))
  .post('/setup', zValidator('json', password), async (c) => {
    const a = c.get('ctx').auth;
    if (await a.isSetUp()) return c.json({ error: 'already_set_up' }, 409);
    await a.setup(c.req.valid('json').password);
    const session = await a.login(c.req.valid('json').password);
    if (session)
      c.header(
        'Set-Cookie',
        sessionCookie(session.sessionId, session.expiresAt, secure(c.req.url)),
      );
    return c.json({ ok: true }, 201);
  })
  .post('/login', zValidator('json', password), async (c) => {
    const session = await c.get('ctx').auth.login(c.req.valid('json').password);
    if (!session) return c.json({ error: 'invalid_credentials' }, 401);
    c.header('Set-Cookie', sessionCookie(session.sessionId, session.expiresAt, secure(c.req.url)));
    return c.json({ ok: true });
  })
  .post('/logout', async (c) => {
    const id = readCookie(c.req.header('cookie') ?? null, SESSION_COOKIE);
    if (id) await c.get('ctx').auth.logout(id);
    c.header('Set-Cookie', clearSessionCookie(secure(c.req.url)));
    return c.json({ ok: true });
  })
  .get('/me', (c) => {
    const p = c.get('principal');
    return p ? c.json(p) : c.json({ error: 'unauthenticated' }, 401);
  });
