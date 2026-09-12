import type { ExportBundle, ExportInput } from './types';
import { csv, safeName } from './csv';

/** Evidence manifest + zip paths shared by every body builder. */
export function evidenceSection(input: ExportInput): {
  manifest: string;
  evidence: ExportBundle['evidence'];
} {
  const rows: (string | number)[][] = [
    ['activity_date', 'activity_title', 'file', 'sha256', 'size_bytes', 'content_type'],
  ];
  const evidence: ExportBundle['evidence'] = [];
  const seen = new Set<string>();
  for (const a of input.applications) {
    for (const e of a.evidence) {
      const zipPath = `evidence/${a.occurredOn}_${safeName(a.title)}/${safeName(e.filename)}`;
      rows.push([a.occurredOn, a.title, zipPath, e.sha256, e.sizeBytes, e.contentType]);
      if (!seen.has(e.sha256 + zipPath)) {
        seen.add(e.sha256 + zipPath);
        evidence.push({
          objectKey: e.objectKey,
          zipPath,
          sha256: e.sha256,
          sizeBytes: e.sizeBytes,
        });
      }
    }
  }
  return { manifest: csv(rows), evidence };
}

export function readme(input: ExportInput, bodyNotes: string): string {
  return (
    [
      `CPE PCT export — ${input.abbreviation} (${input.bodyName})`,
      `Generated ${input.generatedAt}`,
      `Cycle ${input.cycle.sequence}: ${input.cycle.startsOn} → ${input.cycle.endsOn} (rules ${input.cycle.ruleVersionId})`,
      `Applications: ${input.applications.length}`,
      '',
      bodyNotes,
      '',
      'This bundle is for your own records and for entering activities into the issuer portal by hand.',
      "CPE PCT never submits anything to an issuer. The issuer's current policy governs.",
    ].join('\n') + '\n'
  );
}
