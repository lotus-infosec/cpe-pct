// Thin fetch wrapper. Same-origin cookies; JSON in/out; throws ApiError with the server's body.
export class ApiError extends Error {
  constructor(
    public status: number,
    public body: unknown,
  ) {
    super(`API ${status}`);
  }
}

export async function api<T>(
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<T> {
  const res = await fetch(path, {
    method: init.method ?? 'GET',
    headers: init.body !== undefined ? { 'content-type': 'application/json' } : {},
    ...(init.body !== undefined && { body: JSON.stringify(init.body) }),
    credentials: 'same-origin',
  });
  const text = await res.text();
  const json = text ? (JSON.parse(text) as unknown) : null;
  if (!res.ok) throw new ApiError(res.status, json);
  return json as T;
}

export const fmtCredits = (x100: number) => (x100 / 100).toFixed(2).replace(/\.?0+$/, '');
export const fmtMoney = (cents: number, currency = 'USD') =>
  new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(cents / 100);
