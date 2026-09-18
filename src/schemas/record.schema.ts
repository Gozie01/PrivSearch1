// ─────────────────────────────────────────────────────────────
// MedicalRecord schema — lab results, prescriptions, imaging, etc.
// ─────────────────────────────────────────────────────────────
import type { SystemFields } from './patient.schema';

export type RecordType =
  | 'LAB_RESULT'
  | 'PRESCRIPTION'
  | 'DIAGNOSIS'
  | 'IMAGING'
  | 'NOTES'
  | 'PROCEDURE'
  | 'VACCINATION'
  | 'REFERRAL';

export type ConfidentialityLevel =
  | 'PUBLIC'
  | 'RESTRICTED'
  | 'CONFIDENTIAL'
  | 'TOP_SECRET';

export interface MedicalRecord extends Partial<SystemFields> {
  recordType: RecordType;
  /** Foreign key → PatientRecord.patientId */
  patientId: string;
  /** DID of the author (physician, nurse, system agent) */
  authorDID: string;
  facilityId?: string;
  title: string;
  /** [ENC] Structured clinical content — schema varies by recordType */
  content: Record<string, unknown>;
  /** SHA-256 hashes of attached files (stored in MinIO) */
  attachments?: string[];
  /** ISO 8601 date of the clinical event */
  date: string;
  tags?: string[];
  confidentialityLevel: ConfidentialityLevel;
  metadata?: Record<string, unknown>;
}

/** Fields the caller MUST supply */
export const RECORD_REQUIRED_FIELDS: (keyof MedicalRecord)[] = [
  'recordType',
  'patientId',
  'authorDID',
  'title',
  'date',
  'confidentialityLevel',
];

/** Fields encrypted at rest */
export const RECORD_ENCRYPTED_FIELDS: (keyof MedicalRecord)[] = ['content'];

/** Minimum data-retention period (years) per record type.
 *  Records not listed here fall back to the global patient minimum (10 years). */
export const RETENTION_YEARS: Partial<Record<RecordType, number>> = {
  LAB_RESULT: 7,
  PRESCRIPTION: 10,
  DIAGNOSIS: 10,
  IMAGING: 10,
  PROCEDURE: 10,
  VACCINATION: 10,
  NOTES: 7,
  REFERRAL: 7,
};
