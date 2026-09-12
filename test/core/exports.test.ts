import { describe, expect, it } from 'vitest';
import { builders, generic, type ExportInput } from '../../src/core/exports';
import { COMPTIA_COLUMNS } from '../../src/core/exports/comptia';
import { ISC2_COLUMNS } from '../../src/core/exports/isc2';

const input: ExportInput = {
  bodyId: 'isc2',
  bodyName: 'ISC2',
  certificationId: 'isc2/cissp',
  certificationName: 'CISSP',
  abbreviation: 'CISSP',
  creditUnitLabel: 'CPE',
  certNumber: 'TEST-1',
  memberNumber: 'TEST-M',
  cycle: {
    id: 'cy',
    sequence: 1,
    startsOn: '2025-05-01',
    endsOn: '2028-05-01',
    ruleVersionId: 'isc2@1',
  },
  requiredX100: 12000,
  generatedAt: '2026-09-12T00:00:00Z',
  applications: [
    {
      activityId: 'a1',
      title: 'Talk, "quoted"',
      activityType: 'attend_conference',
      occurredOn: '2026-06-10',
      provider: 'BSides',
      description: 'notes',
      durationMinutes: 200,
      itemCount: 1,
      creditsX100: 325,
      categoryKey: 'A',
      bodyLabel: 'Industry conference',
      status: 'accepted',
      issuerReference: 'REF-1',
      evidence: [
        {
          evidenceId: 'e1',
          filename: 'cert.pdf',
          sha256: 'ab'.repeat(32),
          objectKey: 'evidence/ab/ab/' + 'ab'.repeat(32),
          contentType: 'application/pdf',
          sizeBytes: 954,
        },
      ],
    },
    {
      activityId: 'a2',
      title: 'Book',
      activityType: 'read_book',
      occurredOn: '2026-07-01',
      provider: null,
      description: null,
      durationMinutes: null,
      itemCount: 1,
      creditsX100: 500,
      categoryKey: 'A',
      bodyLabel: 'Self-directed learning: books',
      status: 'claimed',
      issuerReference: null,
      evidence: [],
    },
  ],
};

describe('export builders', () => {
  it('ISC2: header row is the recorded portal order; values are RFC 4180 quoted', () => {
    const b = builders['isc2']!(input);
    const csvFile = b.files.find((f) => f.name.endsWith('.csv') && !f.name.startsWith('evidence'))!;
    const lines = csvFile.content.replace(/^\uFEFF/, '').split('\r\n');
    expect(lines[0]).toBe(ISC2_COLUMNS.join(','));
    expect(lines[1]).toContain('"Talk, ""quoted"""');
    expect(lines[1]).toContain('Group A,Industry conference');
    expect(lines[1]).toContain(',3.25,');
    expect(lines[2]).toContain(',5,');
    expect(b.evidence).toEqual([
      {
        objectKey: input.applications[0]!.evidence[0]!.objectKey,
        zipPath: 'evidence/2026-06-10_Talk_quoted/cert.pdf',
        sha256: 'ab'.repeat(32),
        sizeBytes: 954,
      },
    ]);
    expect(b.files.map((f) => f.name)).toEqual([
      'isc2-cissp-cycle-1.csv',
      'evidence-manifest.csv',
      'README.txt',
    ]);
    expect(b.files[2]!.content).toContain('never submits');
  });
  it('CompTIA: header row is the recorded Add-CEUs order; hours derived from minutes', () => {
    const b = builders['comptia']!({
      ...input,
      bodyId: 'comptia',
      bodyName: 'CompTIA',
      abbreviation: 'Security+',
    });
    const lines = b.files[0]!.content.replace(/^\uFEFF/, '').split('\r\n');
    expect(lines[0]).toBe(COMPTIA_COLUMNS.join(','));
    expect(lines[1]).toContain('Training and higher education,Industry conference,BSides');
    expect(lines[1]).toContain(',3.33,3.25,');
    expect(b.files[0]!.name).toBe('comptia-security-plus-cycle-1.csv');
  });
  it('generic builder covers unknown bodies', () => {
    const b = generic({ ...input, bodyId: 'x', abbreviation: 'X' });
    expect(b.files[0]!.name).toBe('x-x-cycle-1.csv');
  });
});
