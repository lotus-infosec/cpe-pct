// Primitives. Copied-in and owned, per DECISIONS D-009. Every colour, radius and shadow comes from a
// token in index.css; nothing here names a hue or carries a hex value (STAGE6).
import {
  cloneElement,
  isValidElement,
  useId,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactElement,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { cn } from '@/lib/utils';

export { Table, THead, TBody, Tr, Th, SortableTh, Td } from './ui/table';
export { Dialog } from './ui/dialog';
export { Progress } from './ui/progress';
export { EmptyState, Skeleton } from './ui/feedback';
export { Toolbar } from './ui/toolbar';

type ButtonVariant = 'primary' | 'default' | 'ghost' | 'danger';

/**
 * `primary` is the one main action on a screen and the only filled accent button. `default` is the
 * bordered neutral every other action uses. `outline` and `destructive` are the names routes used
 * before STAGE6; they map onto `default` and `danger` and go as pages are rebuilt.
 */
export function Button({
  className,
  variant = 'default',
  size = 'md',
  ...p
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant | 'outline' | 'destructive';
  size?: 'sm' | 'md';
}) {
  const v: ButtonVariant =
    variant === 'outline' ? 'default' : variant === 'destructive' ? 'danger' : variant;
  return (
    <button
      className={cn(
        'inline-flex shrink-0 items-center justify-center gap-1.5 rounded-control font-medium whitespace-nowrap disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0',
        size === 'sm' ? 'h-8 px-3 text-sm' : 'h-9 px-4 text-base',
        v === 'primary' && 'bg-accent text-ground hover:bg-accent-dim',
        v === 'default' && 'border border-hairline bg-panel text-fg hover:bg-panel-strong',
        v === 'ghost' && 'text-dim hover:bg-panel hover:text-fg',
        v === 'danger' &&
          'border border-bad/40 bg-bad/10 text-bad hover:border-bad/70 hover:bg-bad/20',
        className,
      )}
      {...p}
    />
  );
}

const control =
  'w-full rounded-control border border-hairline bg-panel text-base text-fg placeholder:text-dim focus:border-accent focus:outline-none aria-[invalid=true]:border-bad disabled:opacity-50';

export function Input({ className, ...p }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(control, 'h-9 px-3', className)} {...p} />;
}

export function Select({ className, ...p }: SelectHTMLAttributes<HTMLSelectElement>) {
  // Native <option> lists render with the platform's own colours; `color-scheme: dark` on :root
  // keeps them dark instead of a white popup.
  return <select className={cn(control, 'h-9 px-2.5', className)} {...p} />;
}

export function Textarea({ className, ...p }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(control, 'min-h-20 px-3 py-2', className)} {...p} />;
}

export function Label({ children, htmlFor }: { children: ReactNode; htmlFor?: string }) {
  return (
    <label htmlFor={htmlFor} className="mb-1.5 block text-sm font-medium text-dim">
      {children}
    </label>
  );
}

/**
 * A label and its control, associated programmatically. The label used to render as a plain sibling
 * with no `for`, so every form control in the app had no accessible name; screen readers announced
 * "edit text" and nothing else. A single child element gets an id (its own, if it already has one)
 * and the label points at it. Anything other than one element renders as before.
 */
export function Field({ label, children }: { label: string; children: ReactNode }) {
  const generated = useId();
  if (isValidElement(children)) {
    const child = children as ReactElement<{ id?: string }>;
    const id = child.props.id ?? generated;
    return (
      <div>
        <Label htmlFor={id}>{label}</Label>
        {child.props.id ? child : cloneElement(child, { id })}
      </div>
    );
  }
  return (
    <div>
      <Label>{label}</Label>
      {children}
    </div>
  );
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <section className={cn('rounded-card border border-hairline bg-panel p-4 text-fg', className)}>
      {children}
    </section>
  );
}

export type Tone = 'muted' | 'ok' | 'warn' | 'bad' | 'info';

/** State is never carried by colour alone: a badge always holds a word. */
export function Badge({ children, tone = 'muted' }: { children: ReactNode; tone?: Tone }) {
  return (
    <span
      className={cn(
        'num inline-flex items-center rounded-control border px-1.5 py-px text-xs font-medium whitespace-nowrap',
        tone === 'muted' && 'border-hairline bg-panel text-dim',
        tone === 'info' && 'border-hairline bg-panel text-info',
        tone === 'ok' && 'border-ok/30 bg-ok/10 text-ok',
        tone === 'warn' && 'border-warn/30 bg-warn/10 text-warn',
        tone === 'bad' && 'border-bad/30 bg-bad/10 text-bad',
      )}
    >
      {children}
    </span>
  );
}

export function ErrorText({ error }: { error: unknown }) {
  if (!error) return null;
  const e = error as {
    body?: { error?: string; details?: string[]; errors?: { row: number; error: string }[] };
    message?: string;
  };
  const msg =
    e.body?.details?.join('; ') ??
    e.body?.errors?.map((x) => `row ${x.row}: ${x.error}`).join('; ') ??
    e.body?.error ??
    e.message ??
    String(error);
  return (
    <p role="alert" className="text-sm text-bad">
      {msg}
    </p>
  );
}
