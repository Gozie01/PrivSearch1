// ─────────────────────────────────────────────────────────────
// ConsensusEngine — drives the PoA² block-sealing loop.
//
// Sealing triggers:
//   1. A configurable timer fires every BLOCK_INTERVAL_MS (default 5 s)
//   2. The pending-transaction pool reaches MAX_TX_PER_BLOCK (default 50)
//
// After sealing a candidate block the local tier-2 validator co-signs it.
// In a distributed deployment, the engine would broadcast the partial block
// to peer nodes to collect additional signatures before committing.
// ─────────────────────────────────────────────────────────────
import { createHash } from 'crypto';
import { EventEmitter } from 'events';

import type { LifeDBTransaction } from './transaction';
import type { Block } from './block';
import { MerkleTree, computeBlockHash } from './block';
import { BlockSigner, ValidatorRegistry } from './validator';
import { config } from '../config';
import { logger } from '../utils/logger';

export class ConsensusEngine extends EventEmitter {
  private pendingTxs: LifeDBTransaction[] = [];
  private sealTimer: ReturnType<typeof setInterval> | null = null;
  private isSealing = false;
  private blockIntervalMs = config.blockchain.blockIntervalMs;
  private maxTxPerBlock = config.blockchain.maxTxPerBlock;

  constructor(
    private readonly registry: ValidatorRegistry,
    private readonly commitBlock: (block: Block) => Promise<void>,
    private readonly getLastBlock: () => Block | null,
    private readonly localValidatorDid: string,
    private readonly localPrivateKeyPem: string,
  ) {
    super();
    this.startTimer();
  }

  /** Enqueue a validated transaction for the next block */
  addTransaction(tx: LifeDBTransaction): void {
    this.pendingTxs.push(tx);
    if (this.pendingTxs.length >= this.maxTxPerBlock) {
      // Don't await — fire-and-forget; the timer will catch stragglers
      this.sealNow().catch((err) =>
        logger.error('[ConsensusEngine] Seal error', { err }),
      );
    }
  }

  private startTimer(): void {
    if (this.sealTimer) {
      clearInterval(this.sealTimer);
    }
    this.sealTimer = setInterval(
      () =>
        this.sealNow().catch((err) =>
          logger.error('[ConsensusEngine] Timer seal error', { err }),
        ),
      this.blockIntervalMs,
    );
  }

  /** Attempt to seal a block from all currently pending transactions */
  async sealNow(): Promise<void> {
    if (this.isSealing || this.pendingTxs.length === 0) return;
    this.isSealing = true;

    // Drain the pool atomically
    const txBatch = this.pendingTxs.splice(0);

    try {
      const last = this.getLastBlock();
      const index = last ? last.index + 1 : 0;
      const previousBlockHash = last ? last.blockHash : '0'.repeat(64);

      // Build Merkle root from per-transaction SHA-256 hashes
      const txHashes = txBatch.map((tx) =>
        createHash('sha256').update(JSON.stringify(tx), 'utf8').digest('hex'),
      );
      const merkleRoot = new MerkleTree(txHashes).getRoot();

      const partial: Omit<Block, 'blockHash'> = {
        index,
        previousBlockHash,
        merkleRoot,
        transactions: txBatch,
        timestamp: Date.now(),
        validatorSignatures: [],
      };

      const blockHash = computeBlockHash(partial);

      // Local tier-2 validator co-signs first
      const localSig = BlockSigner.sign(blockHash, this.localPrivateKeyPem);
      partial.validatorSignatures.push(localSig);

      // In a distributed setup, broadcast `partial` to other tier-2 nodes here
      // and collect their signatures via a P2P message bus.
      // For now the local signature is the only one (single-node mode).

      const block: Block = { ...partial, blockHash };

      const reachesThreshold = this.registry.verifyBlockThreshold(
        blockHash,
        block.validatorSignatures,
        config.blockchain.validatorThreshold,
      );

      if (reachesThreshold) {
        await this.commitBlock(block);
        this.emit('block:committed', block);
        logger.info('[ConsensusEngine] Block sealed', {
          index: block.index,
          txCount: txBatch.length,
          blockHash: block.blockHash.slice(0, 16) + '…',
        });
      } else {
        // Re-queue the transactions so they aren't lost
        this.pendingTxs.unshift(...txBatch);
        this.emit('block:threshold_not_met', block);
        logger.warn('[ConsensusEngine] Block threshold not met', {
          sigs: block.validatorSignatures.length,
          tier2: this.registry.count(2),
        });
      }
    } catch (err) {
      // Put transactions back so they can be retried next cycle
      this.pendingTxs.unshift(...txBatch);
      logger.error('[ConsensusEngine] Failed to seal block', { err });
    } finally {
      this.isSealing = false;
    }
  }

  getPendingCount(): number {
    return this.pendingTxs.length;
  }

  getSealingConfig(): { blockIntervalMs: number; maxTxPerBlock: number } {
    return {
      blockIntervalMs: this.blockIntervalMs,
      maxTxPerBlock: this.maxTxPerBlock,
    };
  }

  setSealingConfig(input: {
    blockIntervalMs?: number;
    maxTxPerBlock?: number;
  }): { blockIntervalMs: number; maxTxPerBlock: number } {
    let restartTimer = false;

    if (
      typeof input.blockIntervalMs === 'number' &&
      Number.isFinite(input.blockIntervalMs) &&
      input.blockIntervalMs > 0
    ) {
      this.blockIntervalMs = Math.floor(input.blockIntervalMs);
      restartTimer = true;
    }

    if (
      typeof input.maxTxPerBlock === 'number' &&
      Number.isFinite(input.maxTxPerBlock) &&
      input.maxTxPerBlock > 0
    ) {
      this.maxTxPerBlock = Math.floor(input.maxTxPerBlock);
    }

    if (restartTimer) {
      this.startTimer();
    }

    if (this.pendingTxs.length >= this.maxTxPerBlock) {
      this.sealNow().catch((err) =>
        logger.error('[ConsensusEngine] Seal error after config update', { err }),
      );
    }

    return this.getSealingConfig();
  }

  stop(): void {
    if (this.sealTimer) {
      clearInterval(this.sealTimer);
      this.sealTimer = null;
    }
  }
}
