import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * The controls above a list: search, filters, sort and page size wrap in one row, and the result
 * count sits beneath them. Below 640px every control takes the full width.
 */
export function Toolbar({
  children,
  end,
  className,
  label = 'List controls',
}: {
  children?: ReactNode;
  end?: ReactNode;
  className?: string;
  label?: string;
}) {
  return (
    <div role="toolbar" aria-label={label} className={cn('space-y-2', className)}>
      <div className="flex flex-wrap items-center gap-2 max-sm:[&>*]:w-full">{children}</div>
      {end && <div className="flex items-center gap-2 text-sm text-dim">{end}</div>}
    </div>
  );
}

/** The one `<h1>` on a page, an optional line of context, and the page's main actions. */
export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-1 text-sm text-dim">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
