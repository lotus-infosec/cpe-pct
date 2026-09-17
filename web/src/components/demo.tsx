// Public demo only (demo branch). The banner states what a visitor is looking at, how long it lasts and
// how much room is left; DemoOffPage stands in for the pages the demo refuses to serve.
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { count } from '@/lib/format';
import { useDocumentTitle } from '@/lib/title';
import { Badge, Card, PageHeader } from '@/components/ui';

const REPO = 'https://github.com/lotus-infosec/cpe-pct';

interface DemoInfo {
  limits: { heldCertifications: number; activities: number };
  used: { heldCertifications: number; activities: number };
  resetEveryHours: number;
  nextResetAt: string;
}

function until(iso: string, now: number): string {
  const mins = Math.max(0, Math.ceil((Date.parse(iso) - now) / 60_000));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h} h ${m} min` : `${m} min`;
}

export function DemoBanner() {
  const q = useQuery({
    queryKey: ['demo'],
    queryFn: () => api<DemoInfo>('/api/demo'),
    refetchInterval: 60_000,
  });
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  const d = q.data;
  return (
    <div
      role="note"
      aria-label="Public demo"
      className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-hairline bg-panel px-4 py-2 text-sm text-dim sm:px-6"
    >
      <Badge tone="warn">Public demo</Badge>
      <span>
        Shared with every visitor and emptied every {d?.resetEveryHours ?? 12} hours. Do not enter
        real data.
      </span>
      {d && (
        <span className="num text-xs">
          Next reset in {until(d.nextResetAt, now)} · {count(d.used.heldCertifications)} of{' '}
          {count(d.limits.heldCertifications)} certifications · {count(d.used.activities)} of{' '}
          {count(d.limits.activities)} activities
        </span>
      )}
      <a className="ml-auto text-fg underline underline-offset-2 hover:text-accent" href={REPO}>
        Run your own
      </a>
    </div>
  );
}

export function DemoOffPage({ title, what }: { title: string; what: string }) {
  useDocumentTitle(title);
  return (
    <div className="space-y-6">
      <PageHeader title={title} />
      <Card className="max-w-2xl text-sm text-dim">
        <p>
          {what} is turned off in the public demo, because anyone can use it. It works in a copy you
          run yourself, on Docker or on your own Cloudflare account.
        </p>
        <p className="mt-2">
          <a className="text-fg underline underline-offset-2 hover:text-accent" href={REPO}>
            Deployment instructions
          </a>
        </p>
      </Card>
    </div>
  );
}
