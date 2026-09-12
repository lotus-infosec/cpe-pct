import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Badge, Button, Card, ErrorText, Field, Input } from '@/components/ui';

interface Notification {
  id: string;
  key: string;
  kind: string;
  title: string;
  body: string;
  severity: 'info' | 'warn' | 'urgent';
  status: 'pending' | 'sent' | 'read';
  createdAt: string;
  sentAt: string | null;
}

export function NotificationsPage() {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['notifications'],
    queryFn: () => api<Notification[]>('/api/notifications'),
  });
  const read = useMutation({
    mutationFn: (id: string) => api(`/api/notifications/${id}/read`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  });
  const readAll = useMutation({
    mutationFn: () => api('/api/notifications/read-all', { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  });
  const scan = useMutation({
    mutationFn: () =>
      api<{ derived: number; inserted: number; sent: number; failed: number }>(
        '/api/notifications/scan',
        { method: 'POST', body: {} },
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  });
  const retry = useMutation({
    mutationFn: () =>
      api<{ sent: number; failed: number }>('/api/notifications/retry', { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  });
  const tone = (s: Notification['severity']) =>
    s === 'urgent' ? 'bad' : s === 'warn' ? 'warn' : 'muted';
  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="font-semibold">Notifications</h2>
          <span className="text-xs text-muted-foreground">
            The daily scan runs at 06:00 UTC on both targets. Each situation notifies once.
          </span>
          <div className="ml-auto flex gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => scan.mutate()}
              disabled={scan.isPending}
            >
              Run scan now
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => retry.mutate()}
              disabled={retry.isPending}
            >
              Retry pending sends
            </Button>
            <Button size="sm" variant="ghost" onClick={() => readAll.mutate()}>
              Mark all read
            </Button>
          </div>
        </div>
        {scan.data && (
          <p className="mt-2 text-xs text-muted-foreground">
            Scan: {scan.data.derived} derived, {scan.data.inserted} new, {scan.data.sent} sent,{' '}
            {scan.data.failed} failed sends.
          </p>
        )}
        {retry.data && (
          <p className="mt-2 text-xs text-muted-foreground">
            Retry: {retry.data.sent} sent, {retry.data.failed} failed.
          </p>
        )}
        <ErrorText error={scan.error ?? retry.error} />
      </Card>
      <Card>
        {q.data?.length === 0 && (
          <p className="text-sm text-muted-foreground">
            Nothing yet. Run a scan to check every open cycle now.
          </p>
        )}
        <ul className="divide-y">
          {q.data?.map((n) => (
            <li key={n.id} className={`py-2 text-sm ${n.status === 'read' ? 'opacity-60' : ''}`}>
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={tone(n.severity)}>{n.severity}</Badge>
                <span className="font-medium">{n.title}</span>
                <span className="text-xs text-muted-foreground">
                  {n.createdAt.slice(0, 16).replace('T', ' ')}
                </span>
                <Badge>{n.status}</Badge>
                {n.status !== 'read' && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="ml-auto"
                    onClick={() => read.mutate(n.id)}
                  >
                    mark read
                  </Button>
                )}
              </div>
              <p className="text-xs text-muted-foreground">{n.body}</p>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

export function SettingsPage() {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['settings'],
    queryFn: () => api<Record<string, string>>('/api/settings'),
  });
  const [webhook, setWebhook] = useState<string | null>(null);
  const [discord, setDiscord] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () =>
      api('/api/settings', {
        method: 'PUT',
        body: {
          'notify.webhook_url': webhook ?? q.data?.['notify.webhook_url'] ?? '',
          'notify.discord_url': discord ?? q.data?.['notify.discord_url'] ?? '',
        },
      }),
    onSuccess: () => {
      setWebhook(null);
      setDiscord(null);
      qc.invalidateQueries({ queryKey: ['settings'] });
    },
  });
  const test = useMutation({
    mutationFn: () =>
      api<{ results: { ok: boolean; detail?: string }[] }>('/api/settings/test-send', {
        method: 'POST',
      }),
  });
  if (q.isPending) return <p className="text-sm text-muted-foreground">Loading…</p>;
  return (
    <Card>
      <h2 className="mb-1 font-semibold">Notification settings</h2>
      <p className="mb-3 text-xs text-muted-foreground">
        URLs are stored in this instance's database only and are used solely to POST the
        notifications you see on the Notifications page. Leave blank to disable. In-app
        notifications always work.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Generic webhook URL (JSON POST)">
          <Input
            value={webhook ?? q.data?.['notify.webhook_url'] ?? ''}
            onChange={(e) => setWebhook(e.target.value)}
            placeholder="https://…"
          />
        </Field>
        <Field label="Discord webhook URL">
          <Input
            value={discord ?? q.data?.['notify.discord_url'] ?? ''}
            onChange={(e) => setDiscord(e.target.value)}
            placeholder="https://discord.com/api/webhooks/…"
          />
        </Field>
      </div>
      <div className="mt-3 flex gap-2">
        <Button
          onClick={() => save.mutate()}
          disabled={save.isPending || (webhook === null && discord === null)}
        >
          Save
        </Button>
        <Button variant="outline" onClick={() => test.mutate()} disabled={test.isPending}>
          Send a test
        </Button>
      </div>
      <ErrorText error={save.error ?? test.error} />
      {test.data && (
        <p className="mt-2 text-xs text-muted-foreground">
          Test:{' '}
          {test.data.results
            .map((r, i) => `#${i + 1} ${r.ok ? 'ok' : `failed (${r.detail})`}`)
            .join(' · ')}
        </p>
      )}
    </Card>
  );
}
