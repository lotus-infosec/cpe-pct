// Export contracts. Builders are pure: they take the loaded cycle data and return files as strings.
// The build_export job adds evidence bytes from the ObjectStore and zips everything.
import type { ActivityType } from '../domain/activity-types';
import type { ApplicationStatus, CreditsX100, IsoDate } from '../domain/types';

export interface ExportApplication {
  activityId: string;
  title: string;
  activityType: ActivityType;
  occurredOn: IsoDate;
  provider: string | null;
  description: string | null;
  durationMinutes: number | null;
  itemCount: number | null;
  creditsX100: CreditsX100;
  categoryKey: string | null;
  bodyLabel: string | null; // the issuer's own name for the activity type (from the crediting rule)
  status: ApplicationStatus;
  issuerReference: string | null;
  evidence: {
    evidenceId: string;
    filename: string;
    sha256: string;
    objectKey: string;
    contentType: string;
    sizeBytes: number;
  }[];
}

export interface ExportInput {
  bodyId: string;
  bodyName: string;
  certificationId: string;
  certificationName: string;
  abbreviation: string;
  creditUnitLabel: string;
  certNumber: string | null;
  memberNumber: string | null;
  cycle: {
    id: string;
    sequence: number;
    startsOn: IsoDate;
    endsOn: IsoDate;
    ruleVersionId: string;
  };
  requiredX100: CreditsX100;
  applications: ExportApplication[];
  generatedAt: string; // ISO datetime
}

export interface ExportFile {
  name: string;
  content: string; // UTF-8 text
}

export interface ExportBundle {
  files: ExportFile[];
  /** Evidence to include, with the path inside the zip. */
  evidence: { objectKey: string; zipPath: string; sha256: string; sizeBytes: number }[];
}

export type Builder = (input: ExportInput) => ExportBundle;
