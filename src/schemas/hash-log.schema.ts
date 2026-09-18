// ─────────────────────────────────────────────────────────────
// HashLog schema — lightweight off-chain shadow of on-chain
// transaction records, enabling fast MongoDB queries without
// scanning the full blockchain.
// ─────────────────────────────────────────────────────────────
import type { Operation } from '../blockchain/transaction';

export interface HashLog {
  _id?: string;
  /** MongoDB document _id that this log entry describes */
  recordId: string;
  /** SHA-256 of the document content *after* the operation */
  contentHash: string;
  /** SHA-256 of the document content *before* the operation ('' for CREATE) */
  previousHash: string;
  operation: Operation;
  /** DID of the actor who triggered the operation */
  actorDID: string;
  /** Agent that approved the operation */
  agentId: string;
  /** Unix milliseconds */
  timestamp: number;
  /** Block index where the corresponding tx was committed (set after sealing) */
  blockIndex?: number;
  /** UUID of the corresponding LifeDBTransaction */
  transactionId?: string;
  /** Document _version after the operation */
  version: number;
  /** Optional rejection details — populated when an agent blocks an operation */
  rejectionReason?: string;
}
