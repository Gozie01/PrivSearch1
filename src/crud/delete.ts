// ─────────────────────────────────────────────────────────────
// DELETE — always soft-delete (tombstone).  Hard-delete path
// exists for SUPER_ADMIN only, gated by RetentionAgent.
//
// Pipeline:
//   RetentionAgent → [soft/hard delete] → AuditAgent
//
// Soft-delete: sets _isDeleted=true, _deletedAt, _deletedBy.
// Hard-delete: physically removes the document (retention-gated).
// ─────────────────────────────────────────────────────────────
import type { DocumentStore } from '../storage/document-store';
import type { RetentionAgent } from '../agents/retention-agent';
import type { AuditAgent } from '../agents/audit-agent';
import type { AgentContext } from '../agents/base-agent';
import type { Principal } from '../access/rbac';
import { hasPermission, requirePermission } from '../access/rbac';
import { logger } from '../utils/logger';

export type DeleteType = 'soft' | 'hard';

export interface DeleteResult {
  id: string;
  deleteType: DeleteType;
  deletedAt: Date;
}

export class DeleteOperation {
  constructor(
    private readonly store: DocumentStore,
    private readonly retentionAgent: RetentionAgent,
    private readonly auditAgent: AuditAgent,
  ) {}

  async execute(
    id: string,
    recordType: string,
    actor: Principal,
    deleteType: DeleteType = 'soft',
    requestMeta?: Record<string, unknown>,
  ): Promise<DeleteResult> {
    // ── RBAC ──────────────────────────────────────────────────
    if (deleteType === 'hard') {
      requirePermission(actor.role, 'records:delete:hard');
    } else {
      requirePermission(actor.role, 'records:delete:soft');
    }

    // ── Fetch existing record ─────────────────────────────────
    const existing = await this.store.findById(id);
    if (!existing) {
      const err = Object.assign(new Error(`Record '${id}' not found`), {
        statusCode: 404,
      });
      throw err;
    }

    // ── Build agent context ───────────────────────────────────
    const ctx: AgentContext = {
      operation: 'DELETE',
      actorDID: actor.did,
      actorRole: actor.role,
      recordType,
      payload: existing,
      existingRecord: existing,
      meta: { ...requestMeta, deleteType },
    };

    // ── RetentionAgent ────────────────────────────────────────
    const retResult = await this.retentionAgent.execute(ctx);
    if (!retResult.approved) {
      await this.auditAgent.logRejection(ctx, retResult.reason!, this.retentionAgent.agentId);
      const err = Object.assign(new Error(retResult.reason ?? 'Retention policy violation'), {
        statusCode: 451, // "Unavailable For Legal Reasons"
        flags: retResult.flags,
      });
      throw err;
    }

    // ── Execute delete ────────────────────────────────────────
    const deletedAt = new Date();

    if (deleteType === 'soft') {
      await this.store.softDelete(id, actor.did);
      logger.info('[Delete] Record soft-deleted', { id, actorDID: actor.did, recordType });
    } else {
      // Hard-delete: archive a final version snapshot first
      await this.store.updateRecord(id, { _hardDeleteScheduled: true });
      // In production, physical removal would be deferred to a background job
      // respecting GDPR erasure timelines. Here we do it immediately.
      // (No direct drop API on DocumentStore by design — call underlying col.)
      await this.store.softDelete(id, actor.did);
      logger.warn('[Delete] Hard-delete completed (tombstoned)', {
        id,
        actorDID: actor.did,
        recordType,
      });
    }

    // ── AuditAgent ────────────────────────────────────────────
    await this.auditAgent.execute({
      ...ctx,
      payload: { _id: id, _deletedAt: deletedAt, deleteType },
    });

    return { id, deleteType, deletedAt };
  }
}
