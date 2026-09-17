// The pieces every paged list is built from (STAGE7). Numbered pages only: no load-more button and
// no intersection observer, anywhere (owner note 1, D-036).
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import {
  ArrowDown,
  ArrowUp,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Search,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { count } from '@/lib/format';
import { MAX_Q, PER_PAGE, type Dir } from '@/lib/list';
import { EmptyState } from './feedback';

const SEARCH_DEBOUNCE_MS = 250;

/**
 * Commits 250ms after typing stops, or at once on Enter. Escape clears. `/` anywhere outside a field
 * focuses the search on the page.
 */
export function SearchField({
  value,
  onCommit,
  label,
  placeholder,
  className,
}: {
  value: string;
  onCommit: (q: string) => void;
  label: string;
  placeholder?: string;
  className?: string;
}) {
  const [draft, setDraft] = useState(value);
  const ref = useRef<HTMLInputElement>(null);
  const committed = useRef(value);

  // Follow the URL when it changes underneath (Back, Clear all), without clobbering typing.
  useEffect(() => {
    if (value !== committed.current) {
      committed.current = value;
      setDraft(value);
    }
  }, [value]);

  useEffect(() => {
    if (draft === committed.current) return;
    const t = setTimeout(() => {
      committed.current = draft;
      onCommit(draft);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [draft, onCommit]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement;
      if (t.closest('input, textarea, select, [contenteditable="true"]')) return;
      e.preventDefault();
      ref.current?.focus();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const commitNow = (q: string) => {
    committed.current = q;
    setDraft(q);
    onCommit(q);
  };

  return (
    <div className={cn('relative w-full sm:w-64', className)}>
      <Search
        aria-hidden
        className="pointer-events-none absolute top-2.5 left-2.5 size-4 text-dim"
        strokeWidth={1.5}
      />
      <input
        ref={ref}
        type="search"
        aria-label={label}
        aria-keyshortcuts="/"
        data-list-search=""
        placeholder={placeholder}
        maxLength={MAX_Q}
        autoComplete="off"
        spellCheck={false}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commitNow(draft);
          } else if (e.key === 'Escape' && draft) {
            e.preventDefault();
            commitNow('');
          }
        }}
        className="h-9 w-full rounded-control border border-hairline bg-panel pr-8 pl-8 text-base text-fg placeholder:text-dim focus:border-accent focus:outline-none [&::-webkit-search-cancel-button]:hidden"
      />
      {draft ? (
        <button
          type="button"
          onClick={() => {
            commitNow('');
            ref.current?.focus();
          }}
          className="absolute top-1.5 right-1.5 rounded-control p-1 text-dim hover:bg-panel-strong hover:text-fg"
        >
          <X aria-hidden className="size-4" strokeWidth={1.5} />
          <span className="sr-only">Clear search</span>
        </button>
      ) : (
        <kbd
          aria-hidden
          className="num absolute top-2 right-2 rounded-sm border border-hairline px-1.5 text-xs text-dim"
        >
          /
        </kbd>
      )}
    </div>
  );
}

export interface Option {
  value: string;
  label: string;
}

const selectClass =
  'h-9 rounded-control border border-hairline bg-panel px-2.5 text-base text-fg focus:border-accent focus:outline-none';

/** A filter with "any" as its empty value. The accessible name is the filter's label. */
export function FilterSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string | undefined;
  options: Option[];
  onChange: (v: string) => void;
}) {
  return (
    <select
      aria-label={label}
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value)}
      className={cn(selectClass, value && 'border-accent/60')}
    >
      <option value="">{label}: any</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

/** Sort control for lists without column headers (cards). Direction is a separate button. */
export function SortControl<S extends string>({
  sort,
  dir,
  options,
  onSort,
  onDir,
}: {
  sort: S;
  dir: Dir;
  options: { value: S; label: string }[];
  onSort: (s: S) => void;
  onDir: () => void;
}) {
  return (
    <div className="flex items-center gap-1 max-sm:[&>select]:flex-1">
      <select
        aria-label="Sort by"
        value={sort}
        onChange={(e) => onSort(e.target.value as S)}
        className={selectClass}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            Sort: {o.label}
          </option>
        ))}
      </select>
      <button
        type="button"
        onClick={onDir}
        className="flex size-9 items-center justify-center rounded-control border border-hairline bg-panel text-dim hover:bg-panel-strong hover:text-fg"
      >
        {dir === 'asc' ? (
          <ArrowUp aria-hidden className="size-4" strokeWidth={1.5} />
        ) : (
          <ArrowDown aria-hidden className="size-4" strokeWidth={1.5} />
        )}
        <span className="sr-only">
          {dir === 'asc' ? 'Ascending, switch to descending' : 'Descending, switch to ascending'}
        </span>
      </button>
    </div>
  );
}

export function PerPageSelect({
  value,
  onChange,
}: {
  value: number;
  onChange: (n: number) => void;
}) {
  return (
    <select
      aria-label="Rows per page"
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      className={selectClass}
    >
      {PER_PAGE.map((n) => (
        <option key={n} value={n}>
          {n} per page
        </option>
      ))}
    </select>
  );
}

const range = (page: number, perPage: number, total: number) => {
  if (total === 0) return 'No results';
  const from = (page - 1) * perPage + 1;
  if (from > total) return `${count(total)} results`;
  return `Showing ${count(from)} to ${count(Math.min(page * perPage, total))} of ${count(total)}`;
};

/** The result count, announced politely when it changes. */
export function ResultCount({
  page,
  perPage,
  total,
}: {
  page: number;
  perPage: number;
  total: number | undefined;
}) {
  return (
    <p role="status" aria-live="polite" className="num text-sm text-dim">
      {total === undefined ? '' : range(page, perPage, total)}
    </p>
  );
}

export interface Chip {
  key: string;
  label: string;
  onRemove: () => void;
}

/** Active filters as removable chips, with one action that clears them all. */
export function FilterChips({ chips, onClearAll }: { chips: Chip[]; onClearAll: () => void }) {
  if (chips.length === 0) return null;
  return (
    <ul aria-label="Active filters" className="flex flex-wrap items-center gap-1.5">
      {chips.map((c) => (
        <li key={c.key}>
          <button
            type="button"
            onClick={c.onRemove}
            className="inline-flex h-7 items-center gap-1 rounded-control border border-accent/40 bg-accent/10 pr-1.5 pl-2 text-sm text-fg hover:border-accent/70"
          >
            {c.label}
            <X aria-hidden className="size-3.5 text-dim" strokeWidth={1.5} />
            <span className="sr-only">, remove filter</span>
          </button>
        </li>
      ))}
      {chips.length > 1 && (
        <li>
          <button
            type="button"
            onClick={onClearAll}
            className="h-7 rounded-control px-2 text-sm text-dim hover:bg-panel hover:text-fg"
          >
            Clear all
          </button>
        </li>
      )}
    </ul>
  );
}

/** Page numbers to show: first, last, and a window around the current page, with gaps marked. */
export function pageWindow(page: number, pages: number): (number | 'gap')[] {
  const want = new Set([1, pages, page - 1, page, page + 1].filter((n) => n >= 1 && n <= pages));
  // Fill a single-page hole instead of drawing an ellipsis that hides exactly one number.
  if (page - 3 === 1) want.add(2);
  if (page + 3 === pages) want.add(pages - 1);
  const sorted = [...want].sort((a, b) => a - b);
  const out: (number | 'gap')[] = [];
  sorted.forEach((n, i) => {
    if (i > 0 && n - sorted[i - 1]! > 1) out.push('gap');
    out.push(n);
  });
  return out;
}

const pageItem = 'num flex h-8 min-w-8 items-center justify-center rounded-control px-2 text-sm';

function PageLink({
  to,
  disabled,
  label,
  children,
}: {
  to: string;
  disabled: boolean;
  label: string;
  children: ReactNode;
}) {
  if (disabled)
    return (
      <span aria-disabled="true" className={cn(pageItem, 'text-mute')}>
        {children}
        <span className="sr-only">{label}</span>
      </span>
    );
  return (
    <Link to={to} className={cn(pageItem, 'text-dim hover:bg-panel hover:text-fg')}>
      {children}
      <span className="sr-only">{label}</span>
    </Link>
  );
}

export function Pagination({
  page,
  pages,
  perPage,
  total,
  hrefFor,
  label = 'Pagination',
}: {
  page: number;
  pages: number;
  perPage: number;
  total: number;
  hrefFor: (page: number) => string;
  label?: string;
}) {
  if (total === 0) return null;
  const icon = 'size-4';
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="num text-sm text-dim">{range(page, perPage, total)}</p>
      {pages > 1 && (
        <nav aria-label={label}>
          <ul className="flex flex-wrap items-center gap-0.5">
            <li>
              <PageLink to={hrefFor(1)} disabled={page <= 1} label="First page">
                <ChevronsLeft aria-hidden className={icon} strokeWidth={1.5} />
              </PageLink>
            </li>
            <li>
              <PageLink to={hrefFor(page - 1)} disabled={page <= 1} label="Previous page">
                <ChevronLeft aria-hidden className={icon} strokeWidth={1.5} />
              </PageLink>
            </li>
            {pageWindow(page, pages).map((n, i) =>
              n === 'gap' ? (
                <li key={`gap-${i}`} aria-hidden className={cn(pageItem, 'text-dim')}>
                  …
                </li>
              ) : (
                <li key={n}>
                  {n === page ? (
                    <span
                      aria-current="page"
                      className={cn(pageItem, 'border border-accent/50 bg-accent/10 text-fg')}
                    >
                      <span className="sr-only">Page </span>
                      {n}
                    </span>
                  ) : (
                    <Link
                      to={hrefFor(n)}
                      className={cn(pageItem, 'text-dim hover:bg-panel hover:text-fg')}
                    >
                      <span className="sr-only">Page </span>
                      {n}
                    </Link>
                  )}
                </li>
              ),
            )}
            <li>
              <PageLink to={hrefFor(page + 1)} disabled={page >= pages} label="Next page">
                <ChevronRight aria-hidden className={icon} strokeWidth={1.5} />
              </PageLink>
            </li>
            <li>
              <PageLink to={hrefFor(pages)} disabled={page >= pages} label="Last page">
                <ChevronsRight aria-hidden className={icon} strokeWidth={1.5} />
              </PageLink>
            </li>
          </ul>
        </nav>
      )}
    </div>
  );
}

/** Tells an empty table apart from a search that matched nothing, and offers the way out of each. */
export function ListEmpty({
  narrowed,
  onClear,
  noun,
  emptyTitle,
  emptyDescription,
  emptyAction,
}: {
  narrowed: boolean;
  onClear: () => void;
  noun: string;
  emptyTitle: string;
  emptyDescription?: ReactNode;
  emptyAction?: ReactNode;
}) {
  if (narrowed)
    return (
      <EmptyState
        icon={Search}
        title={`No ${noun} match these filters`}
        description="Try a shorter search term or remove a filter."
        action={
          <button
            type="button"
            onClick={onClear}
            className="h-8 rounded-control border border-hairline bg-panel px-3 text-sm text-fg hover:bg-panel-strong"
          >
            Clear search and filters
          </button>
        }
      />
    );
  return <EmptyState title={emptyTitle} description={emptyDescription} action={emptyAction} />;
}
