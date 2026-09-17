import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { cn } from '@/lib/utils';

interface CycleLike {
  id: string;
  sequence: number;
  status: string;
}

/** Where a certification's name leads: its open cycle, or the latest one when none is open. */
export function certCycleId(cycles: CycleLike[] | undefined): string | null {
  if (!cycles?.length) return null;
  const open = cycles.find((c) => c.status === 'open');
  if (open) return open.id;
  return cycles.reduce((a, b) => (b.sequence > a.sequence ? b : a)).id;
}

/**
 * A certification name that navigates to its cycle. A real anchor, so middle-click, Ctrl+click and
 * "copy link" all work. With `stretch`, a pseudo-element covers the nearest positioned ancestor (a
 * `RowLinkTr` or a card with `relative`), which makes the whole row clickable without an `onClick`
 * on the row. The focus ring is drawn on that pseudo-element so it outlines the row, not the word.
 * Other controls in the stretched area must sit above it: give them `LIFT`.
 */
export function CertLink({
  cycles,
  children,
  stretch = false,
  className,
}: {
  cycles: CycleLike[] | undefined;
  children: ReactNode;
  stretch?: boolean;
  className?: string;
}) {
  const id = certCycleId(cycles);
  if (!id) return <span className={className}>{children}</span>;
  return (
    <Link
      to={`/cycles/${id}`}
      className={cn(
        'text-fg underline-offset-2 hover:text-accent hover:underline',
        // Inline among other text, colour alone does not mark a link (WCAG 1.4.1); a stretched name
        // stands alone in its cell or heading, and the row hover carries the affordance.
        !stretch && 'underline',
        stretch &&
          'after:absolute after:inset-0 after:rounded-[inherit] after:content-[""] focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:-outline-offset-2 focus-visible:after:outline-accent',
        className,
      )}
    >
      {children}
    </Link>
  );
}

/** Lifts a control above a stretched link so it keeps its own click target. */
export const LIFT = 'relative z-10';

/** Hover and positioning for a row or card that carries a stretched `CertLink`. */
export const LINKED = 'relative hover:bg-hover';
