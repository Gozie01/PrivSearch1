// ─────────────────────────────────────────────────────────────
// FileMeta schema — metadata record stored in MongoDB for every
// binary object uploaded to MinIO.
//
// The MinIO object key IS the SHA-256 of the raw binary content
// (content-addressed storage). Soft-delete moves the object to
// a "deleted/" prefix; the MongoDB document is tombstoned.
// ─────────────────────────────────────────────────────────────

export interface FileMeta {
  _id?: string;
  /** SHA-256 of raw binary content — doubles as the MinIO object key */
  fileHash: string;
  /** SHA-256 of the original plaintext bytes before encrypted storage */
  plaintextHash?: string;
  /** IV used to encrypt the stored file bytes */
  encryptionIv?: string;
  /** GCM auth tag used to verify/decrypt the stored file bytes */
  encryptionTag?: string;
  /** Optional IPFS content identifier for decentralized retrieval */
  ipfsCid?: string;
  /** Gateway URL derived from ipfsCid at upload time */
  ipfsGatewayUrl?: string;
  /** Whether this object was pinned through the configured IPFS node */
  ipfsPinned?: boolean;
  originalName: string;
  /** MIME type e.g. 'application/dicom', 'image/jpeg', 'application/pdf' */
  mimeType: string;
  sizeBytes: number;
  /** DID of the uploader */
  uploadedBy: string;
  /** Unix milliseconds */
  uploadedAt: number;
  /** Associated patient (optional foreign key) */
  patientId?: string;
  /** Associated medical record (optional foreign key) */
  recordId?: string;
  isDeleted: boolean;
  deletedAt?: number;
  deletedBy?: string;
  tags?: string[];
  /**
   * Reference to the encryption key used to encrypt the binary payload.
   * The actual key is NEVER stored here.
   */
  encryptionKeyId?: string;
}

export const FILE_REQUIRED_FIELDS: (keyof FileMeta)[] = [
  'fileHash',
  'originalName',
  'mimeType',
  'sizeBytes',
  'uploadedBy',
  'uploadedAt',
];

/** MIME types allowed for upload */
export const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'application/dicom',
  'image/jpeg',
  'image/png',
  'image/tiff',
  'image/webp',
  'text/plain',
  'application/json',
  'application/xml',
  'text/csv',
]);
