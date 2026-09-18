// ─────────────────────────────────────────────────────────────
// CREATE — agent pipeline + document insert
//
// Pipeline: ValidationAgent → [insert] → AuditAgent
// ─────────────────────────────────────────────────────────────
import type { DocumentStore } from '../storage/document-store';
import type { ValidationAgent } from '../agents/validation-agent';
import type { AuditAgent } from '../agents/audit-agent';
import type { AgentContext } from '../agents/base-agent';
import type { Principal } from '../access/rbac';
import { requirePermission } from '../access/rbac';
import { encryptFields, computeContentHash } from '../access/field-encryption';
import { config } from '../config';
import { logger } from '../utils/logger';

export interface CreateOptions {
  encryptedFields?: string[];
}

export interface CreateResult {
  id: string;
  contentHash: string;
  version: number;
}

export class CreateOperation {
  constructor(
    private readonly store: DocumentStore,
    private readonly validationAgent: ValidationAgent,
    private readonly auditAgent: AuditAgent,
  ) {}

  async execute(
    record: Record<string, unknown>,
    recordType: string,
    actor: Principal,
    opts: CreateOptions = {},
    requestMeta?: Record<string, unknown>,
  ): Promise<CreateResult> {
    // ── RBAC ──────────────────────────────────────────────────
    requirePermission(actor.role, 'records:create');

    // ── Field encryption ──────────────────────────────────────
    // Merge recordType into document so it is stored and validated
    let payload: Record<string, unknown> = { recordType, ...record };
    if (opts.encryptedFields?.length && config.encryption.masterKeyHex) {
      payload = encryptFields(payload, opts.encryptedFields, config.encryption.masterKeyHex);
    }

    // ── Build agent context ───────────────────────────────────
    const ctx: AgentContext = {
      operation: 'CREATE',
      actorDID: actor.did,
      actorRole: actor.role,
      recordType,
      payload,
      existingRecord: null,
      meta: requestMeta,
    };

    // ── Run ValidationAgent ───────────────────────────────────
    const valResult = await this.validationAgent.execute(ctx);
    if (!valResult.approved) {
      await this.auditAgent.logRejection(ctx, valResult.reason!, this.validationAgent.agentId);
      const err = Object.assign(
        new Error(`Validation failed: ${valResult.reason}`),
        { statusCode: 422, flags: valResult.flags },
      );
      throw err;
    }
    const enrichedPayload = valResult.transformedPayload ?? payload;

    // ── Insert ────────────────────────────────────────────────
    const id = await this.store.insertRecord(enrichedPayload);
    const inserted = await this.store.findById(id);

    if (!inserted) throw new Error(`[Create] Insert succeeded but record ${id} not found`);

    logger.info('[Create] Record inserted', { id, recordType, actorDID: actor.did });

    // ── Run AuditAgent (post-operation) ───────────────────────
    await this.auditAgent.execute({
      ...ctx,
      payload: inserted,
      meta: requestMeta,
    });

    return {
      id,
      contentHash: inserted._contentHash as string,
      version: inserted._version as number,
    };
  }
}
