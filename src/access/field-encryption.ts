// ─────────────────────────────────────────────────────────────
// Field-level Encryption — AES-256-GCM
//
// Each encrypted field is stored as a JSON object:
//   { iv, ciphertext, tag, keyId }  (all hex-encoded)
//
// Key derivation: HKDF-style — SHA-256( masterKey || keyId )
// IV:  12 random bytes (96-bit, GCM recommended)
// Tag: 16 bytes (128-bit, default GCM auth tag)
//
// Key rotation: change `keyId` → re-encrypt impacted fields on next write.
// ─────────────────────────────────────────────────────────────
import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const TAG_BYTES = 16;

// ── Types ─────────────────────────────────────────────────────

export interface EncryptedField {
  /** 12-byte IV, hex-encoded */
  iv: string;
  /** AES-256-GCM ciphertext, hex-encoded */
  ciphertext: string;
  /** 16-byte authentication tag, hex-encoded */
  tag: string;
  /** Key identifier used to encrypt this field (for rotation tracking) */
  keyId: string;
}

export interface EncryptedBuffer {
  iv: string;
  ciphertext: Buffer;
  tag: string;
  keyId: string;
}

export function isEncryptedField(v: unknown): v is EncryptedField {
  return (
    typeof v === 'object' &&
    v !== null &&
    'iv' in v &&
    'ciphertext' in v &&
    'tag' in v &&
    'keyId' in v
  );
}

// ── Key derivation ────────────────────────────────────────────

function deriveKey(masterKeyHex: string, keyId: string): Buffer {
  if (!masterKeyHex || masterKeyHex.length < 64) {
    throw new Error(
      'MASTER_ENCRYPTION_KEY must be set to a 64-char hex string (32 bytes)',
    );
  }
  // SHA-256( masterKey_bytes || keyId_utf8 ) → 32 bytes
  return crypto
    .createHash('sha256')
    .update(Buffer.from(masterKeyHex, 'hex'))
    .update(keyId, 'utf8')
    .digest();
}

// ── Core encrypt / decrypt ────────────────────────────────────

/**
 * Encrypt any JSON-serialisable value with AES-256-GCM.
 * Returns an EncryptedField object suitable for MongoDB storage.
 */
export function encryptField(
  value: unknown,
  masterKeyHex: string,
  keyId = 'default',
): EncryptedField {
  const plaintext = JSON.stringify(value);
  const key = deriveKey(masterKeyHex, keyId);
  const iv = crypto.randomBytes(IV_BYTES);

  const cipher = crypto.createCipheriv(ALGORITHM, key, iv, {
    authTagLength: TAG_BYTES,
  } as crypto.CipherGCMOptions);

  const ciphertext = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return {
    iv: iv.toString('hex'),
    ciphertext: ciphertext.toString('hex'),
    tag: tag.toString('hex'),
    keyId,
  };
}

/**
 * Decrypt an EncryptedField back to its original value.
 * Throws if the authentication tag is invalid (tamper detection).
 */
export function decryptField(
  encField: EncryptedField,
  masterKeyHex: string,
): unknown {
  const key = deriveKey(masterKeyHex, encField.keyId);
  const iv = Buffer.from(encField.iv, 'hex');
  const ciphertext = Buffer.from(encField.ciphertext, 'hex');
  const tag = Buffer.from(encField.tag, 'hex');

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, {
    authTagLength: TAG_BYTES,
  } as crypto.CipherGCMOptions);
  (decipher as crypto.DecipherGCM).setAuthTag(tag);

  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return JSON.parse(plaintext.toString('utf8'));
}

export function encryptBuffer(
  plaintext: Buffer,
  masterKeyHex: string,
  keyId = 'file-default',
): EncryptedBuffer {
  const key = deriveKey(masterKeyHex, keyId);
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv, {
    authTagLength: TAG_BYTES,
  } as crypto.CipherGCMOptions);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    iv: iv.toString('hex'),
    ciphertext,
    tag: tag.toString('hex'),
    keyId,
  };
}

export function decryptBuffer(
  ciphertext: Buffer,
  masterKeyHex: string,
  ivHex: string,
  tagHex: string,
  keyId = 'file-default',
): Buffer {
  const key = deriveKey(masterKeyHex, keyId);
  const iv = Buffer.from(ivHex, 'hex');
  const tag = Buffer.from(tagHex, 'hex');
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, {
    authTagLength: TAG_BYTES,
  } as crypto.CipherGCMOptions);
  (decipher as crypto.DecipherGCM).setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

// ── Bulk document helpers ─────────────────────────────────────

/** Encrypt all named fields of a document in-place (returns a new object) */
export function encryptFields<T extends Record<string, unknown>>(
  doc: T,
  fields: (keyof T)[],
  masterKeyHex: string,
  keyId = 'default',
): T {
  const result: Record<string, unknown> = { ...doc };
  for (const field of fields) {
    const val = result[field as string];
    if (val !== undefined && val !== null) {
      result[field as string] = encryptField(val, masterKeyHex, keyId);
    }
  }
  return result as T;
}

/** Decrypt all named fields of a document in-place (returns a new object) */
export function decryptFields<T extends Record<string, unknown>>(
  doc: T,
  fields: (keyof T)[],
  masterKeyHex: string,
): T {
  const result: Record<string, unknown> = { ...doc };
  for (const field of fields) {
    const val = result[field as string];
    if (isEncryptedField(val)) {
      result[field as string] = decryptField(val, masterKeyHex);
    }
  }
  return result as T;
}

// ── Content hashing (for on-chain commitment) ─────────────────

/**
 * Compute a stable SHA-256 hash of document content.
 * System metadata fields are excluded so the hash only reflects
 * the clinical data that actually changed.
 */
export function computeContentHash(doc: Record<string, unknown>): string {
  // Exclude mutable system fields from the hash
  const { _id, _contentHash, _createdAt, _updatedAt, _version, ...content } =
    doc;

  // Deterministic serialisation: sort object keys
  return crypto
    .createHash('sha256')
    .update(stableStringify(content), 'utf8')
    .digest('hex');
}

function stableStringify(val: unknown): string {
  if (Array.isArray(val)) return '[' + val.map(stableStringify).join(',') + ']';
  if (val !== null && typeof val === 'object') {
    const sorted = Object.keys(val as object)
      .sort()
      .map((k) => JSON.stringify(k) + ':' + stableStringify((val as Record<string, unknown>)[k]));
    return '{' + sorted.join(',') + '}';
  }
  return JSON.stringify(val);
}
