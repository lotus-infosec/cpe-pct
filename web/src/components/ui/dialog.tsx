import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Native <dialog> opened with showModal(), so the browser supplies the focus trap, the inert
 * background and Escape-to-close. `open` is the source of truth; closing by Escape or the close
 * button calls `onClose` so the owner of the state stays in charge of it.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  className,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      aria-labelledby="dialog-title"
      className={cn(
        'm-auto w-[min(32rem,calc(100vw-2rem))] rounded-dialog border border-hairline bg-raised p-0 text-fg shadow-overlay backdrop:bg-ground/70',
        className,
      )}
    >
      {open && (
        <div className="flex flex-col gap-4 p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 id="dialog-title" className="text-lg">
                {title}
              </h2>
              {description && <div className="mt-1 text-sm text-dim">{description}</div>}
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="-mt-1 -mr-1 rounded-control p-1.5 text-dim hover:bg-panel hover:text-fg"
            >
              <X aria-hidden className="size-4" strokeWidth={1.5} />
            </button>
          </div>
          {children}
          {footer && <div className="flex justify-end gap-2 pt-1">{footer}</div>}
        </div>
      )}
    </dialog>
  );
}
