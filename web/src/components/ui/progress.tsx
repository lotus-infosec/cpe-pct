import { cn } from '@/lib/utils';

/**
 * The one place a gradient is allowed (D-040). The fill runs accent into ok, so the colour encodes
 * movement toward compliance: a bar at 20% reads blue, at 100% green. A failing cycle is flat `bad`,
 * because failure does not get to look pretty. The value is clamped at 100% for display only; the
 * real total belongs to whoever renders the numbers beside it.
 */
export function Progress({
  value,
  max,
  failing = false,
  label,
  className,
}: {
  value: number;
  max: number;
  failing?: boolean;
  /** Accessible name, for example "CISSP continuing education credits". */
  label: string;
  className?: string;
}) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={Math.min(value, max)}
      className={cn('h-1.5 w-full overflow-hidden rounded-full bg-panel-strong', className)}
    >
      <div
        className={cn('h-full rounded-full', failing && 'bg-bad')}
        style={{
          width: `${pct}%`,
          // Stretch the gradient across the whole track rather than the filled part, so a short bar
          // shows only the start of the ramp instead of compressing all of it.
          ...(failing
            ? {}
            : {
                backgroundImage: 'var(--progress-fill)',
                backgroundSize: pct > 0 ? `${(100 / pct) * 100}% 100%` : undefined,
              }),
        }}
      />
    </div>
  );
}
