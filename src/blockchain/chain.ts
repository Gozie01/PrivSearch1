// ─────────────────────────────────────────────────────────────
// Chain — append-only ledger storage + ChainValidator.
//
// Persistence: the full chain is serialised to a JSON file on disk.
// For production, swap out the persist() / load() methods to write
// to a replicated store (e.g. a dedicated MongoDB collection).
// ─────────────────────────────────────────────────────────────
import fs from 'fs';
import path from 'path';
import { createHash } from 'crypto';

import type { Block } from './block';
import { MerkleTree, computeBlockHash } from './block';
import type { LifeDBTransaction } from './transaction';
import { ValidatorRegistry } from './validator';
import { config } from '../config';
import { logger } from '../utils/logger';
import { PurechainAnchor } from './purechain-anchor';
import {
  AdaptiveAnchorScheduler,
  type AnchorSchedulerMode,
  type AnchorSchedulerStatus,
} from './adaptive-anchor';

// ── Integrity report ──────────────────────────────────────────

export interface ChainIntegrityReport {
  valid: boolean;
  errors: string[];
  blocksChecked: number;
}

// ── Ledger ────────────────────────────────────────────────────

export class LifeDBChain {
  private chain: Block[] = [];
  private readonly purechainAnchor = PurechainAnchor.fromConfig();
  private readonly anchorScheduler = new AdaptiveAnchorScheduler(this.purechainAnchor);

  constructor(private readonly registry: ValidatorRegistry) {}

  // ── Lifecycle ───────────────────────────────────────────────

  /** Load a persisted chain from disk, or create the genesis block. */
  async load(): Promise<void> {
    const p = config.blockchain.persistPath;
    try {
      if (fs.existsSync(p)) {
        const raw = fs.readFileSync(p, 'utf8');
        this.chain = JSON.parse(raw) as Block[];
        await this.anchorScheduler.initialize();
        await this.ensureGenesisAnchor();
        logger.info('[Chain] Loaded existing chain', { blocks: this.chain.length });
        return;
      }
    } catch (err) {
      logger.error('[Chain] Failed to load persisted chain — starting fresh', { err });
    }
    this.chain = [this.createGenesisBlock()];
    await this.persist();
    await this.anchorScheduler.initialize();
    await this.ensureGenesisAnchor();
    logger.info('[Chain] Genesis block created');
  }

  private createGenesisBlock(): Block {
    const partial: Omit<Block, 'blockHash'> = {
      index: 0,
      previousBlockHash: '0'.repeat(64),
      merkleRoot: createHash('sha256').update('LIFEDB_GENESIS', 'utf8').digest('hex'),
      transactions: [],
      timestamp: Date.now(),
      validatorSignatures: [],
    };
    return { ...partial, blockHash: computeBlockHash(partial) };
  }

  // ── Write ────────────────────────────────────────────────────

  async addBlock(block: Block): Promise<void> {
    const last = this.getLastBlock();

    if (block.previousBlockHash !== last.blockHash) {
      throw new Error(
        `[Chain] Block ${block.index}: previousBlockHash mismatch` +
          ` (expected ${last.blockHash.slice(0, 8)}…)`,
      );
    }

    const expectedHash = computeBlockHash(block);
    if (block.blockHash !== expectedHash) {
      throw new Error(`[Chain] Block ${block.index}: blockHash is invalid`);
    }

    this.chain.push(block);
    await this.persist();
    this.anchorScheduler.enqueue(block);
  }

  // ── Read ─────────────────────────────────────────────────────

  getLastBlock(): Block {
    return this.chain[this.chain.length - 1];
  }

  getBlock(index: number): Block | undefined {
    return this.chain[index];
  }

  getChainLength(): number {
    return this.chain.length;
  }

  setAnchorPendingCountSource(source: () => number): void {
    this.anchorScheduler.setPendingTxCountSource(source);
  }

  getAnchorStatus(): AnchorSchedulerStatus {
    return this.anchorScheduler.getStatus();
  }

  setAnchorMode(mode: AnchorSchedulerMode): AnchorSchedulerMode {
    return this.anchorScheduler.setMode(mode);
  }

  async flushAnchors(timeoutMs?: number): Promise<boolean> {
    return this.anchorScheduler.flush(timeoutMs);
  }

  stopAnchoring(): void {
    this.anchorScheduler.stop();
  }

  /** Returns a shallow copy of the full chain (safe for iteration) */
  getFullChain(): readonly Block[] {
    return this.chain;
  }

  // ── Integrity ─────────────────────────────────────────────

  validate(): ChainIntegrityReport {
    const errors: string[] = [];

    for (let i = 1; i < this.chain.length; i++) {
      const curr = this.chain[i];
      const prev = this.chain[i - 1];

      // 1. Hash linkage
      if (curr.previousBlockHash !== prev.blockHash) {
        errors.push(
          `Block ${i}: previousBlockHash doesn't match block ${i - 1}`,
        );
      }

      // 2. Block hash integrity
      const expected = computeBlockHash(curr);
      if (curr.blockHash !== expected) {
        errors.push(`Block ${i}: blockHash is corrupted`);
      }

      // 3. Validator threshold (skip genesis)
      if (!this.registry.verifyBlockThreshold(
        curr.blockHash,
        curr.validatorSignatures,
        config.blockchain.validatorThreshold,
      )) {
        errors.push(
          `Block ${i}: validator signature threshold not met ` +
            `(${curr.validatorSignatures.length} sigs)`,
        );
      }

      // 4. Merkle root integrity — re-derive from stored transactions
      if (curr.transactions.length > 0) {
        const txHashes = curr.transactions.map((tx) =>
          createHash('sha256').update(JSON.stringify(tx), 'utf8').digest('hex'),
        );
        const recomputedRoot = new MerkleTree(txHashes).getRoot();
        if (recomputedRoot !== curr.merkleRoot) {
          errors.push(`Block ${i}: merkleRoot corrupted (transaction-level tamper detected)`);
        }
      }
    }

    return { valid: errors.length === 0, errors, blocksChecked: this.chain.length };
  }

  // ── Persistence ───────────────────────────────────────────

  private async persist(): Promise<void> {
    const dir = path.dirname(config.blockchain.persistPath);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      config.blockchain.persistPath,
      JSON.stringify(this.chain, null, 2),
      'utf8',
    );
  }

  private async ensureGenesisAnchor(): Promise<void> {
    if (!this.purechainAnchor || this.chain.length === 0) {
      return;
    }

    try {
      const hasGenesisAnchor = await this.purechainAnchor.hasAnchor(0);
      if (!hasGenesisAnchor) {
        this.anchorScheduler.enqueue(this.chain[0]);
      }
    } catch (err) {
      logger.warn('[Purechain] Unable to verify genesis anchor status', { err });
    }
  }

}

// ── Chain validator (audit query layer) ──────────────────────

export class ChainValidator {
  constructor(
    private readonly chain: LifeDBChain,
    private readonly registry: ValidatorRegistry,
  ) {}

  /**
   * Returns the full ordered transaction history for a given recordId.
   * Used by audit queries to reconstruct the provenance of any record.
   */
  verifyRecord(recordId: string): LifeDBTransaction[] {
    const history: LifeDBTransaction[] = [];
    for (const block of this.chain.getFullChain()) {
      for (const tx of block.transactions) {
        if (tx.recordId === recordId) history.push(tx);
      }
    }
    return history.sort((a, b) => a.timestamp - b.timestamp);
  }

  /** Locate a specific transaction by its UUID across all blocks */
  findTransaction(txId: string): {
    found: boolean;
    block?: Block;
    tx?: LifeDBTransaction;
  } {
    for (const block of this.chain.getFullChain()) {
      const tx = block.transactions.find((t) => t.id === txId);
      if (tx) return { found: true, block, tx };
    }
    return { found: false };
  }

  /** Full chain integrity check (delegates to LifeDBChain.validate()) */
  validateChain(): ChainIntegrityReport {
    return this.chain.validate();
  }
}
