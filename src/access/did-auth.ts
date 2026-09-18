// ─────────────────────────────────────────────────────────────
// DID Authentication
//
// Implements a challenge-response flow:
//   1. Client requests a challenge nonce for their DID
//   2. Client signs the nonce with their private key
//   3. Server verifies the signature against the stored public key
//   4. Server issues a short-lived JWT session token
//
// DID method: did:key  (public key fingerprint — no registry needed)
// Key algorithm: EC P-256 (ECDSA / SHA-256)
// ─────────────────────────────────────────────────────────────
import crypto from 'crypto';
import jwt from 'jsonwebtoken';

import { config } from '../config';
import type { Role, Principal } from './rbac';

// ── DID document (stored in MongoDB "identities" collection) ──

export interface DIDDocument {
  /** e.g. "did:key:z..." */
  did: string;
  /** PEM-encoded SPKI public key */
  publicKeyPem: string;
  role: Role;
  createdAt: number;
  isActive: boolean;
  /** Optional display label */
  label?: string;
}

// ── JWT payload ───────────────────────────────────────────────

export interface JWTPayload {
  /** Subject = DID */
  sub: string;
  role: Role;
  sessionId: string;
  iat: number;
  exp: number;
}

// ── DID derivation ────────────────────────────────────────────

/**
 * Derive a deterministic DID from a PEM-encoded P-256 public key.
 * Uses the base64url-encoded SHA-256 fingerprint as the method-specific id.
 */
export function deriveDidFromPublicKey(publicKeyPem: string): string {
  const fingerprint = crypto
    .createHash('sha256')
    .update(publicKeyPem, 'utf8')
    .digest('base64url');
  return `did:key:z${fingerprint}`;
}

// ── Key generation ────────────────────────────────────────────

/** Generate a fresh P-256 key pair and associated DID */
export function generateDID(): {
  did: string;
  publicKeyPem: string;
  privateKeyPem: string;
} {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', {
    namedCurve: 'P-256',
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  return {
    did: deriveDidFromPublicKey(publicKey),
    publicKeyPem: publicKey,
    privateKeyPem: privateKey,
  };
}

// ── Challenge-response ────────────────────────────────────────

/** Generate a one-time challenge nonce (hex-encoded 32 random bytes) */
export function generateChallenge(): string {
  return crypto.randomBytes(32).toString('hex');
}

/** Sign a challenge with a private key → hex-encoded ECDSA signature */
export function signChallenge(challenge: string, privateKeyPem: string): string {
  const signer = crypto.createSign('SHA256');
  signer.update(challenge, 'utf8');
  return signer.sign(privateKeyPem, 'hex');
}

/** Verify that `signature` was produced by the private key corresponding to `publicKeyPem` */
export function verifyChallenge(
  challenge: string,
  signature: string,
  publicKeyPem: string,
): boolean {
  try {
    const verifier = crypto.createVerify('SHA256');
    verifier.update(challenge, 'utf8');
    return verifier.verify(publicKeyPem, signature, 'hex');
  } catch {
    return false;
  }
}

// ── Session tokens ────────────────────────────────────────────

/** Issue a JWT for an authenticated DID */
export function issueSessionToken(did: string, role: Role): string {
  const payload: Omit<JWTPayload, 'iat' | 'exp'> = {
    sub: did,
    role,
    sessionId: crypto.randomUUID(),
  };
  // Cast expiresIn through unknown to satisfy the ms.StringValue branded type
  // in @types/jsonwebtoken ≥ 9.0.7 without losing semantic correctness.
  return jwt.sign(payload, config.jwt.secret, {
    expiresIn: config.jwt.expiresIn as unknown as number,
    algorithm: 'HS256',
  });
}

/**
 * Verify and decode a JWT.
 * Throws if the token is invalid or expired.
 */
export function verifySessionToken(token: string): JWTPayload {
  const decoded = jwt.verify(token, config.jwt.secret, {
    algorithms: ['HS256'],
  });
  return decoded as JWTPayload;
}

/** Extract a Principal from a valid JWT (does NOT call verifySessionToken) */
export function principalFromPayload(payload: JWTPayload): Principal {
  return { did: payload.sub, role: payload.role, sessionId: payload.sessionId };
}
