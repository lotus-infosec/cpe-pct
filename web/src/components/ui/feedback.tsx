import { useEffect, useState, type ComponentType, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * Names the cause of an empty view and offers the way out. No illustration, no emoji, no jokes
 * (STAGE6 voice): a title that states what is missing, one sentence of why, one action.
 */
export function EmptyState({
  title,
  description,
  action,
  icon: Icon,
  className,
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  icon?: ComponentType<{ className?: string; strokeWidth?: number; 'aria-hidden'?: boolean }>;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center gap-2 rounded-card border border-dashed border-hairline px-6 py-10 text-center',
        className,
      )}
    >
      {Icon && <Icon aria-hidden className="mb-1 size-5 text-mute" strokeWidth={1.5} />}
      <p className="font-medium text-fg">{title}</p>
      {description && <p className="max-w-sm text-sm text-dim">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

/**
 * Loading placeholder that stays invisible for the first 200ms, so a fast response never flashes a
 * skeleton on the way to its content.
 */
export function Skeleton({ rows = 3, className }: { rows?: number; className?: string }) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setVisible(true), 200);
    return () => clearTimeout(t);
  }, []);
  if (!visible) return <div aria-busy="true" className={className} />;
  return (
    <div aria-busy="true" aria-live="polite" className={cn('space-y-2', className)}>
      <span className="sr-only">Loading</span>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="h-(--row-height) rounded-control bg-panel" />
      ))}
    </div>
  );
}
