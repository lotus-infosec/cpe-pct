// intake.draft: extracted text → draft activity fields. Heuristic and conservative: a field is filled
// only when one clear candidate exists; otherwise it stays undefined and the user types it.
// This is the seam for a model-backed Drafter later; the signature does not change.
import type { ActivityType } from '../domain/activity-types';

export interface Draft {
  title?: string;
  occurredOn?: string; // YYYY-MM-DD
  provider?: string;
  durationMinutes?: number;
  activityType?: ActivityType;
  creditsHint?: number; // credits the document itself claims, for the user's eyes only
  /** Which fields came from extraction, for the UI's draft indicator. */
  from: Record<string, 'extracted'>;
}

const MONTHS = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
];
const pad = (n: number) => String(n).padStart(2, '0');

export function draft(text: string): Draft {
  const t = text.replace(/\s+/g, ' ').trim();
  const out: Draft = { from: {} };
  const set = <K extends keyof Omit<Draft, 'from'>>(k: K, v: Draft[K] | undefined) => {
    if (v !== undefined) {
      out[k] = v;
      out.from[k] = 'extracted';
    }
  };

  set('occurredOn', findDate(t));
  set('durationMinutes', findDuration(t));
  set(
    'provider',
    findLabeled(t, [
      'provider',
      'presented by',
      'issued by',
      'organizer',
      'organiser',
      'offered by',
      'hosted by',
    ]),
  );
  set('title', findTitle(t));
  set('creditsHint', findCredits(t));
  set('activityType', findType(t));
  return out;
}

function findDate(t: string): string | undefined {
  const found: string[] = [];
  // ISO
  for (const m of t.matchAll(/\b(20\d{2})-(\d{2})-(\d{2})\b/g))
    found.push(`${m[1]}-${m[2]}-${m[3]}`);
  // "March 14, 2026" / "14 March 2026"
  for (const m of t.matchAll(/\b([A-Za-z]{3,9})\.? (\d{1,2}),? (20\d{2})\b/g)) {
    const mo = MONTHS.findIndex((x) => x.startsWith(m[1]!.toLowerCase().slice(0, 3)));
    if (mo >= 0) found.push(`${m[3]}-${pad(mo + 1)}-${pad(Number(m[2]))}`);
  }
  for (const m of t.matchAll(/\b(\d{1,2}) ([A-Za-z]{3,9}),? (20\d{2})\b/g)) {
    const mo = MONTHS.findIndex((x) => x.startsWith(m[2]!.toLowerCase().slice(0, 3)));
    if (mo >= 0) found.push(`${m[3]}-${pad(mo + 1)}-${pad(Number(m[1]))}`);
  }
  // US numeric MM/DD/YYYY only (ambiguous forms are skipped on purpose)
  for (const m of t.matchAll(/\b(\d{1,2})\/(\d{1,2})\/(20\d{2})\b/g))
    if (Number(m[1]) <= 12 && Number(m[2]) <= 31 && Number(m[2]) > 12)
      found.push(`${m[3]}-${pad(Number(m[1]))}-${pad(Number(m[2]))}`);
  const uniq = [...new Set(found)];
  // Prefer a labelled completion date; otherwise accept only when exactly one date appears.
  const labelled = t.match(
    /(?:completed on|completion date|date of completion|date)[:\s]+([A-Za-z]{3,9}\.? \d{1,2},? 20\d{2}|\d{1,2} [A-Za-z]{3,9},? 20\d{2}|20\d{2}-\d{2}-\d{2})/i,
  );
  if (labelled) {
    const d = findDate(labelled[1]!);
    if (d) return d;
  }
  return uniq.length === 1 ? uniq[0] : undefined;
}

function findDuration(t: string): number | undefined {
  const hm = t.match(
    /\b(\d{1,3})\s*(?:h|hr|hrs|hours?)\s*(?:and\s*)?(\d{1,2})\s*(?:m|min|mins|minutes?)\b/i,
  );
  if (hm) return Number(hm[1]) * 60 + Number(hm[2]);
  const h = t.match(/\b(\d{1,3}(?:\.\d{1,2})?)\s*(?:h|hr|hrs|hours?)\b/i);
  if (h) return Math.round(Number(h[1]) * 60);
  const m = t.match(/\b(\d{1,4})\s*(?:min|mins|minutes?)\b/i);
  if (m) return Number(m[1]);
  return undefined;
}

function findLabeled(t: string, labels: string[]): string | undefined {
  for (const l of labels) {
    const m = t.match(
      new RegExp(
        `\\b${l}[:\\s]+([A-Z][^.:;|]{2,60}?)(?=\\s(?:Date|Duration|Credits?|Completed|CPE|CEU|Hours?)\\b|[.:;|]|$)`,
        'i',
      ),
    );
    if (m) return m[1]!.trim();
  }
  return undefined;
}

function findTitle(t: string): string | undefined {
  const m = t.match(
    /(?:successfully completed|has completed|completed the course|completed (?!on\b)|completion of|for completing|course[:\s]+|title[:\s]+)\s*([A-Z][^.:;|]{3,80}?)(?=\s(?:Provider|Date|Duration|Credits?|Completed|CPE|CEU|on \d)\b|[.:;|]|$)/i,
  );
  return m ? m[1]!.trim() : undefined;
}

function findCredits(t: string): number | undefined {
  const m = t.match(/\b(\d{1,3}(?:\.\d{1,2})?)\s*(?:CPEs?|CEUs?|PDUs?|credits?)\b/i);
  return m ? Number(m[1]) : undefined;
}

function findType(t: string): ActivityType | undefined {
  const l = t.toLowerCase();
  if (/\bwebinar\b|\bpodcast\b/.test(l)) return 'attend_webinar';
  if (/\bconference\b|\bsummit\b|\bsymposium\b/.test(l)) return 'attend_conference';
  if (/\bcourse\b|\btraining\b|\bclass\b|\bworkshop\b/.test(l)) return 'attend_training';
  return undefined;
}
