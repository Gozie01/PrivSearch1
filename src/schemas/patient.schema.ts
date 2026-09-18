// ─────────────────────────────────────────────────────────────
// PatientRecord schema
//
// Fields marked [ENC] are encrypted with AES-256-GCM before
// being written to MongoDB. Only the SHA-256 hash of the
// cleartext goes on-chain.
// ─────────────────────────────────────────────────────────────

export type BloodType = 'A+' | 'A-' | 'B+' | 'B-' | 'AB+' | 'AB-' | 'O+' | 'O-';

export type Gender =
  | 'MALE'
  | 'FEMALE'
  | 'NON_BINARY'
  | 'OTHER'
  | 'PREFER_NOT_TO_SAY';

export interface EmergencyContact {
  name: string;
  phone: string;
  relationship: string;
}

// ── System fields present on every stored document ───────────

export interface SystemFields {
  _id: string;
  /** Monotonically increasing counter — starts at 1, bumped on every UPDATE */
  _version: number;
  /** SHA-256 of document content (excluding system metadata fields) */
  _contentHash: string;
  _createdAt: Date;
  _updatedAt: Date;
  /** Set to a Date on soft-delete; null while active */
  _deletedAt: Date | null;
  /** DID of actor who performed the soft-delete */
  _deletedBy: string | null;
  _isDeleted: boolean;
}

// ── Patient record ────────────────────────────────────────────

export interface PatientRecord extends Partial<SystemFields> {
  /** Stable external identifier — DID or UUID assigned at admission */
  patientId: string;
  /** [ENC] */
  firstName: string;
  /** [ENC] */
  lastName: string;
  /** [ENC] ISO 8601 date string */
  dateOfBirth: string;
  gender: Gender;
  /** [ENC] */
  bloodType?: BloodType;
  /** [ENC] */
  allergies?: string[];
  /** [ENC] */
  emergencyContact?: EmergencyContact;
  primaryPhysicianDID?: string;
  facilityIds?: string[];
  /** [ENC] */
  insuranceInfo?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

/** Fields the caller MUST supply when creating a new patient */
export const PATIENT_REQUIRED_FIELDS: (keyof PatientRecord)[] = [
  'patientId',
  'firstName',
  'lastName',
  'dateOfBirth',
  'gender',
];

/** Fields encrypted at rest; stored as EncryptedField objects in MongoDB */
export const PATIENT_ENCRYPTED_FIELDS: (keyof PatientRecord)[] = [
  'firstName',
  'lastName',
  'dateOfBirth',
  'bloodType',
  'allergies',
  'emergencyContact',
  'insuranceInfo',
];
