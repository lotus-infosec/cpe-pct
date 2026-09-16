import type { ReactNode, TdHTMLAttributes, ThHTMLAttributes } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Tables sit in a scroll container of their own, so a wide table never pushes the page sideways.
 * Rows are `--row-height` tall. Numeric cells use `num` so a column of values lines up.
 */
export function Table({
  children,
  className,
  label,
}: {
  children: ReactNode;
  className?: string;
  /** Accessible name for the table; rendered as a visually hidden caption. */
  label?: string;
}) {
  return (
    // `relative` makes this the containing block for visually hidden text inside cells; without it
    // those absolutely positioned spans escape the scroll container and widen the page on phones.
    <div className="relative overflow-x-auto rounded-card border border-hairline bg-panel">
      <table className={cn('w-full border-collapse text-left text-sm', className)}>
        {label && <caption className="sr-only">{label}</caption>}
        {children}
      </table>
    </div>
  );
}

export function THead({ children }: { children: ReactNode }) {
  return <thead className="border-b border-hairline bg-panel-strong text-dim">{children}</thead>;
}

export function TBody({ children }: { children: ReactNode }) {
  return <tbody className="divide-y divide-hairline">{children}</tbody>;
}

export function Tr({ children, className }: { children: ReactNode; className?: string }) {
  return <tr className={cn('h-(--row-height) hover:bg-panel', className)}>{children}</tr>;
}

export function Th({ className, ...p }: ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      scope="col"
      className={cn('px-3 py-2 text-xs font-medium whitespace-nowrap', className)}
      {...p}
    />
  );
}

export type SortDirection = 'asc' | 'desc';

/**
 * A column header that sorts. The button carries the interaction; `aria-sort` on the cell tells
 * assistive technology the current state. Unsorted columns show a neutral glyph so the affordance
 * is visible before anyone discovers it by accident.
 */
export function SortableTh({
  children,
  active,
  direction,
  onSort,
  className,
}: {
  children: ReactNode;
  active: boolean;
  direction: SortDirection;
  onSort: () => void;
  className?: string;
}) {
  const Icon = !active ? ArrowUpDown : direction === 'asc' ? ArrowUp : ArrowDown;
  return (
    <th
      scope="col"
      aria-sort={active ? (direction === 'asc' ? 'ascending' : 'descending') : 'none'}
      className={cn('px-1.5 py-1 text-xs font-medium whitespace-nowrap', className)}
    >
      <button
        type="button"
        onClick={onSort}
        className={cn(
          'inline-flex items-center gap-1 rounded-control px-1.5 py-1 hover:bg-panel hover:text-fg',
          active && 'text-fg',
        )}
      >
        {children}
        <Icon aria-hidden className={cn('size-3.5', !active && 'text-mute')} strokeWidth={1.5} />
      </button>
    </th>
  );
}

export function Td({
  className,
  numeric,
  ...p
}: TdHTMLAttributes<HTMLTableCellElement> & { numeric?: boolean }) {
  return (
    <td className={cn('px-3 py-2 align-middle', numeric && 'num text-right', className)} {...p} />
  );
}
