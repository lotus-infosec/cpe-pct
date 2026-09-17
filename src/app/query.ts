// The list contract every paged route shares (STAGE7, D-036): offset pagination with a total,
// a bounded search term, and sorts chosen from a per-route whitelist. Nothing a caller types
// reaches SQL as text: sort names map to column expressions, and search terms are bound parameters
// inside a LIKE whose wildcards have been escaped.
import { zValidator } from '@hono/zod-validator';
import { asc, desc, or, sql, type SQL, type SQLWrapper } from 'drizzle-orm';
import { z } from 'zod';

export const PER_PAGE = [10, 25, 50, 100] as const;
export const DEFAULT_PER_PAGE = 25;
export const MAX_PAGE = 10_000;
export const MAX_Q = 100;

export type Dir = 'asc' | 'desc';
export interface Paged<T> {
  rows: T[];
  page: number;
  perPage: number;
  total: number;
  pages: number;
}

// eslint-disable-next-line no-control-regex -- matching control characters is the point
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/g;

/** C0 and C1 control characters become spaces, runs of whitespace collapse, ends are trimmed. */
export function cleanQ(raw: string): string {
  return raw.replace(CONTROL_CHARS, ' ').replace(/\s+/g, ' ').trim();
}

/** Escapes LIKE's wildcards and its escape character, so `100%` matches the text "100%". */
export function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

/** Case-insensitive substring match (SQLite LIKE folds ASCII case) with an explicit escape. */
export function contains(col: SQLWrapper, term: string): SQL {
  return sql`${col} LIKE ${`%${escapeLike(term)}%`} ESCAPE '\\'`;
}

/** Matches when any of the named text columns contains the term. Never "every column". */
export function searchAny(cols: SQLWrapper[], term: string | undefined): SQL | undefined {
  return term ? or(...cols.map((c) => contains(c, term))) : undefined;
}

const page = z
  .string()
  .regex(/^\d{1,5}$/, 'must be a whole number')
  .transform(Number)
  .pipe(z.number().int().min(1).max(MAX_PAGE))
  .optional()
  .transform((v) => v ?? 1);

// An enum rather than a bounded integer, so the largest response is fixed by the server.
const perPage = z
  .enum(PER_PAGE.map(String) as ['10', '25', '50', '100'])
  .optional()
  .transform((v) => (v ? Number(v) : DEFAULT_PER_PAGE));

/** A search term: trimmed, control characters folded, at most 100 characters, empty means absent. */
export const qParam = z
  .string()
  .max(MAX_Q * 4, 'too long')
  .transform(cleanQ)
  .pipe(z.string().max(MAX_Q, `at most ${MAX_Q} characters`))
  .optional()
  .transform((v) => v || undefined);

export const isoDateParam = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD');

/**
 * Builds a route's query schema. `sorts` is the whitelist; anything else is a 400. Extra filter
 * fields are validated by the caller's own schemas. Unknown parameters are dropped.
 */
export function listQuery<S extends string, E extends z.ZodRawShape>(
  sorts: readonly [S, ...S[]],
  defaults: { sort: S; dir: Dir },
  extra: E,
) {
  return z.object({
    page,
    per_page: perPage,
    q: qParam,
    sort: z
      .enum(sorts)
      .optional()
      .transform((v) => v ?? defaults.sort),
    dir: z
      .enum(['asc', 'desc'])
      .optional()
      .transform((v) => v ?? defaults.dir),
    ...extra,
  });
}

/** zValidator for a list query, answering a malformed query with a 400 that names each problem. */
export function validList<T extends z.ZodType>(schema: T) {
  return zValidator('query', schema, (result, c) => {
    if (!result.success)
      return c.json(
        {
          error: 'invalid_query',
          details: result.error.issues.map((i) => `${i.path.join('.') || 'query'}: ${i.message}`),
        },
        400,
      );
  });
}

export const offsetOf = (p: { page: number; per_page: number }) => (p.page - 1) * p.per_page;

/** Sort then the id, in the same direction, so equal keys never trade places between pages. */
export function orderBy(key: SQLWrapper, id: SQLWrapper, dir: Dir): SQL[] {
  const f = dir === 'asc' ? asc : desc;
  return [f(key), f(id)];
}

export function paged<T>(
  rows: T[],
  total: number,
  p: { page: number; per_page: number },
): Paged<T> {
  return { rows, page: p.page, perPage: p.per_page, total, pages: Math.ceil(total / p.per_page) };
}

/** For lists computed in memory (standing is derived at read time and cannot be sorted in SQL). */
export function pageInMemory<T>(all: T[], p: { page: number; per_page: number }): Paged<T> {
  const start = offsetOf(p);
  return paged(all.slice(start, start + p.per_page), all.length, p);
}

export const includesCI = (haystack: (string | null | undefined)[], term: string) => {
  const t = term.toLowerCase();
  return haystack.some((h) => h != null && h.toLowerCase().includes(t));
};
