// ─────────────────────────────────────────────────────────────
// Validator — ECDSA (P-256) key management for the PoA² ledger.
//
// PoA² has two tiers of authority:
//   Tier-1 — signs individual transactions (operation-level trust)
//   Tier-2 — co-signs sealed blocks (consensus-level trust)
//
// A transaction is valid only if a known tier-1 validator signed it.
// A block is valid only if ≥ 51 % of tier-2 validators signed it.
// ─────────────────────────────────────────────────────────────
import crypto from 'crypto';
import type { LifeDBTransaction } from './transaction';

// ── Identity ─────────────────────────────────────────────────

export interface ValidatorIdentity {
  /** Decentralized Identifier of this validator node */
  did: string;
  /** PEM-encoded SPKI public key */
  publicKeyPem: string;
  /** PEM-encoded PKCS8 private key — only present on the *local* node */
  privateKeyPem?: string;
  /** PoA² authority tier */
  tier: 1 | 2;
  addedAt: number;
  isActive: boolean;
}

// ── Signable payloads ─────────────────────────────────────────

/** Canonical string signed/verified for a transaction */
function txPayload(tx: Omit<LifeDBTransaction, 'signature'>): string {
  return JSON.stringify({
    id: tx.id,
    timestamp: tx.timestamp,
    operation: tx.operation,
    recordId: tx.recordId,
    actorDID: tx.actorDID,
    contentHash: tx.contentHash,
    previousHash: tx.previousHash,
    agentId: tx.agentId,
  });
}

// ── Transaction signer ────────────────────────────────────────

export class TransactionSigner {
  /** Sign a transaction with a tier-1 validator private key → hex signature */
  static sign(tx: Omit<LifeDBTransaction, 'signature'>, privateKeyPem: string): string {
    const signer = crypto.createSign('SHA256');
    signer.update(txPayload(tx), 'utf8');
    return signer.sign(privateKeyPem, 'hex');
  }

  /** Verify a signed transaction against a tier-1 validator public key */
  static verify(tx: LifeDBTransaction, publicKeyPem: string): boolean {
    try {
      const verifier = crypto.createVerify('SHA256');
      verifier.update(txPayload(tx), 'utf8');
      return verifier.verify(publicKeyPem, tx.signature, 'hex');
    } catch {
      return false;
    }
  }
}

// ── Block signer ──────────────────────────────────────────────

export class BlockSigner {
  /** A tier-2 validator signs the raw blockHash string */
  static sign(blockHash: string, privateKeyPem: string): string {
    const signer = crypto.createSign('SHA256');
    signer.update(blockHash, 'utf8');
    return signer.sign(privateKeyPem, 'hex');
  }

  static verify(blockHash: string, signature: string, publicKeyPem: string): boolean {
    try {
      const verifier = crypto.createVerify('SHA256');
      verifier.update(blockHash, 'utf8');
      return verifier.verify(publicKeyPem, signature, 'hex');
    } catch {
      return false;
    }
  }
}

// ── Registry ──────────────────────────────────────────────────

/**
 * In-memory registry of all known validators.
 * Populated from the genesis config at startup and updated via admin API.
 */
export class ValidatorRegistry {
  private readonly map = new Map<string, ValidatorIdentity>();

  register(v: ValidatorIdentity): void {
    this.map.set(v.did, v);
  }

  deactivate(did: string): void {
    const v = this.map.get(did);
    if (v) v.isActive = false;
  }

  get(did: string): ValidatorIdentity | undefined {
    return this.map.get(did);
  }

  getActive(tier?: 1 | 2): ValidatorIdentity[] {
    return [...this.map.values()].filter(
      (v) => v.isActive && (tier === undefined || v.tier === tier),
    );
  }

  count(tier?: 1 | 2): number {
    return this.getActive(tier).length;
  }

  isKnown(did: string): boolean {
    return this.map.has(did);
  }

  /** Returns true if the transaction was signed by ANY active tier-1 validator */
  verifyTransaction(tx: LifeDBTransaction): boolean {
    for (const v of this.getActive(1)) {
      if (TransactionSigner.verify(tx, v.publicKeyPem)) return true;
    }
    return false;
  }

  /**
   * Returns true if enough tier-2 validator signatures are present
   * to satisfy the configured threshold fraction.
   */
  verifyBlockThreshold(
    blockHash: string,
    sigs: string[],
    threshold: number,
  ): boolean {
    const tier2 = this.getActive(2);
    if (tier2.length === 0) return sigs.length > 0; // dev/single-node mode
    let valid = 0;
    for (const sig of sigs) {
      if (tier2.some((v) => BlockSigner.verify(blockHash, sig, v.publicKeyPem))) {
        valid++;
      }
    }
    return valid / tier2.length >= threshold;
  }
}

// ── Key generation helper ─────────────────────────────────────

/** Generate a fresh P-256 key pair for a new validator */
export function generateValidatorKeyPair(): {
  publicKeyPem: string;
  privateKeyPem: string;
} {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', {
    namedCurve: 'P-256',
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  return { publicKeyPem: publicKey, privateKeyPem: privateKey };
}
