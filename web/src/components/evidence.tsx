import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import { ApiError, api } from '@/lib/api';
import { Badge, Button, Card, ErrorText, Input } from '@/components/ui';

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

const fmtBytes = (n: number) =>
  n < 1024
    ? `${n} B`
    : n < 1048576
      ? `${(n / 1024).toFixed(1)} KB`
      : `${(n / 1048576).toFixed(1)} MB`;
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
              {e.contentType} · {fmtBytes(e.sizeBytes)}
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
  const all = useQuery({
    queryKey: ['evidence'],
    queryFn: () => api<EvidenceRow[]>('/api/evidence'),
  });
  const [last, setLast] = useState<UploadResult | null>(null);
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
      <Card>
        <h2 className="mb-1 font-semibold">Add evidence</h2>
        <p className="mb-3 text-xs text-muted-foreground">
          Upload a certificate or receipt first; a draft activity is created and pre-filled from the
          document where possible. You finish it and confirm the credit fan-out.
        </p>
        <EvidenceUpload onDone={setLast} />
        {last && (
          <p className="mt-3 text-sm">
            <Link className="underline" to={`/activities/${last.activityId}`}>
              Open the draft activity →
            </Link>
          </p>
        )}
      </Card>
      <Card>
        <h3 className="mb-2 font-semibold">All evidence</h3>
        <ul className="divide-y text-sm">
          {all.data?.map((e) => (
            <li key={e.id} className="flex flex-wrap items-center gap-2 py-1.5">
              <span>{e.filename}</span>
              <span className="text-xs text-muted-foreground">
                {fmtBytes(e.sizeBytes)} · {e.uploadedAt.slice(0, 10)}
              </span>
              <Badge tone={STATUS[e.extractionStatus][1]}>{STATUS[e.extractionStatus][0]}</Badge>
              <span className="ml-auto text-xs">
                {e.activityIds?.map((id) => (
                  <Link key={id} className="mr-1 underline" to={`/activities/${id}`}>
                    activity
                  </Link>
                ))}
              </span>
            </li>
          ))}
          {all.data?.length === 0 && (
            <li className="text-muted-foreground">Nothing uploaded yet.</li>
          )}
        </ul>
      </Card>
    </div>
  );
}
