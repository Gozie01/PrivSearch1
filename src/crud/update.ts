// ─────────────────────────────────────────────────────────────
// UPDATE — agent pipeline + non-destructive document update
//
// Pipeline: ValidationAgent → [version-archive + apply delta] → AuditAgent
//
// The old document is always archived to <col>_versions before
// any change is applied (DocumentStore handles this internally).
// ─────────────────────────────────────────────────────────────
import type { DocumentStore } from '../storage/document-store';
import type { ValidationAgent } from '../agents/validation-agent';
import type { AuditAgent } from '../agents/audit-agent';
import type { AgentContext } from '../agents/base-agent';
import type { Principal } from '../access/rbac';
import { requirePermission } from '../access/rbac';
import { encryptFields } from '../access/field-encryption';
import { config } from '../config';
import { logger } from '../utils/logger';

export interface UpdateOptions {
  encryptedFields?: string[];
}

export interface UpdateResult {
  id: string;
  contentHash: string;
  version: number;
}

export class UpdateOperation {
  constructor(
    private readonly store: DocumentStore,
    private readonly validationAgent: ValidationAgent,
    private readonly auditAgent: AuditAgent,
  ) {}

  async execute(
    id: string,
    delta: Record<string, unknown>,
    recordType: string,
    actor: Principal,
    opts: UpdateOptions = {},
    requestMeta?: Record<string, unknown>,
  ): Promise<UpdateResult> {
    // ── RBAC ──────────────────────────────────────────────────
    requirePermission(actor.role, 'records:update');

    // ── Fetch existing record ─────────────────────────────────
    const existing = await this.store.findById(id);
    if (!existing) {
      const err = Object.assign(new Error(`Record '${id}' not found`), {
        statusCode: 404,
      });
      throw err;
    }

    if (existing._isDeleted) {
      const err = Object.assign(
        new Error(`Record '${id}' is soft-deleted and cannot be updated`),
        { statusCode: 410 },
      );
      throw err;
    }

    // ── Field encryption ──────────────────────────────────────
    let payload = { ...delta };
    if (opts.encryptedFields?.length && config.encryption.masterKeyHex) {
      payload = encryptFields(payload, opts.encryptedFields, config.encryption.masterKeyHex);
    }

    // ── ValidationAgent ───────────────────────────────────────
    const ctx: AgentContext = {
      operation: 'UPDATE',
      actorDID: actor.did,
      actorRole: actor.role,
      recordType,
      payload,
      existingRecord: existing,
      meta: requestMeta,
    };

    const valResult = await this.validationAgent.execute(ctx);
    if (!valResult.approved) {
      await this.auditAgent.logRejection(ctx, valResult.reason!, this.validationAgent.agentId);
      const err = Object.assign(
        new Error(`Validation failed: ${valResult.reason}`),
        { statusCode: 422, flags: valResult.flags },
      );
      throw err;
    }
    const enrichedDelta = valResult.transformedPayload ?? payload;

    // ── Apply delta (archives old version internally) ─────────
    await this.store.updateRecord(id, enrichedDelta);
    const updated = await this.store.findById(id);

    if (!updated) throw new Error(`[Update] Record ${id} missing after update`);

    logger.info('[Update] Record updated', {
      id,
      recordType,
      actorDID: actor.did,
      version: updated._version,
    });

    // ── AuditAgent ────────────────────────────────────────────
    await this.auditAgent.execute({
      ...ctx,
      payload: updated,
      existingRecord: existing,
    });

    return {
      id,
      contentHash: updated._contentHash as string,
      version: updated._version as number,
    };
  }
}
