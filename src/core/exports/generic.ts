import type { Builder } from './types';
import { credits, csv, hours } from './csv';
import { evidenceSection, readme } from './manifest';

export const generic: Builder = (input) => {
  const rows: (string | number | null)[][] = [
    [
      'certification',
      'activity_type',
      'issuer_label',
      'title',
      'provider',
      'date',
      'hours',
      'credits',
      'category',
      'description',
      'status',
      'issuer_reference',
      'evidence_files',
    ],
  ];
  for (const a of input.applications)
    rows.push([
      input.abbreviation,
      a.activityType,
      a.bodyLabel,
      a.title,
      a.provider,
      a.occurredOn,
      hours(a.durationMinutes),
      credits(a.creditsX100),
      a.categoryKey,
      a.description,
      a.status,
      a.issuerReference,
      a.evidence.map((e) => e.filename).join('; '),
    ]);
  const { manifest, evidence } = evidenceSection(input);
  return {
    files: [
      {
        name: `${input.bodyId}-${input.abbreviation.toLowerCase()}-cycle-${input.cycle.sequence}.csv`,
        content: csv(rows),
      },
      { name: 'evidence-manifest.csv', content: manifest },
      {
        name: 'README.txt',
        content: readme(input, 'Generic format: this body has no dedicated export layout yet.'),
      },
    ],
    evidence,
  };
};
