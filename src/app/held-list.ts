// Held certifications and the dashboard page in memory, not in SQL: standing is computed by
// standing() at read time and has no column to sort on (STAGE7, D-036). The set is bounded by what
// one person can hold. Every filter, sort and bucket for both routes is defined here, once.
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import * as s from '../db/schema';
import type { Db } from '../db/client';
import { standing } from '../core/rules';
import { daysBetween } from '../core/cycles/dates';
import { lastDay } from '../core/rules/standing';
import { standingContext } from './rulesets';
import { includesCI, listQuery, pageInMemory, type Dir } from './query';

export const STANDING_BUCKETS = ['overdue', 'at_risk', 'lapsed', 'compliant', 'untracked'] as const;
export const EXPIRY_BUCKETS = ['overdue', '30', '90', '180', '365', 'beyond', 'none'] as const;
export const PROGRESS_BUCKETS = ['none', 'under_half', 'over_half', 'met', 'surplus'] as const;
export type StandingBucket = (typeof STANDING_BUCKETS)[number];
export type ExpiryBucket = (typeof EXPIRY_BUCKETS)[number];
export type ProgressBucket = (typeof PROGRESS_BUCKETS)[number];

/** Days before a due date or cycle end at which an unmet requirement counts as at risk. */
export const AT_RISK_DAYS = 30;

const HELD_SORTS = ['name', 'expiry', 'progress', 'severity'] as const;
export const heldListQuery = (defaults: { sort: (typeof HELD_SORTS)[number]; dir: Dir }) =>
  listQuery(HELD_SORTS, defaults, {
    bodyId: z.string().max(100).optional(),
    standing: z.enum(STANDING_BUCKETS).optional(),
    expiry: z.enum(EXPIRY_BUCKETS).optional(),
    progress: z.enum(PROGRESS_BUCKETS).optional(),
    // `basic` skips computing standing, for pages that only need names and cycles.
    view: z.enum(['full', 'basic']).optional(),
  });
export type HeldListQuery = z.output<ReturnType<typeof heldListQuery>>;

type Cycle = typeof s.cycles.$inferSelect;
export interface StandingSummary {
  compliant: boolean;
  daysRemaining: number;
  totals: { accepted: number; submitted: number; claimed: number; planned: number };
  requiredX100: number;
  failing: { type: string; severity: 'hard' | 'soft'; overdue: boolean; due: string | null }[];
  projectedAtCycleEnd: string[];
}
export interface HeldSummary {
  held: typeof s.heldCertifications.$inferSelect;
  certification: typeof s.certifications.$inferSelect;
  body: typeof s.bodies.$inferSelect;
  cycles: Cycle[];
  cycle: Cycle | null;
  ruleVersion: typeof s.ruleVersions.$inferSelect | null;
  standing: StandingSummary | null;
  /** Derived for filtering and sorting; also sent so the interface never re-derives them. */
  derived: {
    /**
     * Signed days to the cycle's last day (`endsOn` is exclusive): 0 on that day, -1 the day after.
     * The interface prints this number, so sort order, filter and the words on the row agree.
     */
    daysToExpiry: number | null;
    expiry: ExpiryBucket;
    standing: StandingBucket | null;
    earnedX100: number | null;
    requiredX100: number | null;
    progress: ProgressBucket | null;
  };
}

// Higher is worse. Sorting by severity descending puts what needs action first.
const SEVERITY: Record<StandingBucket, number> = {
  overdue: 4,
  at_risk: 3,
  lapsed: 2,
  compliant: 1,
  untracked: 0,
};

export function expiryBucket(days: number | null): ExpiryBucket {
  if (days == null) return 'none';
  if (days < 0) return 'overdue';
  for (const b of [30, 90, 180, 365] as const) if (days <= b) return String(b) as ExpiryBucket;
  return 'beyond';
}

/** Expiry filters are cumulative: "within 90 days" includes what expires within 30. */
export function matchesExpiry(days: number | null, want: ExpiryBucket): boolean {
  if (want === 'none') return days == null;
  if (days == null) return false;
  if (want === 'overdue') return days < 0;
  if (want === 'beyond') return days > 365;
  return days >= 0 && days <= Number(want);
}

export function progressBucket(earned: number, required: number): ProgressBucket | null {
  if (required <= 0) return null;
  if (earned <= 0) return 'none';
  if (earned * 2 < required) return 'under_half';
  if (earned < required) return 'over_half';
  return earned === required ? 'met' : 'surplus';
}

/**
 * overdue   a hard requirement is past due (the engine's `compliant` is false), or the cycle has
 *           ended without a recorded renewal
 * at_risk   compliant, but a soft requirement is overdue, or something unmet is due within 30 days
 * lapsed    the certification or its latest cycle is marked lapsed
 * compliant everything else with an open cycle
 * untracked no open cycle: no CE requirement of its own, retired, or pursuing
 */
export function standingBucket(
  heldStatus: string,
  cycles: Cycle[],
  st: StandingSummary | null,
  asOf: string,
): StandingBucket {
  const open = cycles.find((c) => c.status === 'open');
  if (heldStatus === 'lapsed' || (!open && cycles.some((c) => c.status === 'lapsed')))
    return 'lapsed';
  if (!open || !st) return 'untracked';
  // A cycle past its end date is overdue for renewal even when every requirement is met: the issuer
  // has not been told, or the renewal was not recorded here. `daysRemaining` counts to the exclusive
  // end, so 0 is the first day after the cycle.
  if (!st.compliant || st.daysRemaining <= 0) return 'overdue';
  const earned = st.totals.accepted + st.totals.submitted + st.totals.claimed;
  const soon = (due: string | null) =>
    due != null && due >= asOf && daysBetween(asOf, due) <= AT_RISK_DAYS;
  if (
    st.failing.some((f) => f.overdue || soon(f.due)) ||
    (earned < st.requiredX100 && st.daysRemaining <= AT_RISK_DAYS)
  )
    return 'at_risk';
  return 'compliant';
}

export async function heldSummaries(
  db: Db,
  asOf: string,
  opts: { withStanding: boolean },
): Promise<HeldSummary[]> {
  const rows = await db
    .select({ held: s.heldCertifications, cert: s.certifications, body: s.bodies })
    .from(s.heldCertifications)
    .innerJoin(s.certifications, eq(s.certifications.id, s.heldCertifications.certificationId))
    .innerJoin(s.bodies, eq(s.bodies.id, s.certifications.bodyId))
    .all();
  const cycles = await db.select().from(s.cycles).all();
  const versions = await db.select().from(s.ruleVersions).all();
  const out: HeldSummary[] = [];
  for (const r of rows) {
    const mine = cycles.filter((cy) => cy.heldCertId === r.held.id);
    const open = mine.find((cy) => cy.status === 'open') ?? null;
    let st: StandingSummary | null = null;
    if (open && opts.withStanding) {
      const ctx = await standingContext(db, open, asOf);
      if (ctx) {
        const full = standing(open, ctx);
        st = {
          compliant: full.compliant,
          daysRemaining: full.daysRemaining,
          totals: full.totals,
          requiredX100: full.requiredX100,
          failing: full.constraints
            .filter((x) => !x.satisfied)
            .map((x) => ({ type: x.type, severity: x.severity, overdue: x.overdue, due: x.due })),
          projectedAtCycleEnd: full.projectedAtCycleEnd,
        };
      }
    }
    const daysToExpiry = open ? daysBetween(asOf, lastDay(open.endsOn)) : null;
    const earned = st ? st.totals.accepted + st.totals.submitted + st.totals.claimed : null;
    out.push({
      held: r.held,
      certification: r.cert,
      body: r.body,
      cycles: mine,
      cycle: open,
      ruleVersion: open ? (versions.find((v) => v.id === open.ruleVersionId) ?? null) : null,
      standing: st,
      derived: {
        daysToExpiry,
        expiry: expiryBucket(daysToExpiry),
        standing: opts.withStanding ? standingBucket(r.held.status, mine, st, asOf) : null,
        earnedX100: earned,
        requiredX100: st?.requiredX100 ?? null,
        progress: st && earned != null ? progressBucket(earned, st.requiredX100) : null,
      },
    });
  }
  return out;
}

/** Standing is computed unless the caller asked for `view=basic` and nothing in the query needs it. */
export const needsStanding = (p: HeldListQuery) =>
  p.view !== 'basic' ||
  Boolean(p.standing || p.progress || p.sort === 'progress' || p.sort === 'severity');

const nameKey = (x: HeldSummary) =>
  `${x.certification.abbreviation} ${x.certification.name}`.toLowerCase();

/** Nulls sort last in both directions: a row without the value is never "first". */
function compareNullable(a: number | null, b: number | null, dir: Dir): number {
  if (a == null || b == null) return a == null ? (b == null ? 0 : 1) : -1;
  return dir === 'asc' ? a - b : b - a;
}

export function filterSortPage(all: HeldSummary[], p: HeldListQuery) {
  const rows = all.filter(
    (x) =>
      (!p.q ||
        includesCI(
          [x.certification.abbreviation, x.certification.name, x.body.name, x.held.certNumber],
          p.q,
        )) &&
      (!p.bodyId || x.body.id === p.bodyId) &&
      (!p.standing || x.derived.standing === p.standing) &&
      (!p.expiry || matchesExpiry(x.derived.daysToExpiry, p.expiry)) &&
      (!p.progress || x.derived.progress === p.progress),
  );
  const ratio = (x: HeldSummary) =>
    x.standing && x.standing.requiredX100 > 0 && x.derived.earnedX100 != null
      ? x.derived.earnedX100 / x.standing.requiredX100
      : null;
  const sign = p.dir === 'asc' ? 1 : -1;
  const primaryOf = (a: HeldSummary, b: HeldSummary) => {
    if (p.sort === 'name') return sign * nameKey(a).localeCompare(nameKey(b));
    if (p.sort === 'expiry')
      return compareNullable(a.derived.daysToExpiry, b.derived.daysToExpiry, p.dir);
    if (p.sort === 'progress') return compareNullable(ratio(a), ratio(b), p.dir);
    return (
      sign *
      (SEVERITY[a.derived.standing ?? 'untracked'] - SEVERITY[b.derived.standing ?? 'untracked'])
    );
  };
  rows.sort((a, b) => {
    const primary = primaryOf(a, b);
    // Ties fall back to soonest expiry, then name, then id, so page boundaries never shift.
    return (
      primary ||
      compareNullable(a.derived.daysToExpiry, b.derived.daysToExpiry, 'asc') ||
      nameKey(a).localeCompare(nameKey(b)) ||
      (a.held.id < b.held.id ? -1 : a.held.id > b.held.id ? 1 : 0)
    );
  });
  return pageInMemory(rows, p);
}

/** Count per standing bucket over the whole set, before filters, for the dashboard's summary. */
export function standingCounts(all: HeldSummary[]): Record<StandingBucket, number> {
  const counts = Object.fromEntries(STANDING_BUCKETS.map((b) => [b, 0])) as Record<
    StandingBucket,
    number
  >;
  for (const x of all) if (x.derived.standing) counts[x.derived.standing]++;
  return counts;
}
