// Bulk selection and deletion of activities (STAGE8). Deletion cannot be undone, so the dialog states
// the server's own count of what will go, names anything it refuses, and asks for the number to be
// typed when more than 20 rows are involved.
import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { Link } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, Trash2, X } from 'lucide-react';
import { api } from '@/lib/api';
import { count } from '@/lib/format';
import { Button, Dialog, ErrorText, Input } from '@/components/ui';

export const MAX_HAND_SELECTED = 500;
const TYPE_TO_CONFIRM_OVER = 20;

export type ActivityFilterBody = Partial<Record<'q' | 'type' | 'status' | 'from' | 'to', string>>;

/** What goes to the server: explicit ids, or the filter plus the count the person was shown. */
export type SelectionBody =
  { ids: string[] } | { filter: ActivityFilterBody; expectedCount: number };

export interface Selection {
  mode: 'ids' | 'matching';
  ids: Set<string>;
  /** Rows in the selection: ids chosen by hand, or every activity matching the filter. */
  size: number;
  body: SelectionBody | null;
  has: (id: string) => boolean;
  /** Click handler for a row checkbox; shift-click extends from the last clicked row on this page. */
  toggle: (id: string, pageIds: string[], e: MouseEvent<HTMLInputElement>) => void;
  setPage: (pageIds: string[], on: boolean) => void;
  selectMatching: () => void;
  clear: () => void;
  /** Hand selection stopped at the cap. */
  capped: boolean;
}

export function useActivitySelection(
  filter: ActivityFilterBody,
  total: number | undefined,
): Selection {
  const [ids, setIds] = useState<Set<string>>(new Set());
  const [matching, setMatching] = useState(false);
  const [capped, setCapped] = useState(false);
  const anchor = useRef<string | null>(null);
  const filterKey = JSON.stringify(filter);

  // A selection belongs to the filter it was made under; changing the filter starts over.
  useEffect(() => {
    setIds(new Set());
    setMatching(false);
    setCapped(false);
    anchor.current = null;
  }, [filterKey]);

  const apply = (next: Set<string>) => {
    if (next.size > MAX_HAND_SELECTED) {
      setCapped(true);
      return;
    }
    setCapped(false);
    setIds(next);
  };

  const size = matching ? (total ?? 0) : ids.size;
  return {
    mode: matching ? 'matching' : 'ids',
    ids,
    size,
    capped,
    body: size === 0 ? null : matching ? { filter, expectedCount: total ?? 0 } : { ids: [...ids] },
    has: (id) => matching || ids.has(id),
    toggle: (id, pageIds, e) => {
      if (matching) {
        // Leaving "all matching" by unticking one row: keep this page, minus that row.
        setMatching(false);
        apply(new Set(pageIds.filter((x) => x !== id)));
        anchor.current = id;
        return;
      }
      const next = new Set(ids);
      const on = !ids.has(id);
      const from = anchor.current ? pageIds.indexOf(anchor.current) : -1;
      const to = pageIds.indexOf(id);
      if (e.shiftKey && from !== -1 && to !== -1) {
        const [lo, hi] = from < to ? [from, to] : [to, from];
        for (const x of pageIds.slice(lo, hi + 1)) {
          if (on) next.add(x);
          else next.delete(x);
        }
      } else if (on) next.add(id);
      else next.delete(id);
      anchor.current = id;
      apply(next);
    },
    setPage: (pageIds, on) => {
      setMatching(false);
      const next = new Set(matching ? [] : ids);
      for (const x of pageIds) {
        if (on) next.add(x);
        else next.delete(x);
      }
      apply(next);
    },
    selectMatching: () => {
      setMatching(true);
      setCapped(false);
    },
    clear: () => {
      setIds(new Set());
      setMatching(false);
      setCapped(false);
      anchor.current = null;
    },
  };
}

/** Header checkbox for the rows on this page, with the mixed state when some are chosen. */
export function PageCheckbox({ sel, pageIds }: { sel: Selection; pageIds: string[] }) {
  const ref = useRef<HTMLInputElement>(null);
  const chosen = pageIds.filter((id) => sel.has(id)).length;
  const all = pageIds.length > 0 && chosen === pageIds.length;
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = chosen > 0 && !all;
  }, [chosen, all]);
  return (
    <input
      ref={ref}
      type="checkbox"
      className="size-4 align-middle"
      checked={all}
      onChange={() => sel.setPage(pageIds, !all)}
      aria-label={
        all ? 'Deselect every activity on this page' : 'Select every activity on this page'
      }
    />
  );
}

/**
 * Appears when anything is selected. It always says whether the selection is rows on pages or every
 * activity matching the filter, so a filtered set is never mistaken for a page.
 */
export function SelectionBar({
  sel,
  pageIds,
  total,
  narrowed,
  onDelete,
  onExport,
  exporting,
}: {
  sel: Selection;
  pageIds: string[];
  total: number;
  narrowed: boolean;
  onDelete: () => void;
  onExport: () => void;
  exporting: boolean;
}) {
  const allOnPage = pageIds.length > 0 && pageIds.every((id) => sel.has(id));
  if (sel.size === 0 && !sel.capped) return null;
  return (
    <div
      role="region"
      aria-label="Selection"
      className="sticky top-14 z-30 flex flex-wrap items-center gap-2 rounded-card border border-accent/40 bg-raised px-3 py-2 lg:top-2"
    >
      <p aria-live="polite" className="text-sm text-fg">
        {sel.mode === 'matching' ? (
          <>
            All <span className="num font-semibold">{count(sel.size)}</span> activities matching the
            current filter
          </>
        ) : (
          <>
            <span className="num font-semibold">{count(sel.size)}</span> selected
            {sel.size > pageIds.filter((id) => sel.has(id)).length && ' across pages'}
          </>
        )}
      </p>
      {sel.mode === 'ids' && narrowed && allOnPage && total > pageIds.length && (
        <Button size="sm" variant="ghost" onClick={sel.selectMatching}>
          Select all {count(total)} matching
        </Button>
      )}
      {sel.capped && (
        <p role="alert" className="text-sm text-warn">
          Up to {MAX_HAND_SELECTED} can be picked by hand. Filter the list and select all matching
          for more.
        </p>
      )}
      <span className="flex flex-wrap gap-2 sm:ml-auto">
        <Button size="sm" onClick={onExport} disabled={sel.size === 0 || exporting}>
          <Download aria-hidden strokeWidth={1.5} />
          Export selection
        </Button>
        <Button size="sm" variant="danger" onClick={onDelete} disabled={sel.size === 0}>
          <Trash2 aria-hidden strokeWidth={1.5} />
          Delete
        </Button>
        <Button size="sm" variant="ghost" onClick={sel.clear}>
          <X aria-hidden strokeWidth={1.5} />
          Clear
        </Button>
      </span>
    </div>
  );
}

interface Preview {
  deleted: number;
  applicationsRemoved: number;
  evidenceUnlinked: number;
  evidenceOrphaned: number;
  cyclesAffected: number;
  refused: { id: string; title: string; reason: string }[];
  unknown: string[];
}

interface ExportStatus {
  id: string;
  status: 'building' | 'ready' | 'failed';
  progress: { done: number; total: number } | null;
}

const plural = (n: number, one: string, many: string) => `${count(n)} ${n === 1 ? one : many}`;
/** A count in the data face beside words in the text face. */
const Count = ({ n, one, many }: { n: number; one: string; many: string }) => (
  <>
    <span className="num">{count(n)}</span> {n === 1 ? one : many}
  </>
);

/** Starts a selection export and follows it until the bundle is ready to download. */
export function useSelectionExport() {
  const qc = useQueryClient();
  const start = useMutation({
    mutationFn: (body: SelectionBody) =>
      api<{ id: string }>('/api/exports', { method: 'POST', body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['exports'] }),
  });
  const id = start.data?.id;
  const status = useQuery({
    queryKey: ['exports', id],
    queryFn: () => api<ExportStatus>(`/api/exports/${id}`),
    enabled: Boolean(id),
    refetchInterval: (q) => (q.state.data?.status === 'building' || !q.state.data ? 1500 : false),
  });
  return { start, status: id ? status.data : undefined, reset: start.reset };
}

export function ExportStatusLine({ exp }: { exp: ReturnType<typeof useSelectionExport> }) {
  if (exp.start.isPending) return <p className="text-sm text-dim">Starting the export.</p>;
  if (exp.start.error) return <ErrorText error={exp.start.error} />;
  const st = exp.status;
  if (!exp.start.data) return null;
  if (!st || st.status === 'building')
    return (
      <p role="status" className="text-sm text-dim">
        Building the bundle
        {st?.progress ? (
          <span className="num">
            {' '}
            ({st.progress.done} of {st.progress.total} files)
          </span>
        ) : null}
        . It runs in the background and also appears on the{' '}
        <Link className="text-accent underline-offset-2 hover:underline" to="/exports">
          Exports page
        </Link>
        .
      </p>
    );
  if (st.status === 'failed')
    return (
      <p role="alert" className="text-sm text-bad">
        The export failed. Nothing has been deleted.
      </p>
    );
  return (
    <p role="status" className="text-sm text-ok">
      Export ready.{' '}
      <a
        className="text-accent underline-offset-2 hover:underline"
        href={`/api/exports/${st.id}/download`}
      >
        Download the bundle
      </a>
    </p>
  );
}

export function BulkDeleteDialog({
  open,
  onClose,
  selection,
  onDeleted,
}: {
  open: boolean;
  onClose: () => void;
  selection: SelectionBody | null;
  onDeleted: (result: Preview) => void;
}) {
  const qc = useQueryClient();
  const [includeSubmitted, setIncludeSubmitted] = useState(false);
  const [typed, setTyped] = useState('');
  const exp = useSelectionExport();

  useEffect(() => {
    if (!open) {
      setIncludeSubmitted(false);
      setTyped('');
      exp.reset();
    }
    // Only the open state matters here; the mutation's reset function is stable.
  }, [open]);

  const preview = useQuery({
    queryKey: ['bulk-delete-preview', selection, includeSubmitted],
    queryFn: () =>
      api<Preview>('/api/activities/bulk-delete/preview', {
        method: 'POST',
        body: { ...selection, includeSubmitted },
      }),
    enabled: open && selection !== null,
    staleTime: 0,
    gcTime: 0,
  });
  const del = useMutation({
    mutationFn: () =>
      api<Preview>('/api/activities/bulk-delete', {
        method: 'POST',
        body: { ...selection, includeSubmitted },
      }),
    onSuccess: (r) => {
      qc.invalidateQueries();
      onDeleted(r);
    },
  });

  const p = preview.data;
  const mustType = (p?.deleted ?? 0) > TYPE_TO_CONFIRM_OVER;
  const confirmed = !mustType || typed.trim() === String(p?.deleted);
  const changed =
    (preview.error as { body?: { error?: string } } | null)?.body?.error === 'selection_changed' ||
    (del.error as { body?: { error?: string } } | null)?.body?.error === 'selection_changed';

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={p ? `Delete ${plural(p.deleted, 'activity', 'activities')}` : 'Delete activities'}
      className="w-[min(36rem,calc(100vw-2rem))]"
    >
      <div className="space-y-4 text-sm">
        {preview.isPending && <p className="text-dim">Counting what this removes.</p>}
        {changed && (
          <p role="alert" className="text-bad">
            The activities matching this filter changed since the count was shown. Close this dialog
            and select again.
          </p>
        )}
        {preview.error && !changed && <ErrorText error={preview.error} />}
        {p && (
          <>
            <p>
              This also removes{' '}
              <strong className="font-semibold">
                <Count
                  n={p.applicationsRemoved}
                  one="credit application"
                  many="credit applications"
                />
              </strong>
              {p.cyclesAffected > 0 && (
                <> across {plural(p.cyclesAffected, 'renewal cycle', 'renewal cycles')}</>
              )}{' '}
              and unlinks{' '}
              <strong className="font-semibold">
                <Count n={p.evidenceUnlinked} one="evidence file" many="evidence files" />
              </strong>
              . Evidence files are kept
              {p.evidenceOrphaned > 0 && (
                <>
                  ; <span className="num">{count(p.evidenceOrphaned)}</span> will show as unlinked
                  on the Evidence page
                </>
              )}
              .
            </p>

            {(p.refused.length > 0 || includeSubmitted) && (
              <div className="rounded-control border border-warn/40 bg-warn/10 p-3">
                {p.refused.length > 0 ? (
                  <>
                    <p className="text-fg">
                      {plural(p.refused.length, 'activity is', 'activities are')} kept because{' '}
                      {p.refused.length === 1 ? 'it has' : 'they have'} credit submitted to or
                      accepted by the issuer. Deleting {p.refused.length === 1 ? 'it' : 'them'}{' '}
                      would leave this tracker disagreeing with what the issuer was told.
                    </p>
                    <ul
                      // Scrollable, so it must be reachable and named for keyboard users.
                      tabIndex={0}
                      aria-label="Activities kept"
                      className="mt-2 max-h-32 list-inside list-disc overflow-y-auto rounded-control text-dim"
                    >
                      {p.refused.map((r) => (
                        <li key={r.id} className="truncate">
                          {r.title}
                        </li>
                      ))}
                    </ul>
                  </>
                ) : (
                  <p className="text-fg">
                    Activities with submitted or accepted credit are included in this delete.
                  </p>
                )}
                <label className="mt-2 flex items-center gap-2 text-fg">
                  <input
                    type="checkbox"
                    className="size-4"
                    checked={includeSubmitted}
                    onChange={(e) => {
                      setIncludeSubmitted(e.target.checked);
                      setTyped('');
                    }}
                  />
                  Delete these too
                </label>
              </div>
            )}

            {p.unknown.length > 0 && (
              <p className="text-dim">
                {plural(
                  p.unknown.length,
                  'selected activity no longer exists',
                  'selected activities no longer exist',
                )}{' '}
                and will be skipped.
              </p>
            )}

            <div className="space-y-2 border-t border-hairline pt-3">
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  onClick={() => selection && exp.start.mutate(selection)}
                  disabled={!selection || exp.start.isPending || Boolean(exp.start.data)}
                >
                  <Download aria-hidden strokeWidth={1.5} />
                  Export selection first
                </Button>
                <span className="text-dim">
                  A zip of these activities, their credits and evidence files.
                </span>
              </div>
              <ExportStatusLine exp={exp} />
            </div>

            <p className="text-dim">
              There is no undo. The way back is a backup taken beforehand, from the{' '}
              <Link className="text-accent underline-offset-2 hover:underline" to="/backup">
                Backup page
              </Link>
              .
            </p>

            {p.deleted > 0 && mustType && (
              <label className="block">
                <span className="mb-1.5 block text-dim">
                  Type <span className="num font-semibold text-fg">{p.deleted}</span> to confirm
                </span>
                <Input
                  inputMode="numeric"
                  autoComplete="off"
                  value={typed}
                  onChange={(e) => setTyped(e.target.value)}
                  className="num w-40"
                />
              </label>
            )}
          </>
        )}
        <ErrorText error={changed ? null : del.error} />
        <div className="flex justify-end gap-2 pt-1">
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="danger"
            disabled={!p || p.deleted === 0 || !confirmed || del.isPending || changed}
            onClick={() => del.mutate()}
          >
            {p && p.deleted > 0
              ? `Delete ${plural(p.deleted, 'activity', 'activities')}`
              : 'Delete'}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
