import type { TickBudget, TickSource } from '../../ports';

/** Workers tick: the platform calls scheduled() once per cron fire; we just run one bounded pass. */
export class CronTickSource implements TickSource {
  private run: ((budget: TickBudget) => Promise<void>) | null = null;
  constructor(private readonly budget: TickBudget) {}
  start(run: (budget: TickBudget) => Promise<void>): void {
    this.run = run;
  }
  /** Called from the `scheduled` handler. */
  async fire(): Promise<void> {
    if (this.run) await this.run(this.budget);
  }
}
