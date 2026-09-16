// List state lives in the URL (STAGE7): page, search, filters and sort are search params, so a view
// is linkable, Back works, and a refresh keeps your place. Values from a hand-edited URL are checked
// against the same limits the server enforces and fall back to defaults instead of producing a 400.
import { useCallback, useEffect, useMemo } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router';
import { api } from './api';

export interface Paged<T> {
  rows: T[];
  page: number;
  perPage: number;
  total: number;
  pages: number;
}

export type Dir = 'asc' | 'desc';
export const PER_PAGE = [10, 25, 50, 100] as const;
export const MAX_Q = 100;
const MAX_PAGE = 10_000;

export interface ListConfig<S extends string, F extends string> {
  sorts: readonly S[];
  defaultSort: S;
  defaultDir: Dir;
  /** Each filter's allowed values. `null` accepts any short string (ids and dates). */
  filters: Record<F, readonly string[] | null>;
  /** Params always sent to the API that the URL never shows (a fixed cycle, for example). */
  fixed?: Record<string, string>;
  /** Prefix for the URL keys, so two lists on one page keep separate state. */
  prefix?: string;
}

export interface ListState<S extends string, F extends string> {
  page: number;
  perPage: number;
  q: string;
  sort: S;
  dir: Dir;
  filters: Partial<Record<F, string>>;
  /** Filters or a search are narrowing the list. */
  narrowed: boolean;
  /** The query string for the API, stable for use as a query key. */
  apiQuery: string;
  /** Any change other than the page itself returns to page 1. */
  set: (patch: Record<string, string | number>) => void;
  /** Toggles direction on the active sort, or switches to a new sort in its natural direction. */
  sortBy: (sort: S, naturalDir?: Dir) => void;
  clear: () => void;
  hrefFor: (page: number) => string;
}

export function useList<S extends string, F extends string>(
  cfg: ListConfig<S, F>,
): ListState<S, F> {
  const [params, setParams] = useSearchParams();
  const k = (name: string) => `${cfg.prefix ?? ''}${name}`;

  const state = useMemo(() => {
    const rawPage = params.get(k('page'));
    const page =
      rawPage && /^\d{1,5}$/.test(rawPage) ? Math.min(Math.max(1, Number(rawPage)), MAX_PAGE) : 1;
    const rawPer = Number(params.get(k('per_page')));
    const perPage = (PER_PAGE as readonly number[]).includes(rawPer) ? rawPer : 25;
    const q = (params.get(k('q')) ?? '').slice(0, MAX_Q);
    const rawSort = params.get(k('sort')) as S | null;
    const sort = rawSort && cfg.sorts.includes(rawSort) ? rawSort : cfg.defaultSort;
    const rawDir = params.get(k('dir'));
    const dir: Dir = rawDir === 'asc' || rawDir === 'desc' ? rawDir : cfg.defaultDir;
    const filters: Partial<Record<F, string>> = {};
    for (const [name, allowed] of Object.entries(cfg.filters) as [F, readonly string[] | null][]) {
      const v = params.get(k(name));
      if (v && (allowed ? allowed.includes(v) : v.length <= 100)) filters[name] = v;
    }
    const api = new URLSearchParams({
      page: String(page),
      per_page: String(perPage),
      sort,
      dir,
      ...(q.trim() && { q: q.trim() }),
      ...filters,
      ...cfg.fixed,
    });
    return {
      page,
      perPage,
      q,
      sort,
      dir,
      filters,
      narrowed: Boolean(q.trim()) || Object.keys(filters).length > 0,
      apiQuery: api.toString(),
    };
    // Pages declare the config inline, so its identity changes every render; key on its content.
  }, [params, cfg.prefix, cfg.defaultSort, cfg.defaultDir, JSON.stringify(cfg.fixed)]);

  const set = useCallback<ListState<S, F>['set']>(
    (patch) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          const defaults: Record<string, string> = {
            page: '1',
            per_page: '25',
            sort: cfg.defaultSort,
            dir: cfg.defaultDir,
            q: '',
          };
          for (const [name, value] of Object.entries(patch)) {
            const v = value == null ? '' : String(value);
            if (v === '' || v === defaults[name]) next.delete(k(name));
            else next.set(k(name), v);
          }
          if (!('page' in patch)) next.delete(k('page'));
          return next;
        },
        // Typing a search replaces the entry; paging and filtering are steps Back should undo.
        { replace: Object.keys(patch).length === 1 && 'q' in patch },
      );
    },
    [setParams, cfg.prefix, cfg.defaultSort, cfg.defaultDir],
  );

  const sortBy = useCallback(
    (sort: S, naturalDir: Dir = 'asc') => {
      if (sort === state.sort)
        set({ sort, dir: state.dir === 'asc' ? 'desc' : 'asc' } as Partial<
          Record<'sort' | 'dir', string>
        >);
      else set({ sort, dir: naturalDir });
    },
    [set, state.sort, state.dir],
  );

  const clear = useCallback(() => {
    const blank: Record<string, string> = { q: '' };
    for (const name of Object.keys(cfg.filters)) blank[name] = '';
    set(blank);
  }, [set]);

  const hrefFor = useCallback(
    (page: number) => {
      const next = new URLSearchParams(params);
      if (page <= 1) next.delete(k('page'));
      else next.set(k('page'), String(page));
      const s = next.toString();
      return s ? `?${s}` : '?';
    },
    [params, cfg.prefix],
  );

  return { ...state, set, sortBy, clear, hrefFor };
}

/**
 * Every page of a bounded list, for lookups such as held certification names. Only for lists that
 * are small by nature; anything that grows with use is paged in the interface instead.
 */
export async function fetchAll<T>(path: string): Promise<T[]> {
  const sep = path.includes('?') ? '&' : '?';
  const first = await api<Paged<T>>(`${path}${sep}per_page=100`);
  const rows = [...first.rows];
  for (let page = 2; page <= first.pages; page++)
    rows.push(...(await api<Paged<T>>(`${path}${sep}per_page=100&page=${page}`)).rows);
  return rows;
}

export const fmtCount = (n: number) => new Intl.NumberFormat('en-US').format(n);

/**
 * Fetches one page for a list. The previous page stays on screen while the next loads, so paging
 * never collapses the table, and a page number past the end (after a delete, or from an old link)
 * moves to the last real page instead of showing an empty one.
 */
export function useListQuery<T, S extends string, F extends string>(
  key: string,
  path: string,
  list: ListState<S, F>,
) {
  const q = useQuery({
    queryKey: [key, 'list', list.apiQuery],
    queryFn: () => api<Paged<T>>(`${path}?${list.apiQuery}`),
    placeholderData: keepPreviousData,
  });
  const pages = q.data?.pages;
  const { page, set } = list;
  useEffect(() => {
    if (!q.isPlaceholderData && pages !== undefined && pages > 0 && page > pages)
      set({ page: pages });
  }, [pages, page, set, q.isPlaceholderData]);
  return q;
}
