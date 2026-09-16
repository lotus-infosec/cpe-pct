// Selection bundle: the activities someone is about to delete, with every credit application they
// carried and their evidence files, in a form that can be read without this app.
import type { ExportBundle, SelectionInput } from './types';
import { credits, csv, hours, safeName } from './csv';

export function selectionBundle(input: SelectionInput): ExportBundle {
  const acts = [...input.activities].sort(
    (a, b) => a.occurredOn.localeCompare(b.occurredOn) || a.title.localeCompare(b.title),
  );
  const activityRows: (string | number | null)[][] = [
    [
      'activity_id',
      'date',
      'title',
      'activity_type',
      'provider',
      'hours',
      'item_count',
      'status',
      'description',
      'credits_applied',
      'evidence_files',
    ],
  ];
  const applicationRows: (string | number | null)[][] = [
    [
      'activity_id',
      'date',
      'title',
      'certification',
      'body',
      'cycle',
      'credits',
      'category',
      'status',
      'issuer_reference',
    ],
  ];
  const manifestRows: (string | number)[][] = [
    ['activity_date', 'activity_title', 'file', 'sha256', 'size_bytes', 'content_type'],
  ];
  const evidence: ExportBundle['evidence'] = [];
  const seen = new Set<string>();

  for (const a of acts) {
    activityRows.push([
      a.id,
      a.occurredOn,
      a.title,
      a.activityType,
      a.provider,
      hours(a.durationMinutes),
      a.itemCount,
      a.status,
      a.description,
      a.applications.map((x) => `${x.certification} ${credits(x.creditsX100)}`).join('; '),
      a.evidence.map((e) => e.filename).join('; '),
    ]);
    for (const x of a.applications)
      applicationRows.push([
        a.id,
        a.occurredOn,
        a.title,
        x.certification,
        x.bodyName,
        x.cycleSequence,
        credits(x.creditsX100),
        x.categoryKey,
        x.status,
        x.issuerReference,
      ]);
    for (const e of a.evidence) {
      const zipPath = `evidence/${a.occurredOn}_${safeName(a.title)}/${safeName(e.filename)}`;
      manifestRows.push([a.occurredOn, a.title, zipPath, e.sha256, e.sizeBytes, e.contentType]);
      if (!seen.has(zipPath)) {
        seen.add(zipPath);
        evidence.push({
          objectKey: e.objectKey,
          zipPath,
          sha256: e.sha256,
          sizeBytes: e.sizeBytes,
        });
      }
    }
  }

  const applications = applicationRows.length - 1;
  return {
    files: [
      { name: 'activities.csv', content: csv(activityRows) },
      { name: 'credit-applications.csv', content: csv(applicationRows) },
      { name: 'evidence-manifest.csv', content: csv(manifestRows) },
      {
        name: 'README.txt',
        content:
          [
            'CPE PCT selection export',
            `Generated ${input.generatedAt}`,
            `Activities: ${acts.length}`,
            `Credit applications: ${applications}`,
            `Evidence files: ${evidence.length}`,
            '',
            'A record of activities selected for deletion, taken before they were deleted.',
            'activities.csv has one row per activity; credit-applications.csv has one row per',
            'certification each activity counted toward. Evidence files are under evidence/.',
          ].join('\n') + '\n',
      },
    ],
    evidence,
  };
}
