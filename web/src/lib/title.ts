import { useEffect } from 'react';

const APP = 'CPE PCT';

/** Page name first, so a pinned tab and the history menu stay readable: "Dashboard — CPE PCT". */
export function useDocumentTitle(name: string | null) {
  useEffect(() => {
    document.title = name ? `${name} — ${APP}` : APP;
  }, [name]);
}

const ROUTES: [prefix: string, name: string][] = [
  ['/activities/', 'Activity'],
  ['/activities', 'Activities'],
  ['/applications', 'Credit applications'],
  ['/evidence', 'Evidence'],
  ['/certifications', 'Certifications'],
  ['/cycles/', 'Cycle'],
  ['/import', 'Import'],
  ['/exports', 'Exports'],
  ['/notifications', 'Notifications'],
  ['/settings', 'Settings'],
  ['/backup', 'Backup'],
];

export function routeTitle(pathname: string): string {
  return ROUTES.find(([prefix]) => pathname.startsWith(prefix))?.[1] ?? 'Dashboard';
}
