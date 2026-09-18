// ─────────────────────────────────────────────────────────────
// RetentionAgent
//
// Enforces data-retention policy BEFORE any DELETE operation.
// Retention rules (from config/constants):
//   • Patient records   — minimum 10 years
//   • Lab results       — minimum 7 years
//   • Audit logs        — PERMANENT (never deletable)
//
// Soft-DELETE (tombstone) is ALWAYS approved.
// Hard-DELETE is checked against the minimum retention window.
// ─────────────────────────────────────────────────────────────
import { BaseAgent } from './base-agent';
import type { AgentContext, AgentResult } from './base-agent';
import { config } from '../config';
import { RETENTION_YEARS } from '../schemas/record.schema';

// Collections / recordTypes that are permanently immutable
const PERMANENT_RECORD_TYPES = new Set(['AUDIT_LOG', 'HASH_LOG']);

// ── Helpers ───────────────────────────────────────────────────

function yearsAgo(years: number): Date {
  const d = new Date();
  d.setFullYear(d.getFullYear() - years);
  return d;
}

function retentionYearsFor(recordType: string): number {
  if (PERMANENT_RECORD_TYPES.has(recordType)) return Infinity;
  if (recordType === 'PATIENT') return config.retention.patientMinYears;
  return (RETENTION_YEARS as Record<string, number>)[recordType]
    ?? config.retention.patientMinYears;
}

// ── Agent ─────────────────────────────────────────────────────

export class RetentionAgent extends BaseAgent {
  readonly agentId = 'retention-agent-v1';
  readonly name = 'RetentionAgent';

  async execute(ctx: AgentContext): Promise<AgentResult> {
    // Only relevant for DELETE operations
    if (ctx.operation !== 'DELETE') return this.approve(ctx.payload);

    const deleteType = ctx.meta?.deleteType ?? 'soft';

    // ── Permanent records ─────────────────────────────────────
    if (PERMANENT_RECORD_TYPES.has(ctx.recordType)) {
      return this.reject(
        `${ctx.recordType} records are permanently immutable and cannot be deleted.`,
        ['RETENTION_BLOCK', 'PERMANENT_RECORD'],
      );
    }

    // ── Soft-DELETE: always allow ─────────────────────────────
    if (deleteType === 'soft') {
      return this.approve(ctx.payload, ['SOFT_DELETE_APPROVED']);
    }

    // ── Hard-DELETE: check minimum retention window ───────────
    const minYears = retentionYearsFor(ctx.recordType);

    if (!isFinite(minYears)) {
      return this.reject(
        `${ctx.recordType} records cannot be hard-deleted (retention: permanent).`,
        ['RETENTION_BLOCK', 'PERMANENT_RECORD'],
      );
    }

    const createdAt = ctx.existingRecord?.['_createdAt'];
    if (!createdAt) {
      return this.reject(
        'Cannot verify retention: _createdAt is missing from the existing record.',
        ['RETENTION_BLOCK'],
      );
    }

    const recordDate = new Date(createdAt as string | Date);
    const retentionBoundary = yearsAgo(minYears);

    if (recordDate > retentionBoundary) {
      const yearsOld = (Date.now() - recordDate.getTime()) / (365.25 * 24 * 3600 * 1000);
      return this.reject(
        `Hard-DELETE denied: ${ctx.recordType} must be retained for at least ` +
          `${minYears} years. Record is only ${yearsOld.toFixed(1)} years old.`,
        ['RETENTION_BLOCK'],
      );
    }

    return this.approve(ctx.payload, ['HARD_DELETE_APPROVED']);
  }
}
