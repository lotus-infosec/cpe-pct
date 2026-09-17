import { useEffect, useRef, useState, type ComponentType, type FormEvent } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  BadgeCheck,
  Bell,
  DatabaseBackup,
  FileCheck,
  FileDown,
  LayoutDashboard,
  ListChecks,
  LogOut,
  Menu,
  Paperclip,
  Search,
  Settings,
  Upload,
  X,
} from 'lucide-react';
import { api } from '@/lib/api';
import { routeTitle, useDocumentTitle } from '@/lib/title';
import { cn } from '@/lib/utils';

type Icon = ComponentType<{ className?: string; strokeWidth?: number; 'aria-hidden'?: boolean }>;
type Item = { to: string; label: string; icon: Icon };

const groups: { label: string; items: Item[] }[] = [
  {
    label: 'Track',
    items: [
      { to: '/', label: 'Dashboard', icon: LayoutDashboard },
      { to: '/activities', label: 'Activities', icon: ListChecks },
      { to: '/applications', label: 'Credit applications', icon: FileCheck },
      { to: '/evidence', label: 'Evidence', icon: Paperclip },
    ],
  },
  {
    label: 'Manage',
    items: [
      { to: '/certifications', label: 'Certifications', icon: BadgeCheck },
      { to: '/import', label: 'Import', icon: Upload },
      { to: '/exports', label: 'Exports', icon: FileDown },
    ],
  },
  {
    label: 'System',
    items: [
      { to: '/notifications', label: 'Notifications', icon: Bell },
      { to: '/settings', label: 'Settings', icon: Settings },
      { to: '/backup', label: 'Backup', icon: DatabaseBackup },
    ],
  },
];

/** Unread count, sharing the Notifications page's query so marking one read updates both. */
function useUnread() {
  const q = useQuery({
    queryKey: ['notifications'],
    queryFn: () => api<{ status: 'pending' | 'sent' | 'read' }[]>('/api/notifications'),
  });
  return q.data?.filter((n) => n.status !== 'read').length ?? 0;
}

function Wordmark() {
  return (
    <NavLink
      to="/"
      className="inline-flex items-center gap-2 rounded-control px-1 text-lg font-semibold tracking-tight text-fg"
    >
      <img src="/favicon.svg" alt="" width={26} height={26} className="size-6.5 shrink-0" />
      CPE PCT
    </NavLink>
  );
}

/**
 * Finds a certification from anywhere: submits to the dashboard's own search, so the result is the
 * same linkable, filterable view. `/` focuses it on pages that have no list search of their own.
 */
function GlobalSearch() {
  const nav = useNavigate();
  const ref = useRef<HTMLInputElement>(null);
  const [term, setTerm] = useState('');
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return;
      if (document.querySelector('[data-list-search]')) return;
      const t = e.target as HTMLElement;
      if (t.closest('input, textarea, select, [contenteditable="true"]')) return;
      if (!ref.current?.offsetParent) return;
      e.preventDefault();
      ref.current.focus();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);
  return (
    <form
      role="search"
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        const q = term.trim().slice(0, 100);
        nav(q ? `/?${new URLSearchParams({ q })}` : '/');
        setTerm('');
        ref.current?.blur();
      }}
      className="relative"
    >
      <Search
        aria-hidden
        className="pointer-events-none absolute top-2 left-2.5 size-4 text-dim"
        strokeWidth={1.5}
      />
      <input
        ref={ref}
        type="search"
        aria-label="Find a certification"
        placeholder="Find a certification"
        maxLength={100}
        autoComplete="off"
        spellCheck={false}
        value={term}
        onChange={(e) => setTerm(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setTerm('');
        }}
        className="h-8 w-full rounded-control border border-hairline bg-panel pr-2 pl-8 text-sm text-fg placeholder:text-dim focus:border-accent focus:outline-none [&::-webkit-search-cancel-button]:hidden"
      />
    </form>
  );
}

function Count({ n }: { n: number }) {
  if (n === 0) return null;
  return (
    <span className="num ml-auto rounded-control border border-hairline bg-panel-strong px-1.5 text-xs text-fg">
      {n > 99 ? '99+' : n}
      <span className="sr-only"> unread</span>
    </span>
  );
}

function Nav({ unread }: { unread: number }) {
  return (
    <nav aria-label="Primary" className="flex flex-col gap-5">
      {groups.map((g) => (
        <div key={g.label}>
          <p className="mb-1.5 px-2.5 text-xs font-medium text-dim">{g.label}</p>
          <ul className="flex flex-col gap-0.5">
            {g.items.map(({ to, label, icon: Icon }) => (
              <li key={to}>
                <NavLink
                  to={to}
                  end={to === '/'}
                  className={({ isActive }) =>
                    cn(
                      'relative flex h-8 items-center gap-2.5 rounded-control px-2.5 text-sm',
                      isActive
                        ? 'bg-panel-strong text-fg before:absolute before:inset-y-1.5 before:left-0 before:w-0.5 before:rounded-full before:bg-accent'
                        : 'text-dim hover:bg-panel hover:text-fg',
                    )
                  }
                >
                  <Icon aria-hidden className="size-4 shrink-0" strokeWidth={1.5} />
                  {label}
                  {to === '/notifications' && <Count n={unread} />}
                </NavLink>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}

function LogOutButton({ className }: { className?: string }) {
  const qc = useQueryClient();
  const logout = useMutation({
    mutationFn: () => api('/api/logout', { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries(),
  });
  return (
    <button
      type="button"
      onClick={() => logout.mutate()}
      className={cn(
        'flex h-8 items-center gap-2.5 rounded-control px-2.5 text-sm text-dim hover:bg-panel hover:text-fg',
        className,
      )}
    >
      <LogOut aria-hidden className="size-4" strokeWidth={1.5} />
      Log out
    </button>
  );
}

export function Layout() {
  const unread = useUnread();
  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();
  // Close the mobile menu after navigating, so the new page is not hidden behind it.
  useEffect(() => setMenuOpen(false), [location.pathname]);
  useDocumentTitle(routeTitle(location.pathname));

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[15rem_minmax(0,1fr)]">
      <a
        href="#main"
        className="sr-only rounded-control bg-accent px-3 py-2 text-ground focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50"
      >
        Skip to content
      </a>

      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-screen flex-col gap-6 overflow-y-auto border-r border-hairline px-3 py-5 lg:flex">
        <div className="px-1.5">
          <Wordmark />
        </div>
        <GlobalSearch />
        <Nav unread={unread} />
        <div className="mt-auto border-t border-hairline pt-3">
          <LogOutButton className="w-full" />
        </div>
      </aside>

      {/* Top bar below 1024px */}
      <header className="sticky top-0 z-40 border-b border-hairline bg-ground/90 backdrop-blur lg:hidden">
        <div className="flex h-14 items-center gap-2 px-4">
          <Wordmark />
          <NavLink
            to="/notifications"
            className="ml-auto flex h-9 items-center gap-1.5 rounded-control px-2.5 text-dim hover:bg-panel hover:text-fg"
          >
            <Bell aria-hidden className="size-4" strokeWidth={1.5} />
            <span className="sr-only">Notifications</span>
            {unread > 0 && (
              <span className="num text-xs text-fg">
                {unread > 99 ? '99+' : unread}
                <span className="sr-only"> unread</span>
              </span>
            )}
          </NavLink>
          <button
            type="button"
            aria-expanded={menuOpen}
            aria-controls="mobile-nav"
            onClick={() => setMenuOpen((o) => !o)}
            className="flex size-9 items-center justify-center rounded-control text-dim hover:bg-panel hover:text-fg"
          >
            {menuOpen ? (
              <X aria-hidden className="size-5" strokeWidth={1.5} />
            ) : (
              <Menu aria-hidden className="size-5" strokeWidth={1.5} />
            )}
            <span className="sr-only">{menuOpen ? 'Close menu' : 'Open menu'}</span>
          </button>
        </div>
        <div
          id="mobile-nav"
          hidden={!menuOpen}
          className="max-h-[calc(100vh-3.5rem)] overflow-y-auto border-t border-hairline px-3 py-4"
        >
          <div className="mb-4">
            <GlobalSearch />
          </div>
          <Nav unread={unread} />
          <div className="mt-5 border-t border-hairline pt-3">
            <LogOutButton className="w-full" />
          </div>
        </div>
      </header>

      <div className="flex min-w-0 flex-col">
        <main id="main" className="mx-auto w-full max-w-[1280px] flex-1 px-4 py-6 sm:px-6 lg:py-8">
          <Outlet />
        </main>
        <footer className="mx-auto w-full max-w-[1280px] border-t border-hairline px-4 py-4 text-xs text-dim sm:px-6">
          Not affiliated with or endorsed by any certifying body. Certification names are trademarks
          of their respective owners. Rule data is a best-effort transcription; the issuer's current
          policy governs. No automated submission, ever.
        </footer>
      </div>
    </div>
  );
}
