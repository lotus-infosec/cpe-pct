import type { TickBudget, TickSource } from '../../ports';

/** Self-hosted tick: an in-process interval. Ticks never overlap within the process; the lease covers crashes. */
export class IntervalTickSource implements TickSource {
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  constructor(
    private readonly everyMs = 15_000,
    private readonly budget: TickBudget = { maxJobs: 20, softDeadlineMs: 10_000 },
  ) {}
  start(run: (budget: TickBudget) => Promise<void>): void {
    const tick = async () => {
      if (this.running) return;
      this.running = true;
      try {
        await run(this.budget);
      } catch (e) {
        console.error('tick failed', e);
      } finally {
        this.running = false;
      }
    };
    void tick();
    this.timer = setInterval(() => void tick(), this.everyMs);
    this.timer.unref?.();
  }
  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }
}
