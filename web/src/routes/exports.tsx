import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { fetchAll } from '@/lib/list';
import type { Held } from '@/lib/types';
import { Badge, Button, Card, ErrorText, Input } from '@/components/ui';

interface ExportRow {
  id: string;
  bodyId: string;
  cycleId: string;
  status: 'building' | 'ready' | 'failed';
  progress: { done: number; total: number; bytes?: number } | null;
  objectKey: string | null;
  createdAt: string;
}

export function ExportsPage() {
  const qc = useQueryClient();
  const held = useQuery({
    queryKey: ['held', 'all'],
    queryFn: () => fetchAll<Held>('/api/held?view=basic'),
  });
  const list = useQuery({
    queryKey: ['exports'],
    queryFn: () => api<ExportRow[]>('/api/exports'),
    refetchInterval: (q) => (q.state.data?.some((e) => e.status === 'building') ? 2000 : false),
  });
  const create = useMutation({
    mutationFn: (cycleId: string) => api('/api/exports', { method: 'POST', body: { cycleId } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['exports'] }),
  });
  const tick = useMutation({
    mutationFn: () => api('/api/jobs/tick', { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['exports'] }),
  });
  const del = useMutation({
    mutationFn: (id: string) => api(`/api/exports/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['exports'] }),
  });
  const label = (cycleId: string) => {
    const h = held.data?.find((x) => x.cycles.some((c) => c.id === cycleId));
    const c = h?.cycles.find((x) => x.id === cycleId);
    return h && c
      ? `${h.certification.abbreviation} cycle ${c.sequence} (${c.startsOn} → ${c.endsOn})`
      : cycleId;
  };
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
      <Card>
        <h2 className="mb-1 font-semibold">Build an export</h2>
        <p className="mb-3 text-xs text-muted-foreground">
          One bundle per cycle: a CSV in the issuer's field order, an evidence manifest, a README,
          and the evidence files. You enter the rows into the portal yourself.
        </p>
        <ul className="divide-y">
          {held.data?.flatMap((h) =>
            h.cycles.map((c) => (
              <li key={c.id} className="flex items-center gap-2 py-2 text-sm">
                <span>
                  {h.certification.abbreviation}{' '}
                  <span className="text-muted-foreground">
                    cycle {c.sequence} · {c.startsOn} → {c.endsOn}
                  </span>
                </span>
                <Badge>{c.status}</Badge>
                <Button
                  size="sm"
                  variant="outline"
                  className="ml-auto"
                  onClick={() => create.mutate(c.id)}
                  disabled={create.isPending}
                >
                  Build
                </Button>
              </li>
            )),
          )}
        </ul>
        <ErrorText error={create.error} />
        <p className="mt-2 text-xs text-muted-foreground">
          Builds run on the next tick (15 s on self-hosted, up to a minute on Cloudflare).{' '}
          <button className="underline" onClick={() => tick.mutate()}>
            Run now
          </button>
        </p>
      </Card>
      <Card>
        <h2 className="mb-2 font-semibold">Exports</h2>
        <ul className="divide-y">
          {list.data?.map((e) => (
            <li key={e.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
              <span>{label(e.cycleId)}</span>
              <Badge tone={e.status === 'ready' ? 'ok' : e.status === 'failed' ? 'bad' : 'warn'}>
                {e.status}
                {e.progress ? ` ${e.progress.done}/${e.progress.total}` : ''}
              </Badge>
              <span className="text-xs text-muted-foreground">
                {e.createdAt.slice(0, 16).replace('T', ' ')}
                {e.progress?.bytes ? ` · ${(e.progress.bytes / 1024).toFixed(0)} KB` : ''}
              </span>
              {e.status === 'ready' && (
                <a className="ml-auto text-xs underline" href={`/api/exports/${e.id}/download`}>
                  download
                </a>
              )}
              <Button size="sm" variant="ghost" onClick={() => del.mutate(e.id)}>
                remove
              </Button>
            </li>
          ))}
          {list.data?.length === 0 && (
            <li className="py-2 text-sm text-muted-foreground">No exports yet.</li>
          )}
        </ul>
      </Card>
    </div>
  );
}

export function BackupPage() {
  const [file, setFile] = useState<File | null>(null);
  const [force, setForce] = useState(false);
  const restore = useMutation({
    mutationFn: async () => {
      const fd = new FormData();
      fd.set('file', file!, file!.name);
      if (force) fd.set('force', '1');
      const res = await fetch('/api/backup/restore', {
        method: 'POST',
        body: fd,
        credentials: 'same-origin',
      });
      const json = (await res.json()) as {
        ok: boolean;
        statements: number;
        objects: number;
        diffs: unknown[];
        error?: string;
      };
      if (!res.ok && res.status !== 207) throw new Error(json.error ?? String(res.status));
      return json;
    },
  });
  const verify = useMutation({
    mutationFn: async () => {
      const { unzipSync } = await import('fflate');
      const files = unzipSync(new Uint8Array(await file!.arrayBuffer()));
      const manifest = new TextDecoder().decode(files['manifest.json']!);
      return api<{ ok: boolean; diffs: unknown[] }>('/api/backup/verify', {
        method: 'POST',
        body: JSON.parse(manifest),
      });
    },
  });
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
      <Card>
        <h2 className="mb-1 font-semibold">Backup</h2>
        <p className="mb-3 text-xs text-muted-foreground">
          One zip: a SQL dump of every table, a manifest with per-table checksums and every evidence
          hash, and the evidence files. Portable between the self-hosted and Cloudflare targets.
        </p>
        <a
          className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground"
          href="/api/backup"
        >
          Download backup
        </a>
        <p className="mt-3 text-xs text-muted-foreground">
          From a terminal: <code>npm run backup</code>, <code>npm run restore -- file.zip</code>,{' '}
          <code>npm run verify-restore -- file.zip</code> with <code>CPE_URL</code> and{' '}
          <code>CPE_PASSWORD</code>.
        </p>
      </Card>
      <Card>
        <h2 className="mb-1 font-semibold">Restore / verify</h2>
        <p className="mb-3 text-xs text-muted-foreground">
          Restore replaces everything on this instance, including the owner password, with the
          backup's contents. A fresh instance accepts a restore before setup. A non-empty instance
          requires the wipe checkbox.
        </p>
        <Input
          type="file"
          accept=".zip,application/zip"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
        <label className="mt-2 flex items-center gap-2 text-sm">
          <input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} />{' '}
          Wipe this instance first (required when not empty)
        </label>
        <div className="mt-3 flex gap-2">
          <Button
            variant="outline"
            disabled={!file || verify.isPending}
            onClick={() => verify.mutate()}
          >
            Verify against this backup
          </Button>
          <Button
            variant="destructive"
            disabled={!file || restore.isPending}
            onClick={() => {
              if (confirm('Replace this instance with the backup?')) restore.mutate();
            }}
          >
            Restore
          </Button>
        </div>
        <ErrorText error={restore.error ?? verify.error} />
        {verify.data && (
          <p className="mt-2 text-sm">
            {verify.data.ok
              ? 'Verified: zero differences.'
              : `${verify.data.diffs.length} difference(s):`}
            {!verify.data.ok && (
              <pre className="mt-1 max-h-60 overflow-auto rounded bg-muted p-2 text-[11px]">
                {JSON.stringify(verify.data.diffs, null, 2)}
              </pre>
            )}
          </p>
        )}
        {restore.data && (
          <p className="mt-2 text-sm">
            Restored {restore.data.statements} rows and {restore.data.objects} evidence files.{' '}
            {restore.data.ok
              ? 'Verified: zero differences.'
              : `${restore.data.diffs.length} difference(s).`}{' '}
            Reload and log in with the backup's password.
          </p>
        )}
      </Card>
    </div>
  );
}
