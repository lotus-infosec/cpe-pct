import type { Cycle, IsoDate } from '../domain/types';
import { addMonths } from '../cycles/dates';

export interface RenewalInput {
  renewedOn: IsoDate;
  /** Rule version to pin on the new cycle (the app passes the current one; never "latest" implicitly). */
  ruleVersionId: string;
  cycleMonths: number;
  newCycleId: string;
}

/** Closes a cycle as renewed and opens the next one starting where the old one ended. Pure. */
export function rollover(cycle: Cycle, input: RenewalInput): { closed: Cycle; opened: Cycle } {
  const closed: Cycle = { ...cycle, status: 'renewed' };
  const startsOn = cycle.endsOn;
  const opened: Cycle = {
    id: input.newCycleId,
    heldCertId: cycle.heldCertId,
    sequence: cycle.sequence + 1,
    startsOn,
    endsOn: addMonths(startsOn, input.cycleMonths),
    ruleVersionId: input.ruleVersionId,
    status: 'open',
  };
  return { closed, opened };
}

/** First cycle for a newly held certification. */
export function firstCycle(
  heldCertId: string,
  earnedOn: IsoDate,
  cycleMonths: number,
  ruleVersionId: string,
  id: string,
): Cycle {
  return {
    id,
    heldCertId,
    sequence: 1,
    startsOn: earnedOn,
    endsOn: addMonths(earnedOn, cycleMonths),
    ruleVersionId,
    status: 'open',
  };
}
