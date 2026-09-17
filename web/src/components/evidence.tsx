import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import { ApiError, api } from '@/lib/api';
import { bytes } from '@/lib/format';
import { useList, useListQuery } from '@/lib/list';
import { EXTRACTION_STATUS, options } from '@/lib/labels';
import { cn } from '@/lib/utils';
import {
  Badge,
  Button,
  Card,
  ErrorText,
  FilterChips,
  FilterSelect,
  Input,
  ListEmpty,
  PageHeader,
  Pagination,
  PerPageSelect,
  ResultCount,
  SearchField,
  Skeleton,
  SortableTh,
  Table,
  TBody,
  Td,
  Th,
  THead,
  Toolbar,
  Tr,
  type Chip,
} from '@/components/ui';

export interface EvidenceRow {
  id: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
  sha256: string;
  extractionStatus: 'pending' | 'done' | 'no_text' | 'failed' | 'manual';
  extractionMethod: string | null;
  uploadedAt: string;
  activityIds?: string[];
  hasText?: boolean;
}
export interface UploadResult {
  evidence: EvidenceRow;
  activityId: string;
  deduplicated: boolean;
  extractionStatus: EvidenceRow['extractionStatus'];
  from: Record<string, 'extracted'>;
}

const STATUS: Record<EvidenceRow['extractionStatus'], [string, 'ok' | 'warn' | 'muted' | 'bad']> = {
  done: ['text extracted', 'ok'],
  pending: ['extraction queued', 'warn'],
  no_text: ['no text layer — enter details by hand', 'muted'],
  manual: ['image — enter details by hand', 'muted'],
  failed: ['extraction failed', 'bad'],
};

export async function uploadEvidence(file: File, activityId?: string): Promise<UploadResult> {
  const fd = new FormData();
  fd.set('file', file, file.name);
  if (activityId) fd.set('activityId', activityId);
  const res = await fetch('/api/evidence', {
    method: 'POST',
    body: fd,
    credentials: 'same-origin',
  });
  const json = (await res.json()) as unknown;
  if (!res.ok) throw new ApiError(res.status, json);
  return json as UploadResult;
}

/** Drop zone + file input. onDone receives the server result (draft id or linked activity). */
export function EvidenceUpload({
  activityId,
  onDone,
}: {
  activityId?: string;
  onDone?: (r: UploadResult) => void;
}) {
  const qc = useQueryClient();
  const [drag, setDrag] = useState(false);
  const m = useMutation({
    mutationFn: (f: File) => uploadEvidence(f, activityId),
    onSuccess: (r) => {
      qc.invalidateQueries();
      onDone?.(r);
    },
  });
  const pick = (files: FileList | null) => {
    const f = files?.[0];
    if (f) m.mutate(f);
  };
  return (
    <div>
      <label
        className={`flex cursor-pointer flex-col items-center justify-center rounded-md border border-dashed p-4 text-center text-sm ${drag ? 'bg-muted' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          pick(e.dataTransfer.files);
        }}
      >
        <span>
          {m.isPending ? 'Uploading…' : 'Drop a PDF, PNG, JPEG or WebP here, or click to choose'}
        </span>
        <span className="text-xs text-muted-foreground">
          Up to 20 MB. Hashed and stored on this instance only. Text-layer PDFs pre-fill the
          activity.
        </span>
        <Input
          type="file"
          className="hidden"
          accept="application/pdf,image/png,image/jpeg,image/webp"
          onChange={(e) => pick(e.target.files)}
        />
      </label>
      <ErrorText error={m.error} />
      {m.data && (
        <p className="mt-1 text-xs text-muted-foreground">
          {m.data.deduplicated ? 'Already on file (same hash); linked.' : 'Stored.'}{' '}
          {STATUS[m.data.extractionStatus][0]}.
          {Object.keys(m.data.from).length > 0 &&
            ` Pre-filled: ${Object.keys(m.data.from).join(', ')}.`}
        </p>
      )}
    </div>
  );
}

export function EvidenceList({ activityId }: { activityId: string }) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['activity-evidence', activityId],
    queryFn: () => api<EvidenceRow[]>(`/api/activities/${activityId}/evidence`),
  });
  const del = useMutation({
    mutationFn: (id: string) => api(`/api/evidence/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries(),
  });
  const [open, setOpen] = useState<string | null>(null);
  if (!q.data?.length) return null;
  return (
    <ul className="divide-y">
      {q.data.map((e) => (
        <li key={e.id} className="py-2 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{e.filename}</span>
            <span className="text-xs text-muted-foreground">
              {e.contentType} · {bytes(e.sizeBytes)}
            </span>
            <Badge tone={STATUS[e.extractionStatus][1]}>{STATUS[e.extractionStatus][0]}</Badge>
            <button
              className="text-xs underline"
              onClick={() => setOpen(open === e.id ? null : e.id)}
            >
              {open === e.id ? 'hide' : 'view'}
            </button>
            <a
              className="text-xs underline"
              href={`/api/evidence/${e.id}/content`}
              target="_blank"
              rel="noreferrer"
            >
              open
            </a>
            <Button
              size="sm"
              variant="ghost"
              className="ml-auto"
              onClick={() => {
                if (confirm('Remove this evidence file from all activities?')) del.mutate(e.id);
              }}
            >
              remove
            </Button>
          </div>
          <p className="font-mono text-[10px] text-muted-foreground">sha256 {e.sha256}</p>
          {open === e.id &&
            (e.contentType === 'application/pdf' ? (
              <iframe
                title={e.filename}
                src={`/api/evidence/${e.id}/content`}
                className="mt-2 h-[70vh] w-full rounded border"
              />
            ) : (
              <img
                alt={e.filename}
                src={`/api/evidence/${e.id}/content`}
                className="mt-2 max-h-[70vh] rounded border"
              />
            ))}
        </li>
      ))}
    </ul>
  );
}

/** Standalone entry point: upload first, get a draft, go edit it. */
export function AddEvidencePage() {
  const [last, setLast] = useState<UploadResult | null>(null);
  return (
    <div className="space-y-6">
      <PageHeader
        title="Evidence"
        description="Certificates and receipts, kept on this instance and linked to the activities they prove."
      />
      <Card className="max-w-3xl">
        <h2 className="mb-1 font-semibold">Add evidence</h2>
        <p className="mb-3 text-xs text-dim">
          Upload a certificate or receipt first; a draft activity is created and pre-filled from the
          document where possible. You finish it and confirm the credit fan-out.
        </p>
        <EvidenceUpload onDone={setLast} />
        {last && (
          <p className="mt-3 text-sm">
            <Link
              className="text-accent underline-offset-2 hover:underline"
              to={`/activities/${last.activityId}`}
            >
              Open the draft activity
            </Link>
          </p>
        )}
      </Card>
      <AllEvidence />
    </div>
  );
}

const EVIDENCE_SORTS = ['uploadedAt', 'filename', 'size'] as const;
const LINKED = { linked: 'Linked to an activity', unlinked: 'Unlinked' } as const;
type EvidenceSort = (typeof EVIDENCE_SORTS)[number];

function AllEvidence() {
  const list = useList({
    sorts: EVIDENCE_SORTS,
    defaultSort: 'uploadedAt',
    defaultDir: 'desc',
    filters: { status: Object.keys(EXTRACTION_STATUS), linked: Object.keys(LINKED) },
  });
  const q = useListQuery<EvidenceRow, EvidenceSort, 'status' | 'linked'>(
    'evidence',
    '/api/evidence',
    list,
  );
  const qc = useQueryClient();
  const remove = useMutation({
    mutationFn: (id: string) => api(`/api/evidence/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['evidence'] }),
  });
  const data = q.data;
  const chips: Chip[] = [
    list.q && { key: 'q', label: `Search: ${list.q}`, onRemove: () => list.set({ q: '' }) },
    list.filters.status && {
      key: 'status',
      label: EXTRACTION_STATUS[list.filters.status as keyof typeof EXTRACTION_STATUS].label,
      onRemove: () => list.set({ status: '' }),
    },
    list.filters.linked && {
      key: 'linked',
      label: LINKED[list.filters.linked as keyof typeof LINKED],
      onRemove: () => list.set({ linked: '' }),
    },
  ].filter(Boolean) as Chip[];
  const sortTh = (
    key: EvidenceSort,
    label: string,
    natural: 'asc' | 'desc',
    className?: string,
  ) => (
    <SortableTh
      active={list.sort === key}
      direction={list.dir}
      onSort={() => list.sortBy(key, natural)}
      {...(className && { className })}
    >
      {label}
    </SortableTh>
  );
  return (
    <section aria-labelledby="evidence-heading" className="space-y-3">
      <h2 id="evidence-heading" className="text-lg font-semibold">
        All evidence
      </h2>
      <Toolbar
        label="Evidence filters"
        end={<ResultCount page={list.page} perPage={list.perPage} total={data?.total} />}
      >
        <SearchField
          label="Search evidence"
          placeholder="File name"
          value={list.q}
          onCommit={(v) => list.set({ q: v })}
        />
        <FilterSelect
          label="Extraction"
          value={list.filters.status}
          options={options(EXTRACTION_STATUS)}
          onChange={(v) => list.set({ status: v })}
        />
        <FilterSelect
          label="Links"
          value={list.filters.linked}
          options={options(LINKED)}
          onChange={(v) => list.set({ linked: v })}
        />
        <PerPageSelect value={list.perPage} onChange={(n) => list.set({ per_page: n })} />
      </Toolbar>
      <FilterChips chips={chips} onClearAll={list.clear} />
      <ErrorText error={remove.error} />
      {q.isPending && <Skeleton rows={5} />}
      {q.isError && <ErrorText error={q.error} />}
      {data && data.total === 0 && (
        <ListEmpty
          narrowed={list.narrowed}
          onClear={list.clear}
          noun="files"
          emptyTitle="Nothing uploaded yet"
          emptyDescription="Uploaded certificates and receipts are listed here."
        />
      )}
      {data && data.rows.length > 0 && (
        <div className={cn(q.isPlaceholderData && 'opacity-60')}>
          <Table label="Evidence files">
            <THead>
              <tr>
                {sortTh('filename', 'File', 'asc')}
                {sortTh('size', 'Size', 'desc', 'text-right')}
                {sortTh('uploadedAt', 'Uploaded', 'desc')}
                <Th>Extraction</Th>
                <Th>Activities</Th>
                <Th>
                  <span className="sr-only">Actions</span>
                </Th>
              </tr>
            </THead>
            <TBody>
              {data.rows.map((e) => (
                <Tr key={e.id}>
                  <Td className="max-w-80">
                    <a
                      className="block truncate text-fg underline-offset-2 hover:text-accent hover:underline"
                      href={`/api/evidence/${e.id}/content`}
                      target="_blank"
                      rel="noreferrer"
                      title={e.filename}
                    >
                      {e.filename}
                    </a>
                  </Td>
                  <Td numeric className="whitespace-nowrap">
                    {bytes(e.sizeBytes)}
                  </Td>
                  <Td className="num whitespace-nowrap">{e.uploadedAt.slice(0, 10)}</Td>
                  <Td>
                    <Badge tone={EXTRACTION_STATUS[e.extractionStatus].tone}>
                      {EXTRACTION_STATUS[e.extractionStatus].label}
                    </Badge>
                  </Td>
                  <Td className="text-xs">
                    {e.activityIds && e.activityIds.length > 0 ? (
                      <span className="flex flex-wrap gap-x-2">
                        {e.activityIds.map((id, i) => (
                          <Link
                            key={id}
                            className="text-accent underline-offset-2 hover:underline"
                            to={`/activities/${id}`}
                          >
                            activity {i + 1}
                          </Link>
                        ))}
                      </span>
                    ) : (
                      <Badge tone="warn">Unlinked</Badge>
                    )}
                  </Td>
                  <Td className="text-right">
                    {(!e.activityIds || e.activityIds.length === 0) && (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={remove.isPending}
                        onClick={() => {
                          if (
                            confirm(
                              `Delete ${e.filename}? The file is removed from storage and cannot be recovered.`,
                            )
                          )
                            remove.mutate(e.id);
                        }}
                      >
                        Delete
                        <span className="sr-only"> {e.filename}</span>
                      </Button>
                    )}
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        </div>
      )}
      {data && (
        <Pagination
          page={list.page}
          pages={data.pages}
          perPage={list.perPage}
          total={data.total}
          hrefFor={list.hrefFor}
          label="Evidence pages"
        />
      )}
    </section>
  );
}
