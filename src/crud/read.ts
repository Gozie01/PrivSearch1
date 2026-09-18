// ─────────────────────────────────────────────────────────────
// READ — RBAC-filtered fetch with optional field decryption
//
// Pipeline: [RBAC check] → [fetch] → AuditAgent
//
// Rules:
//   • records:read:own  — only the patient's own records
//   • records:read:all  — any record (physician, nurse, auditor …)
//   • RESEARCHER role   — all fields returned but PII is anonymised
// ─────────────────────────────────────────────────────────────
import type { DocumentStore } from '../storage/document-store';
import type { AuditAgent } from '../agents/audit-agent';
import type { Principal } from '../access/rbac';
import { hasPermission, requirePermission } from '../access/rbac';
import { decryptFields, isEncryptedField } from '../access/field-encryption';
import { config } from '../config';
import { logger } from '../utils/logger';

export interface ReadOptions {
  decryptedFields?: string[];
  anonymise?: boolean;
}

export class ReadOperation {
  constructor(
    private readonly store: DocumentStore,
    private readonly auditAgent: AuditAgent,
  ) {}

  // ── Single record by ID ───────────────────────────────────────

  async findById(
    id: string,
    recordType: string,
    actor: Principal,
    opts: ReadOptions = {},
    requestMeta?: Record<string, unknown>,
  ): Promise<Record<string, unknown> | null> {
    // Require at least one read permission (own or all)
    if (!hasPermission(actor.role, 'records:read:own') && !hasPermission(actor.role, 'records:read:all')) {
      const err = Object.assign(
        new Error('Insufficient permissions: records:read:own or records:read:all required'),
        { statusCode: 403 },
      );
      throw err;
    }

    const doc = await this.store.findById(id);
    if (!doc) return null;

    // Own-only scope: patients may only read their own records
    if (
      !hasPermission(actor.role, 'records:read:all') &&
      doc.patientId !== actor.did &&
      doc._id !== actor.did
    ) {
      const err = Object.assign(new Error('Access denied'), { statusCode: 403 });
      throw err;
    }

    const result = this.applyReadTransforms(doc, opts);

    // Audit the READ
    await this.auditAgent.execute({
      operation: 'READ',
      actorDID: actor.did,
      actorRole: actor.role,
      recordType,
      payload: { _id: id },
      meta: requestMeta,
    });

    logger.info('[Read] Record fetched', { id, recordType, actorDID: actor.did });
    return result;
  }

  // ── Query multiple records ─────────────────────────────────────

  async findByQuery(
    query: Record<string, unknown>,
    recordType: string,
    actor: Principal,
    opts: ReadOptions = {},
    pagination: { limit?: number; skip?: number } = {},
    requestMeta?: Record<string, unknown>,
  ): Promise<Record<string, unknown>[]> {
    // Require at least one read permission (own or all)
    if (!hasPermission(actor.role, 'records:read:own') && !hasPermission(actor.role, 'records:read:all')) {
      const err = Object.assign(
        new Error('Insufficient permissions: records:read:own or records:read:all required'),
        { statusCode: 403 },
      );
      throw err;
    }

    // Scope to own records if the actor lacks read:all
    const scopedQuery = hasPermission(actor.role, 'records:read:all')
      ? query
      : { ...query, patientId: actor.did };

    const docs = await this.store.findByQuery(scopedQuery, pagination);
    const results = docs.map((d) => this.applyReadTransforms(d, opts));

    // Bulk READ audit — single transaction covers the query
    await this.auditAgent.execute({
      operation: 'READ',
      actorDID: actor.did,
      actorRole: actor.role,
      recordType,
      payload: { query: scopedQuery, count: results.length },
      meta: requestMeta,
    });

    return results;
  }

  // ── Transforms ────────────────────────────────────────────────

  private applyReadTransforms(
    doc: Record<string, unknown>,
    opts: ReadOptions,
  ): Record<string, unknown> {
    let result = { ...doc };

    // Decrypt requested fields
    if (opts.decryptedFields?.length && config.encryption.masterKeyHex) {
      result = decryptFields(result, opts.decryptedFields, config.encryption.masterKeyHex);
    }

    // Anonymise for RESEARCHER role
    if (opts.anonymise) {
      result = anonymise(result);
    }

    return result;
  }
}

// ── PII anonymisation for researcher queries ──────────────────

const ANONYMISED_FIELDS = new Set([
  'firstName', 'lastName', 'dateOfBirth', 'emergencyContact',
  'insuranceInfo', 'patientId', 'actorDID', 'authorDID',
]);

function anonymise(doc: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(doc)) {
    if (ANONYMISED_FIELDS.has(k)) {
      result[k] = '[REDACTED]';
    } else if (isEncryptedField(v)) {
      result[k] = '[ENCRYPTED]';
    } else {
      result[k] = v;
    }
  }
  return result;
}
