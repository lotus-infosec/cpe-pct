import { useQuery } from '@tanstack/react-query';
import { useLocation } from 'react-router';

interface HealthResponse {
  ok: boolean;
  pings: number;
  at: string;
}

async function fetchHealth(): Promise<HealthResponse> {
  const res = await fetch('/api/health');
  if (!res.ok) throw new Error(`health ${res.status}`);
  return res.json() as Promise<HealthResponse>;
}

export function Health() {
  const { pathname } = useLocation();
  const q = useQuery({ queryKey: ['health'], queryFn: fetchHealth });
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 p-6">
      <h1 className="text-2xl font-semibold">CPE PCT</h1>
      <section className="rounded-lg border bg-card p-4 text-card-foreground">
        <p className="text-sm text-muted-foreground">Health pings recorded</p>
        <p className="text-4xl font-bold tabular-nums">
          {q.isPending ? '…' : q.isError ? 'error' : q.data.pings}
        </p>
        {q.data && <p className="text-xs text-muted-foreground">last: {q.data.at}</p>}
      </section>
      <p className="text-xs text-muted-foreground">route: {pathname}</p>
      <footer className="text-xs text-muted-foreground">
        Not affiliated with or endorsed by any certifying body. Certification names are trademarks
        of their respective owners. The issuer's current policy governs.
      </footer>
    </main>
  );
}
