// ─────────────────────────────────────────────────────────────
// AuditAgent
//
// Runs AFTER every successful CRUD operation in the pipeline.
// Responsibilities:
//   1. Always return approved: true (never blocks operations).
//   2. Enrich context with geolocation stub, device fingerprint,
//      and an access-time anomaly flag.
//   3. Assemble and sign a LifeDBTransaction.
//   4. Submit the transaction to the ConsensusEngine.
//   5. Write a HashLog entry to MongoDB for fast audit queries.
// ─────────────────────────────────────────────────────────────
import { v4 as uuidv4 } from 'uuid';
import { createHash } from 'crypto';

import { BaseAgent } from './base-agent';
import type { AgentContext, AgentResult } from './base-agent';
import type { LifeDBTransaction } from '../blockchain/transaction';
import type { ConsensusEngine } from '../blockchain/consensus';
import { TransactionSigner } from '../blockchain/validator';
import type { DocumentStore } from '../storage/document-store';
import type { HashLog } from '../schemas/hash-log.schema';

// ── Normal-hours definition (08:00 – 20:00 local) ─────────────
const NORMAL_HOURS_START = 8;
const NORMAL_HOURS_END = 20;

function isOutsideNormalHours(): boolean {
  const hour = new Date().getHours();
  return hour < NORMAL_HOURS_START || hour >= NORMAL_HOURS_END;
}

function deviceFingerprint(ip: string, userAgent: string): string {
  return createHash('sha256')
    .update(ip + '|' + userAgent, 'utf8')
    .digest('hex')
    .slice(0, 16);
}

// ── Agent ─────────────────────────────────────────────────────

export class AuditAgent extends BaseAgent {
  readonly agentId = 'audit-agent-v1';
  readonly name = 'AuditAgent';

  constructor(
    private readonly consensus: ConsensusEngine,
    /** DID of the local validator node */
    private readonly localValidatorDid: string,
    /** PEM private key of the local tier-1 validator — used to sign tx */
    private readonly localPrivateKeyPem: string,
    private readonly hashLogStore: DocumentStore,
  ) {
    super();
  }

  async execute(ctx: AgentContext): Promise<AgentResult> {
    const flags: string[] = [];
    const ip = (ctx.meta?.ip as string | undefined) ?? '0.0.0.0';
    const ua = (ctx.meta?.userAgent as string | undefined) ?? 'unknown';

    if (isOutsideNormalHours()) flags.push('OUTSIDE_NORMAL_HOURS');

    const enrichedMeta: Record<string, unknown> = {
      ...ctx.meta,
      deviceFingerprint: deviceFingerprint(ip, ua),
      ip,
      role: ctx.actorRole,
      recordType: ctx.recordType,
    };

    // Content hashes
    const contentAfter = this.hashPayload(ctx.payload);
    const contentBefore = ctx.existingRecord
      ? this.hashPayload(ctx.existingRecord)
      : '';

    // Build unsigned transaction
    const txUnsigned: Omit<LifeDBTransaction, 'signature'> = {
      id: uuidv4(),
      timestamp: Date.now(),
      operation: ctx.operation,
      recordId: (ctx.payload._id as string | undefined) ?? '',
      actorDID: ctx.actorDID,
      contentHash: contentAfter,
      previousHash: contentBefore,
      agentId: this.agentId,
      metadata: enrichedMeta,
    };

    // Sign with local tier-1 validator private key
    const signature = TransactionSigner.sign(txUnsigned, this.localPrivateKeyPem);
    const tx: LifeDBTransaction = { ...txUnsigned, signature };

    // Submit to consensus engine (async block-sealing)
    this.consensus.addTransaction(tx);

    // Write hash log entry for fast MongoDB audit queries
    const hashLog: HashLog = {
      recordId: txUnsigned.recordId,
      contentHash: contentAfter,
      previousHash: contentBefore,
      operation: ctx.operation,
      actorDID: ctx.actorDID,
      agentId: this.agentId,
      timestamp: txUnsigned.timestamp,
      transactionId: txUnsigned.id,
      version: (ctx.payload._version as number | undefined) ?? 1,
    };

    try {
      await this.hashLogStore.insertRecord(
        hashLog as unknown as Record<string, unknown>,
      );
    } catch {
      // Hash log writes are best-effort; never fail the main operation
    }

    return this.approve(ctx.payload, flags);
  }

  /** Log a rejected operation to the blockchain (non-blocking) */
  async logRejection(
    ctx: AgentContext,
    reason: string,
    rejectingAgentId: string,
  ): Promise<void> {
    const txUnsigned: Omit<LifeDBTransaction, 'signature'> = {
      id: uuidv4(),
      timestamp: Date.now(),
      operation: ctx.operation,
      recordId: (ctx.payload._id as string | undefined) ?? 'UNKNOWN',
      actorDID: ctx.actorDID,
      contentHash: this.hashPayload(ctx.payload),
      previousHash: '',
      agentId: rejectingAgentId,
      metadata: {
        rejection: true,
        reason,
        role: ctx.actorRole,
        recordType: ctx.recordType,
      },
    };

    try {
      const signature = TransactionSigner.sign(txUnsigned, this.localPrivateKeyPem);
      this.consensus.addTransaction({ ...txUnsigned, signature });
    } catch {
      // Best-effort
    }
  }

  private hashPayload(payload: Record<string, unknown>): string {
    const { _contentHash, ...rest } = payload;
    return createHash('sha256')
      .update(JSON.stringify(rest), 'utf8')
      .digest('hex');
  }
}
