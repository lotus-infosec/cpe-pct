import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * The row above a list: search and filters on the left, result count and page-size on the right.
 * STAGE7 fills it; STAGE6 only fixes its shape so every list gets the same one.
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
    <div
      role="toolbar"
      aria-label={label}
      className={cn('flex flex-wrap items-center gap-2', className)}
    >
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">{children}</div>
      {end && <div className="flex items-center gap-2 text-sm text-dim">{end}</div>}
    </div>
  );
}
