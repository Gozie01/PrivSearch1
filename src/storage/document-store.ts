// ─────────────────────────────────────────────────────────────
// DocumentStore — MongoDB wrapper with full versioning support.
//
// Every UPDATE archives the current document to a "<col>_versions"
// shadow collection before applying the delta, ensuring a complete
// immutable audit trail even at the storage layer.
//
// All documents carry system fields:
//   _id, _version, _contentHash, _createdAt, _updatedAt,
//   _deletedAt, _deletedBy, _isDeleted
// ─────────────────────────────────────────────────────────────
import crypto from 'crypto';
import { MongoClient, Db, Collection } from 'mongodb';

import { config } from '../config';
import { logger } from '../utils/logger';

// All LifeDB documents use string UUIDs as _id (never ObjectId)
interface LifeDBDoc {
  _id: string;
  [key: string]: unknown;
}

// ── Connection singleton ──────────────────────────────────────

let _client: MongoClient | null = null;
let _db: Db | null = null;

export async function connectMongo(): Promise<Db> {
  if (_db) return _db;
  _client = new MongoClient(config.mongodb.uri);
  await _client.connect();
  _db = _client.db(config.mongodb.dbName);
  logger.info('[DocumentStore] Connected to MongoDB', { db: config.mongodb.dbName });
  return _db;
}

export async function disconnectMongo(): Promise<void> {
  if (_client) {
    await _client.close();
    _client = null;
    _db = null;
  }
}

function getDb(): Db {
  if (!_db) throw new Error('[DocumentStore] Not connected. Call connectMongo() first.');
  return _db;
}

// ── Version snapshot ──────────────────────────────────────────

export interface RecordVersion {
  recordId: string;
  version: number;
  snapshot: Record<string, unknown>;
  savedAt: Date;
}

// ── Helpers ───────────────────────────────────────────────────

function contentHash(doc: Record<string, unknown>): string {
  // Exclude mutable system metadata so the hash only covers clinical data
  const { _id, _contentHash, _createdAt, _updatedAt, _version, ...body } = doc;
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(body), 'utf8')
    .digest('hex');
}

// ── DocumentStore ─────────────────────────────────────────────

export class DocumentStore {
  private readonly colName: string;
  private readonly verColName: string;

  constructor(collectionName: string) {
    this.colName = collectionName;
    this.verColName = `${collectionName}_versions`;
  }

  private col(): Collection<LifeDBDoc> {
    return getDb().collection<LifeDBDoc>(this.colName);
  }

  private verCol(): Collection<LifeDBDoc> {
    return getDb().collection<LifeDBDoc>(this.verColName);
  }

  // ── Write operations ─────────────────────────────────────────

  /**
   * Insert a new record.
   * Sets all system fields; the caller must NOT include them.
   * Returns the string UUID of the inserted document.
   */
  async insertRecord(record: Record<string, unknown>): Promise<string> {
    const id = crypto.randomUUID();
    const now = new Date();
    const doc: Record<string, unknown> = {
      ...record,
      _id: id,
      _version: 1,
      _createdAt: now,
      _updatedAt: now,
      _deletedAt: null,
      _deletedBy: null,
      _isDeleted: false,
    };
    doc._contentHash = contentHash(doc);
    await this.col().insertOne(doc as LifeDBDoc);
    return id;
  }

  /**
   * Non-destructive UPDATE:
   *   1. Copies the current document to the versions collection with its
   *      current _version number.
   *   2. Merges `delta` into the document.
   *   3. Increments _version and recomputes _contentHash.
   */
  async updateRecord(id: string, delta: Record<string, unknown>): Promise<void> {
    const existing = await this.col().findOne({ _id: id });
    if (!existing) throw new Error(`[DocumentStore] Record '${id}' not found`);

    // Archive current state
    await this.verCol().insertOne({
      _id: crypto.randomUUID(),
      recordId: id,
      version: existing['_version'],
      snapshot: { ...existing },
      savedAt: new Date(),
    } as LifeDBDoc);

    // Write updated document
    const updated: Record<string, unknown> = {
      ...existing,
      ...delta,
      _id: id,
      _version: (existing['_version'] as number) + 1,
      _updatedAt: new Date(),
    };
    updated._contentHash = contentHash(updated);

    await this.col().replaceOne({ _id: id }, updated);
  }

  /**
   * Soft-DELETE: tombstones the document without removing it.
   * Hard DELETEs are never performed by this store — RetentionAgent
   * enforces this at the pipeline level.
   */
  async softDelete(id: string, actorDID: string): Promise<void> {
    await this.col().updateOne(
      { _id: id },
      {
        $set: {
          _isDeleted: true,
          _deletedAt: new Date(),
          _deletedBy: actorDID,
          _updatedAt: new Date(),
        },
      },
    );
  }

  // ── Read operations ───────────────────────────────────────────

  async findById(id: string): Promise<Record<string, unknown> | null> {
    const doc = await this.col().findOne({ _id: id });
    return doc as Record<string, unknown> | null;
  }

  /**
   * Query matching documents.
   * Soft-deleted documents are excluded unless `includeDeleted` is true.
   */
  async findByQuery(
    query: Record<string, unknown>,
    options: { limit?: number; skip?: number; includeDeleted?: boolean } = {},
  ): Promise<Record<string, unknown>[]> {
    const filter = options.includeDeleted
      ? { ...query }
      : { ...query, _isDeleted: false };

    let cursor = this.col().find(filter);
    if (options.skip) cursor = cursor.skip(options.skip);
    if (options.limit) cursor = cursor.limit(options.limit);

    return (await cursor.toArray()) as Record<string, unknown>[];
  }

  /** Return all archived versions of a document, sorted oldest → newest */
  async getVersionHistory(id: string): Promise<RecordVersion[]> {
    const docs = await this.verCol()
      .find({ recordId: id })
      .sort({ version: 1 })
      .toArray();
    return docs as unknown as RecordVersion[];
  }

  async count(query: Record<string, unknown> = {}): Promise<number> {
    return this.col().countDocuments({ ...query, _isDeleted: false });
  }

  // ── Index management ──────────────────────────────────────────

  /**
   * Ensure MongoDB indexes exist on this collection.
   * Safe to call repeatedly — MongoDB ignores duplicate index requests.
   */
  async ensureIndexes(
    indexSpecs: Array<Record<string, 1 | -1 | 'text'>>,
  ): Promise<void> {
    for (const spec of indexSpecs) {
      await this.col().createIndex(spec);
    }
  }
}
