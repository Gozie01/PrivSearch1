// ─────────────────────────────────────────────────────────────
// Block — immutable container of committed transactions plus
// a MerkleTree for O(log n) inclusion proofs.
// ─────────────────────────────────────────────────────────────
import { createHash } from 'crypto';
import type { LifeDBTransaction } from './transaction';

// ── Block structure ──────────────────────────────────────────

export interface Block {
  /** Sequential block number (genesis = 0) */
  index: number;
  /** blockHash of the preceding block */
  previousBlockHash: string;
  /** Merkle root of all transaction hashes in this block */
  merkleRoot: string;
  transactions: LifeDBTransaction[];
  /** Unix milliseconds when the block was sealed */
  timestamp: number;
  /**
   * PoA² tier-2 validator signatures over blockHash.
   * Must equal or exceed the configured threshold fraction.
   */
  validatorSignatures: string[];
  /** SHA-256 over canonical block fields (excluding this field itself) */
  blockHash: string;
}

// ── Merkle tree ──────────────────────────────────────────────

function sha256(data: string): string {
  return createHash('sha256').update(data, 'utf8').digest('hex');
}

/**
 * Binary Merkle tree built from an array of hex-encoded leaf hashes.
 * Supports root extraction and inclusion proofs for audit queries.
 */
export class MerkleTree {
  private readonly layers: string[][];

  constructor(hashes: string[]) {
    // At least one leaf is required; use a sentinel for empty blocks
    const leaves = hashes.length > 0 ? [...hashes] : [sha256('EMPTY_BLOCK')];
    this.layers = [leaves];
    this.buildUp();
  }

  private buildUp(): void {
    let current = this.layers[0];
    while (current.length > 1) {
      const next: string[] = [];
      for (let i = 0; i < current.length; i += 2) {
        const l = current[i];
        // Duplicate the last leaf when the layer has an odd count
        const r = i + 1 < current.length ? current[i + 1] : l;
        next.push(sha256(l + r));
      }
      this.layers.push(next);
      current = next;
    }
  }

  /** Merkle root of all leaves */
  getRoot(): string {
    return this.layers[this.layers.length - 1][0];
  }

  /**
   * Returns a Merkle inclusion proof for the given leaf hash.
   * Returns [] if the leaf is not present in this tree.
   */
  getProof(leafHash: string): Array<{ sibling: string; position: 'left' | 'right' }> {
    const proof: Array<{ sibling: string; position: 'left' | 'right' }> = [];
    let idx = this.layers[0].indexOf(leafHash);
    if (idx === -1) return [];

    for (let lvl = 0; lvl < this.layers.length - 1; lvl++) {
      const layer = this.layers[lvl];
      const isRight = idx % 2 === 1;
      const sibIdx = isRight ? idx - 1 : Math.min(idx + 1, layer.length - 1);
      proof.push({
        sibling: layer[sibIdx],
        position: isRight ? 'left' : 'right',
      });
      idx = Math.floor(idx / 2);
    }
    return proof;
  }

  /**
   * Verify that `leafHash` is included in a tree whose root is `root`,
   * given the `proof` path returned by getProof().
   */
  static verifyProof(
    leafHash: string,
    proof: Array<{ sibling: string; position: 'left' | 'right' }>,
    root: string,
  ): boolean {
    let current = leafHash;
    for (const { sibling, position } of proof) {
      current =
        position === 'left' ? sha256(sibling + current) : sha256(current + sibling);
    }
    return current === root;
  }
}

// ── Block hash ───────────────────────────────────────────────

/**
 * Compute the deterministic SHA-256 hash of a sealed block.
 * Excludes `blockHash` itself to avoid circularity.
 */
export function computeBlockHash(block: Omit<Block, 'blockHash'>): string {
  const canonical = JSON.stringify({
    index: block.index,
    previousBlockHash: block.previousBlockHash,
    merkleRoot: block.merkleRoot,
    timestamp: block.timestamp,
    txCount: block.transactions.length,
    // Validator signatures are *over* the blockHash, so must not be included in it
  });
  return sha256(canonical);
}
