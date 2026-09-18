// ─────────────────────────────────────────────────────────────
// Transaction — the atomic unit of the LifeDB PoA² ledger.
// Only SHA-256 hashes of off-chain content travel on-chain.
// ─────────────────────────────────────────────────────────────

export type Operation = 'CREATE' | 'READ' | 'UPDATE' | 'DELETE';

/**
 * Every database operation that touches a patient record is recorded
 * as a LifeDBTransaction and committed to the PoA² chain.
 */
export interface LifeDBTransaction {
  /** UUID v4 — unique transaction identifier */
  id: string;
  /** Unix milliseconds */
  timestamp: number;
  operation: Operation;
  /** ID of the MongoDB document being touched */
  recordId: string;
  /** DID of the actor who triggered the operation */
  actorDID: string;
  /** SHA-256 of the document content *after* the operation */
  contentHash: string;
  /** SHA-256 of the document content *before* the operation ('' for CREATE) */
  previousHash: string;
  /** ID of the agent that approved the operation */
  agentId: string;
  /** ECDSA hex signature produced by a known tier-1 validator */
  signature: string;
  /** Extra context: role, IP, device fingerprint, anomaly flags, etc. */
  metadata: Record<string, unknown>;
}

/** Returned to the caller after a transaction is submitted */
export interface TransactionReceipt {
  transactionId: string;
  blockIndex?: number;
  status: 'PENDING' | 'COMMITTED' | 'REJECTED';
  committedAt?: number;
}

/** Logged when any agent rejects an operation */
export interface RejectedOperation {
  id: string;
  operation: Operation;
  recordId: string;
  actorDID: string;
  agentId: string;
  reason: string;
  timestamp: number;
  metadata?: Record<string, unknown>;
}
