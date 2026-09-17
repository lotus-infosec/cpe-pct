// warnings.derive: standing + fee schedule → Notification[] with idempotency keys. Pure.
// Keys: `${cycleId}:${kind}:${bucket}` so the same situation never notifies twice.
import type { IsoDate } from '../domain/types';
import type { Notification } from '../../ports';
import type { Standing } from '../rules/standing';
import type { FeePeriod } from '../rules/fees';
import { daysBetween } from '../cycles/dates';
import { fmt } from '../rules/resolve';

export interface DeriveInput {
  standing: Standing;
  fees: FeePeriod[];
  label: string; // e.g. "CISSP (ISC2)"
  cycleEndsOn: IsoDate;
  asOf: IsoDate;
}

export const CYCLE_BUCKETS = [7, 30, 90, 180] as const;
export const FEE_BUCKETS = [7, 30] as const;

export function derive({ standing, fees, label, cycleEndsOn, asOf }: DeriveInput): Notification[] {
  const out: Notification[] = [];
  const c = standing.cycleId;
  const earned = standing.totals.accepted + standing.totals.submitted + standing.totals.claimed;
  const days = daysBetween(asOf, cycleEndsOn);

  // Cycle ending: one notification per bucket crossed (smallest bucket that still contains `days`).
  const bucket = CYCLE_BUCKETS.find((b) => days <= b);
  if (bucket != null && days >= 0) {
    out.push({
      key: `${c}:cycle_ending:${bucket}`,
      kind: 'cycle_ending',
      severity: bucket <= 7 ? 'urgent' : bucket <= 30 ? 'warn' : 'info',
      title: `${label}: cycle ends in ${days} day${days === 1 ? '' : 's'}`,
      body: `${fmt(earned)} of ${fmt(standing.requiredX100)} credits counted (${fmt(standing.totals.accepted)} accepted). ${
        standing.compliant
          ? 'Currently in good standing.'
          : 'Action needed: ' +
            standing.constraints
              .filter((x) => !x.satisfied)
              .map((x) => x.type)
              .join(', ') +
            '.'
      } Ends ${cycleEndsOn}.`,
    });
  }

  // Annual floor at risk: an annual_min year that is unmet and due within 30 days (or already overdue).
  for (const con of standing.constraints) {
    if (con.type !== 'annual_min') continue;
    for (const y of con.of ?? [con]) {
      if (y.satisfied || !y.due) continue;
      const left = daysBetween(asOf, y.due);
      if (left > 30) continue;
      out.push({
        key: `${c}:annual_floor_at_risk:${y.year ?? 0}`,
        kind: 'annual_floor_at_risk',
        severity: con.severity === 'hard' ? (left < 0 ? 'urgent' : 'warn') : 'info',
        title: `${label}: year ${y.year} minimum ${left < 0 ? 'missed' : 'at risk'}`,
        body: `${fmt(y.actual ?? 0)} of ${fmt(y.required ?? 0)} credits in cycle year ${y.year}; ${left < 0 ? `was due ${y.due}` : `due ${y.due} (${left} days)`}. ${con.severity === 'soft' ? 'Suggested by the issuer, not required.' : 'Required by the issuer.'}`,
      });
    }
  }

  // Fees: upcoming uncovered periods (30/7 days) and overdue ones.
  for (const f of fees) {
    if (f.status !== 'due') continue;
    const left = daysBetween(asOf, f.dueOn);
    const amount =
      f.amountCents != null
        ? ` (${(f.amountCents / 100).toFixed(2)} ${f.currency ?? ''})`.trimEnd()
        : '';
    if (left < 0) {
      out.push({
        key: `${c}:fee_overdue:${f.dueOn}`,
        kind: 'fee_overdue',
        severity: 'urgent',
        title: `${label}: maintenance fee overdue`,
        body: `Fee for ${f.periodStart} → ${f.periodEnd}${amount} was due ${f.dueOn}, ${-left} days ago. Scope ${f.scope}.`,
      });
    } else {
      const fb = FEE_BUCKETS.find((b) => left <= b);
      if (fb != null) {
        out.push({
          key: `${c}:fee_due:${f.dueOn}:${fb}`,
          kind: 'fee_due',
          severity: fb <= 7 ? 'warn' : 'info',
          title: `${label}: maintenance fee due in ${left} day${left === 1 ? '' : 's'}`,
          body: `Fee for ${f.periodStart} → ${f.periodEnd}${amount} is due ${f.dueOn}. Scope ${f.scope}.`,
        });
      }
    }
  }
  return out;
}
