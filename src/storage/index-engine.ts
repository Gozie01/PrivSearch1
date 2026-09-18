// ─────────────────────────────────────────────────────────────
// IndexEngine — declarative index management for MongoDB.
//
// Ensures that all performance-critical fields have compound
// and single-field indexes before the server starts accepting
// traffic.  Each IndexSpec describes one collection's indexes.
//
// Underlying data structure: MongoDB's B-tree indexes back
// ordered range scans; hash indexes back equality lookups.
// The engine itself creates / verifies them at startup.
// ─────────────────────────────────────────────────────────────
import { Db, IndexDirection } from 'mongodb';
import { logger } from '../utils/logger';

export type IndexFieldSpec = Record<string, IndexDirection | 'text'>;

export interface IndexSpec {
  collection: string;
  indexes: Array<{
    fields: IndexFieldSpec;
    unique?: boolean;
    sparse?: boolean;
    background?: boolean;
  }>;
}

// ── Predefined index specifications ──────────────────────────

export const INDEX_SPECS: IndexSpec[] = [
  {
    collection: 'patients',
    indexes: [
      { fields: { patientId: 1 }, unique: true },
      { fields: { _isDeleted: 1, _updatedAt: -1 } },
      { fields: { primaryPhysicianDID: 1 } },
    ],
  },
  {
    collection: 'records',
    indexes: [
      { fields: { patientId: 1, recordType: 1 } },
      { fields: { authorDID: 1, date: -1 } },
      { fields: { _isDeleted: 1, date: -1 } },
      { fields: { confidentialityLevel: 1 } },
      { fields: { tags: 1 }, sparse: true },
    ],
  },
  {
    collection: 'file_meta',
    indexes: [
      { fields: { fileHash: 1 }, unique: true },
      { fields: { patientId: 1 }, sparse: true },
      { fields: { recordId: 1 }, sparse: true },
      { fields: { ipfsCid: 1 }, sparse: true },
      { fields: { isDeleted: 1 } },
    ],
  },
  {
    collection: 'hash_logs',
    indexes: [
      { fields: { recordId: 1, timestamp: -1 } },
      { fields: { transactionId: 1 }, unique: true, sparse: true },
      { fields: { actorDID: 1, timestamp: -1 } },
      { fields: { operation: 1, timestamp: -1 } },
    ],
  },
  {
    collection: 'identities',
    indexes: [
      { fields: { did: 1 }, unique: true },
      { fields: { role: 1 } },
    ],
  },
];

// ── Engine ────────────────────────────────────────────────────

export class IndexEngine {
  constructor(private readonly db: Db) {}

  /**
   * Ensure all predefined indexes exist.
   * Safe to call on every startup — MongoDB is idempotent for duplicate index requests.
   */
  async ensureAll(): Promise<void> {
    for (const spec of INDEX_SPECS) {
      await this.ensureSpec(spec);
    }
    logger.info('[IndexEngine] All indexes verified');
  }

  async ensureSpec(spec: IndexSpec): Promise<void> {
    const col = this.db.collection(spec.collection);
    for (const idx of spec.indexes) {
      try {
        const opts: Record<string, unknown> = { background: idx.background ?? true };
        if (idx.unique === true) opts.unique = true;
        if (idx.sparse === true) opts.sparse = true;
        await col.createIndex(idx.fields, opts);
      } catch (err: unknown) {
        // Ignore "already exists with different options" in dev; log in prod
        logger.warn('[IndexEngine] Index creation warning', {
          collection: spec.collection,
          fields: idx.fields,
          err: (err as Error).message,
        });
      }
    }
  }

  /** List all indexes on a given collection (useful for diagnostics) */
  async listIndexes(collection: string): Promise<unknown[]> {
    const col = this.db.collection(collection);
    return col.listIndexes().toArray();
  }

  /** Drop all non-_id indexes on a collection — destructive, dev/test only */
  async dropAll(collection: string): Promise<void> {
    const col = this.db.collection(collection);
    await col.dropIndexes();
    logger.warn('[IndexEngine] All indexes dropped', { collection });
  }
}
