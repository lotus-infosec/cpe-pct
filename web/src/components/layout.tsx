import { NavLink, Outlet } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Button } from './ui';

const links = [
  ['/', 'Dashboard'],
  ['/activities', 'Activities'],
  ['/certifications', 'Certifications'],
  ['/import', 'Import'],
] as const;

export function Layout() {
  const qc = useQueryClient();
  const logout = useMutation({
    mutationFn: () => api('/api/logout', { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries(),
  });
  return (
    <div className="mx-auto flex min-h-screen max-w-5xl flex-col px-4 py-4 sm:px-6">
      <header className="mb-6 flex flex-wrap items-center gap-4 border-b pb-3">
        <NavLink to="/" className="text-lg font-semibold">
          CPE PCT
        </NavLink>
        <nav className="flex gap-1 text-sm">
          {links.map(([to, label]) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                `rounded px-2 py-1 ${isActive ? 'bg-muted font-medium' : 'text-muted-foreground hover:bg-muted'}`
              }
            >
              {label}
            </NavLink>
          ))}
        </nav>
        <Button variant="ghost" size="sm" className="ml-auto" onClick={() => logout.mutate()}>
          Log out
        </Button>
      </header>
      <main className="flex-1">
        <Outlet />
      </main>
      <footer className="mt-10 border-t pt-3 text-xs text-muted-foreground">
        Not affiliated with or endorsed by any certifying body. Certification names are trademarks
        of their respective owners. Rule data is a best-effort transcription; the issuer's current
        policy governs. No automated submission, ever.
      </footer>
    </div>
  );
}
