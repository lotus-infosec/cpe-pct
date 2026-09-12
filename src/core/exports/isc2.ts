// ISC2 export: one CSV row per credit application in the order the CPE portal asks for the data
// (docs/export-formats.md, VERIFY B1 "CPE portal field order"), plus evidence manifest and README.
import type { Builder } from './types';
import { credits, csv, hours } from './csv';
import { evidenceSection, readme } from './manifest';

export const ISC2_COLUMNS = [
  'certification',
  'cpe_group',
  'activity_category',
  'activity_title',
  'provider',
  'start_date',
  'completion_date',
  'cpe_credits',
  'description',
  'status_in_tracker',
  'issuer_reference',
  'evidence_files',
] as const;

export const isc2: Builder = (input) => {
  const rows: (string | number | null)[][] = [[...ISC2_COLUMNS]];
  for (const a of input.applications) {
    rows.push([
      input.abbreviation,
      a.categoryKey ? `Group ${a.categoryKey}` : '',
      a.bodyLabel ?? a.activityType,
      a.title,
      a.provider,
      a.occurredOn,
      a.occurredOn,
      credits(a.creditsX100),
      [a.description, a.durationMinutes != null ? `${hours(a.durationMinutes)} h` : null]
        .filter(Boolean)
        .join(' — '),
      a.status,
      a.issuerReference,
      a.evidence.map((e) => e.filename).join('; '),
    ]);
  }
  const { manifest, evidence } = evidenceSection(input);
  const total = input.applications.reduce((n, a) => n + a.creditsX100, 0);
  return {
    files: [
      {
        name: `isc2-${input.abbreviation.toLowerCase()}-cycle-${input.cycle.sequence}.csv`,
        content: csv(rows),
      },
      { name: 'evidence-manifest.csv', content: manifest },
      {
        name: 'README.txt',
        content: readme(
          input,
          [
            `Total credits in this bundle: ${credits(total)} of ${credits(input.requiredX100)} ${input.creditUnitLabel} required.`,
            'CPE portal: one entry per row. Group A entries require selecting the relevant domain(s) in the portal;',
            'the tracker does not store domains. Dates: the completion date decides the cycle.',
            "Statuses are the tracker's own (claimed / submitted / accepted / rejected), not the portal's.",
          ].join('\n'),
        ),
      },
    ],
    evidence,
  };
};
