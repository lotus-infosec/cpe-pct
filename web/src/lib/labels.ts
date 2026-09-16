// Display wording for server-side buckets and statuses. One place, so a filter option, a chip and a
// badge never disagree about what a state is called.
import type { Tone } from '@/components/ui';
import type { ExpiryBucket, ProgressBucket, StandingBucket } from './types';

export const STANDING: Record<StandingBucket, { label: string; tone: Tone }> = {
  overdue: { label: 'Overdue', tone: 'bad' },
  at_risk: { label: 'At risk', tone: 'warn' },
  lapsed: { label: 'Lapsed', tone: 'bad' },
  compliant: { label: 'Good standing', tone: 'ok' },
  untracked: { label: 'No cycle', tone: 'muted' },
};

export const EXPIRY: Record<ExpiryBucket, string> = {
  overdue: 'Past cycle end',
  '30': 'Within 30 days',
  '90': 'Within 90 days',
  '180': 'Within 180 days',
  '365': 'Within a year',
  beyond: 'More than a year',
  none: 'No expiry',
};

export const PROGRESS: Record<ProgressBucket, string> = {
  none: 'No credits yet',
  under_half: 'Under half',
  over_half: 'Half or more',
  met: 'Requirement met',
  surplus: 'Met, with surplus',
};

export const APPLICATION_STATUS = {
  planned: { label: 'Planned', tone: 'muted' },
  claimed: { label: 'Claimed', tone: 'muted' },
  submitted: { label: 'Submitted', tone: 'warn' },
  accepted: { label: 'Accepted', tone: 'ok' },
  rejected: { label: 'Rejected', tone: 'bad' },
} as const satisfies Record<string, { label: string; tone: Tone }>;

export const EXTRACTION_STATUS = {
  done: { label: 'Text extracted', tone: 'ok' },
  pending: { label: 'Extraction queued', tone: 'warn' },
  no_text: { label: 'No text layer', tone: 'muted' },
  manual: { label: 'Image, enter by hand', tone: 'muted' },
  failed: { label: 'Extraction failed', tone: 'bad' },
} as const satisfies Record<string, { label: string; tone: Tone }>;

export const options = <K extends string>(rec: Record<K, string | { label: string }>) =>
  (Object.entries(rec) as [K, string | { label: string }][]).map(([value, v]) => ({
    value,
    label: typeof v === 'string' ? v : v.label,
  }));
