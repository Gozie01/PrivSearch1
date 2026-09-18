// ─────────────────────────────────────────────────────────────
// Base Agent — interfaces and abstract base class shared by all
// LifeDB agents.
//
// Agent pipeline order per CRUD request:
//   ValidationAgent → RetentionAgent → [CRUD executes] → AuditAgent
//
// Every agent is a synchronous-first TypeScript class.
// No external LLM calls are made here — pure embedded logic.
// ─────────────────────────────────────────────────────────────
import type { Operation } from '../blockchain/transaction';
import type { Role } from '../access/rbac';

// ── Context ───────────────────────────────────────────────────

export interface AgentContext {
  operation: Operation;
  /** DID of the actor requesting the operation */
  actorDID: string;
  actorRole: Role;
  /** e.g. 'PATIENT', 'LAB_RESULT', 'IMAGING' */
  recordType: string;
  /** The incoming payload (for CREATE/UPDATE) or query (for READ/DELETE) */
  payload: Record<string, unknown>;
  /** Current state of the document being mutated (null for CREATE) */
  existingRecord?: Record<string, unknown> | null;
  /** Additional hints injected by the CRUD layer */
  meta?: {
    ip?: string;
    userAgent?: string;
    deleteType?: 'soft' | 'hard';
    [key: string]: unknown;
  };
}

// ── Result ────────────────────────────────────────────────────

export interface AgentResult {
  approved: boolean;
  agentId: string;
  /** Required when approved === false */
  reason?: string;
  /** Agent may sanitise or enrich the payload */
  transformedPayload?: Record<string, unknown>;
  /** e.g. 'SENSITIVE_FIELD_DETECTED', 'OUTSIDE_HOURS', 'RETENTION_BLOCK' */
  flags: string[];
}

// ── Interface ─────────────────────────────────────────────────

export interface LifeDBAgent {
  agentId: string;
  name: string;
  execute(context: AgentContext): Promise<AgentResult>;
}

// ── Abstract base class ───────────────────────────────────────

export abstract class BaseAgent implements LifeDBAgent {
  abstract readonly agentId: string;
  abstract readonly name: string;

  abstract execute(context: AgentContext): Promise<AgentResult>;

  protected approve(
    transformedPayload?: Record<string, unknown>,
    flags: string[] = [],
  ): AgentResult {
    return {
      approved: true,
      agentId: this.agentId,
      transformedPayload,
      flags,
    };
  }

  protected reject(reason: string, flags: string[] = []): AgentResult {
    return {
      approved: false,
      agentId: this.agentId,
      reason,
      flags,
    };
  }
}

// ── Pipeline runner ───────────────────────────────────────────

/**
 * Run an ordered list of agents against a context.
 * Stops immediately when any agent returns approved === false.
 * Returns the first rejection or the last approval.
 */
export async function runPipeline(
  agents: LifeDBAgent[],
  ctx: AgentContext,
): Promise<AgentResult> {
  let lastResult: AgentResult = {
    approved: true,
    agentId: 'pipeline',
    flags: [],
  };

  for (const agent of agents) {
    const result = await agent.execute(ctx);
    lastResult = result;

    if (!result.approved) return result;

    // Pass enriched payload to the next agent
    if (result.transformedPayload) {
      ctx = { ...ctx, payload: result.transformedPayload };
    }
  }

  return lastResult;
}
