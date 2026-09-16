import { describe, expect, it } from 'vitest';
import { builders, generic, selectionBundle, type ExportInput } from '../../src/core/exports';
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

describe('selection bundle', () => {
  const ev = {
    evidenceId: 'e1',
    filename: 'cert "final".pdf',
    sha256: 'a'.repeat(64),
    objectKey: 'evidence/e1',
    contentType: 'application/pdf',
    sizeBytes: 10,
  };
  const b = selectionBundle({
    generatedAt: '2026-09-16T00:00:00Z',
    activities: [
      {
        id: 'b',
        title: 'Later, with a comma',
        activityType: 'read_book',
        occurredOn: '2026-03-01',
        provider: null,
        description: null,
        durationMinutes: 90,
        itemCount: 1,
        status: 'logged',
        applications: [
          {
            certification: 'CISSP',
            bodyName: 'ISC2',
            cycleSequence: 1,
            creditsX100: 150,
            categoryKey: 'A',
            status: 'accepted',
            issuerReference: 'TEST-REF',
          },
          {
            certification: 'CC',
            bodyName: 'ISC2',
            cycleSequence: 2,
            creditsX100: 100,
            categoryKey: null,
            status: 'claimed',
            issuerReference: null,
          },
        ],
        evidence: [ev],
      },
      {
        id: 'a',
        title: 'Earlier',
        activityType: 'attend_webinar',
        occurredOn: '2026-01-01',
        provider: 'Synthetic',
        description: null,
        durationMinutes: null,
        itemCount: null,
        status: 'draft',
        applications: [],
        evidence: [ev],
      },
    ],
  });
  const file = (name: string) => b.files.find((f) => f.name === name)!.content;

  it('writes one activity row each, date order, with quoting', () => {
    const lines = file('activities.csv').replace('\uFEFF', '').trim().split('\r\n');
    expect(lines).toHaveLength(3);
    expect(lines[1]).toMatch(/^a,2026-01-01,Earlier,/);
    expect(lines[2]).toContain('"Later, with a comma"');
    expect(lines[2]).toContain('CISSP 1.5; CC 1');
    expect(lines[2]).toContain(',1.5,');
  });
  it('writes one row per credit application', () => {
    expect(file('credit-applications.csv').trim().split('\r\n')).toHaveLength(3);
    expect(file('credit-applications.csv')).toContain('TEST-REF');
  });
  it('places shared evidence under each activity once', () => {
    expect(b.evidence.map((e) => e.zipPath)).toEqual([
      'evidence/2026-01-01_Earlier/cert_final_.pdf',
      'evidence/2026-03-01_Later_with_a_comma/cert_final_.pdf',
    ]);
    expect(file('README.txt')).toContain('Activities: 2');
  });
});
