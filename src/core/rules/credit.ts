import type { Activity, CreditingRule, CreditsX100 } from '../domain/types';

/**
 * Credits a single rule yields for an activity, before cycle/year/category caps (those live in resolve()).
 * All arithmetic in integer hundredths. Returns null when the activity lacks the input the basis needs.
 */
export function credit(rule: CreditingRule, activity: Activity): CreditsX100 | null {
  let raw: number;
  switch (rule.basis) {
    case 'per_minutes': {
      if (activity.durationMinutes == null || !rule.minutesPerCredit) return null;
      raw = round((activity.durationMinutes * 100) / rule.minutesPerCredit, rule.rounding);
      break;
    }
    case 'per_item': {
      if (rule.creditsPerItemX100 == null) return null;
      raw = (activity.itemCount ?? 1) * rule.creditsPerItemX100;
      break;
    }
    case 'fixed': {
      if (rule.creditsPerItemX100 == null) return null;
      raw = rule.creditsPerItemX100;
      break;
    }
  }
  if (rule.capPerItemX100 != null) raw = Math.min(raw, rule.capPerItemX100);
  return raw;
}

/** rawX100 is a possibly fractional number of hundredths; returns an integer number of hundredths. */
export function round(rawX100: number, mode: CreditingRule['rounding']): CreditsX100 {
  switch (mode) {
    case 'floor_quarter':
      return Math.floor(rawX100 / 25) * 25;
    case 'floor_half':
      return Math.floor(rawX100 / 50) * 50;
    case 'floor_whole':
      return Math.floor(rawX100 / 100) * 100;
    case 'nearest_quarter':
      return Math.round(rawX100 / 25) * 25;
    case 'exact':
      return Math.round(rawX100);
  }
}
