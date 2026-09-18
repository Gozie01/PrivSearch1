// ─────────────────────────────────────────────────────────────
// ValidationAgent
//
// Runs BEFORE every CREATE or UPDATE in the pipeline.
// Responsibilities:
//   1. Check required fields are present for the given recordType.
//   2. Validate data-type constraints (ISO dates, enums, etc.).
//   3. Detect PII in fields that should not contain PII.
//   4. Sanitise the payload (trim whitespace, normalise dates).
// ─────────────────────────────────────────────────────────────
import { BaseAgent } from './base-agent';
import type { AgentContext, AgentResult } from './base-agent';
import { PATIENT_REQUIRED_FIELDS } from '../schemas/patient.schema';
import { RECORD_REQUIRED_FIELDS } from '../schemas/record.schema';
import { FILE_REQUIRED_FIELDS } from '../schemas/file-meta.schema';

// ── PII pattern (very conservative — flags any potential SSN / date-of-birth
//    appearing in unexpected free-text fields) ──────────────────────────────
const PII_PATTERNS: RegExp[] = [
  /\b\d{3}-\d{2}-\d{4}\b/,                         // SSN
  /\b\d{4}[- ]\d{4}[- ]\d{4}[- ]\d{4}\b/,          // credit card
  /\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/, // email
];

const UNEXPECTED_PII_FIELDS = new Set(['title', 'tags', 'metadata', 'notes']);

// ── Required-field maps ───────────────────────────────────────

const REQUIRED_FIELDS: Record<string, string[]> = {
  PATIENT: PATIENT_REQUIRED_FIELDS as string[],
  LAB_RESULT: RECORD_REQUIRED_FIELDS as string[],
  PRESCRIPTION: RECORD_REQUIRED_FIELDS as string[],
  DIAGNOSIS: RECORD_REQUIRED_FIELDS as string[],
  IMAGING: RECORD_REQUIRED_FIELDS as string[],
  NOTES: RECORD_REQUIRED_FIELDS as string[],
  PROCEDURE: RECORD_REQUIRED_FIELDS as string[],
  VACCINATION: RECORD_REQUIRED_FIELDS as string[],
  REFERRAL: RECORD_REQUIRED_FIELDS as string[],
  FILE: FILE_REQUIRED_FIELDS as string[],
};

// ── ISO date check ────────────────────────────────────────────

function isISODate(val: unknown): boolean {
  if (typeof val !== 'string') return false;
  const d = Date.parse(val);
  return !Number.isNaN(d);
}

// ── PII scan ──────────────────────────────────────────────────

function containsPII(text: string): boolean {
  return PII_PATTERNS.some((re) => re.test(text));
}

// ── Agent ─────────────────────────────────────────────────────

export class ValidationAgent extends BaseAgent {
  readonly agentId = 'validation-agent-v1';
  readonly name = 'ValidationAgent';

  async execute(ctx: AgentContext): Promise<AgentResult> {
    // Only validate mutating operations
    if (ctx.operation === 'READ') return this.approve(ctx.payload);
    if (ctx.operation === 'DELETE') return this.approve(ctx.payload);

    const flags: string[] = [];
    const payload = { ...ctx.payload };

    // 1. Required-field check (CREATE only — UPDATE uses a partial delta)
    if (ctx.operation === 'CREATE') {
      const required = REQUIRED_FIELDS[ctx.recordType] ?? [];
      const missing = required.filter(
        (f) => payload[f] === undefined || payload[f] === null || payload[f] === '',
      );
      if (missing.length > 0) {
        return this.reject(
          `Missing required fields for ${ctx.recordType}: ${missing.join(', ')}`,
        );
      }
    }

    // 2. Date-field validation (fields ending in 'At' or 'date' / 'Date')
    for (const [key, val] of Object.entries(payload)) {
      const isDateField =
        key.endsWith('At') ||
        key.toLowerCase().includes('date') ||
        key.toLowerCase().includes('timestamp');
      if (isDateField && val !== null && val !== undefined) {
        if (!isISODate(val)) {
          return this.reject(
            `Field '${key}' must be a valid ISO 8601 date string (received: ${val})`,
          );
        }
      }
    }

    // 3. PII scan on unexpected fields — stringify objects before scanning
    for (const field of UNEXPECTED_PII_FIELDS) {
      const val = payload[field];
      if (val === undefined || val === null) continue;
      const text = typeof val === 'string' ? val : JSON.stringify(val);
      if (containsPII(text)) {
        flags.push('SENSITIVE_FIELD_DETECTED');
        // We flag but do NOT reject — the AuditAgent will log this
        break;
      }
    }

    // 4. Sanitise strings (trim, no leading/trailing whitespace)
    for (const [key, val] of Object.entries(payload)) {
      if (typeof val === 'string') payload[key] = val.trim();
    }

    // 5. recordType-specific checks
    const typeError = this.validateRecordType(ctx.recordType, payload);
    if (typeError) return this.reject(typeError);

    return this.approve(payload, flags);
  }

  private validateRecordType(
    recordType: string,
    payload: Record<string, unknown>,
  ): string | null {
    switch (recordType) {
      case 'PATIENT': {
        const validGenders = [
          'MALE', 'FEMALE', 'NON_BINARY', 'OTHER', 'PREFER_NOT_TO_SAY',
        ];
        if (
          payload.gender &&
          !validGenders.includes(payload.gender as string)
        ) {
          return `Invalid gender value: ${payload.gender}`;
        }
        break;
      }
      case 'LAB_RESULT':
      case 'PRESCRIPTION':
      case 'DIAGNOSIS':
      case 'IMAGING':
      case 'NOTES':
      case 'PROCEDURE':
      case 'VACCINATION':
      case 'REFERRAL': {
        const validLevels = ['PUBLIC', 'RESTRICTED', 'CONFIDENTIAL', 'TOP_SECRET'];
        if (
          payload.confidentialityLevel &&
          !validLevels.includes(payload.confidentialityLevel as string)
        ) {
          return `Invalid confidentialityLevel: ${payload.confidentialityLevel}`;
        }
        break;
      }
    }
    return null;
  }
}
