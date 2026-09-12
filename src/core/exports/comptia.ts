// CompTIA export: one CSV row per credit application in the order the "Add CEUs" form asks for the
// data (docs/export-formats.md, VERIFY B2 "CE worksheet field order"), plus evidence manifest and README.
import type { Builder } from './types';
import { credits, csv, hours } from './csv';
import { evidenceSection, readme } from './manifest';

export const COMPTIA_COLUMNS = [
  'certification',
  'activity_group',
  'activity',
  'training_provider',
  'activity_title',
  'completion_date',
  'hours',
  'ceus',
  'description',
  'status_in_tracker',
  'issuer_reference',
  'evidence_files',
] as const;

const GROUP: Record<string, string> = {
  attend_training: 'Training and higher education',
  attend_webinar: 'Training and higher education',
  attend_conference: 'Training and higher education',
  higher_education: 'Training and higher education',
  mentor: 'IT industry participation',
  deliver_training: 'IT industry participation',
  develop_content: 'IT industry participation',
  publish_article: 'Publishing',
  publish_book: 'Publishing',
  earn_certification: 'Additional certifications',
};

export const comptia: Builder = (input) => {
  const rows: (string | number | null)[][] = [[...COMPTIA_COLUMNS]];
  for (const a of input.applications) {
    rows.push([
      input.abbreviation,
      GROUP[a.activityType] ?? 'Other',
      a.bodyLabel ?? a.activityType,
      a.provider,
      a.title,
      a.occurredOn,
      hours(a.durationMinutes),
      credits(a.creditsX100),
      a.description,
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
        name: `comptia-${input.abbreviation.toLowerCase().replace('+', '-plus')}-cycle-${input.cycle.sequence}.csv`,
        content: csv(rows),
      },
      { name: 'evidence-manifest.csv', content: manifest },
      {
        name: 'README.txt',
        content: readme(
          input,
          [
            `Total CEUs in this bundle: ${credits(total)} of ${credits(input.requiredX100)} required.`,
            'Certification account → Continuing Education → Add CEUs: pick the Activity Group and Activity, then enter',
            'the provider (for training and webinars), the CEUs, and upload the documentation (up to 5 files, 1 MB total).',
            'Evidence files here may exceed that cap; compress or trim before uploading.',
          ].join('\n'),
        ),
      },
    ],
    evidence,
  };
};
