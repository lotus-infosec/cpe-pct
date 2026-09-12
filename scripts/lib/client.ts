// Tiny API client for the backup scripts. Logs in with CPE_PASSWORD (or prompts) against CPE_URL.
import { createInterface } from 'node:readline/promises';

export interface Client {
  base: string;
  cookie: string;
  fetch: (path: string, init?: RequestInit) => Promise<Response>;
}

export async function connect(): Promise<Client> {
  const base = (process.env['CPE_URL'] ?? 'http://localhost:8787').replace(/\/$/, '');
  let password = process.env['CPE_PASSWORD'];
  if (!password) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    password = await rl.question(`Owner password for ${base}: `);
    rl.close();
  }
  const setUp = ((await (await fetch(`${base}/api/setup`)).json()) as { setUp: boolean }).setUp;
  let cookie = '';
  if (setUp) {
    const res = await fetch(`${base}/api/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    if (!res.ok) throw new Error(`login failed: ${res.status}`);
    cookie = res.headers.get('set-cookie')?.split(';')[0] ?? '';
  }
  return {
    base,
    cookie,
    fetch: (path, init = {}) =>
      fetch(`${base}${path}`, {
        ...init,
        headers: { ...(init.headers as Record<string, string>), cookie },
      }),
  };
}
