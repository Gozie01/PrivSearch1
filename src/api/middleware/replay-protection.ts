import type { NextFunction, Request, Response } from 'express';

import type { AuthRequest } from './auth';
import { getServices } from './services';
import { config } from '../../config';

type ReplayProtectionMode = 'off' | 'optional' | 'required';

interface CacheEntry {
  expiresAt: number;
  firstSeenAt: number;
}

export interface ReplayProtectionStatus {
  mode: ReplayProtectionMode;
  ttlMs: number;
  allowedSkewMs: number;
  cacheSize: number;
  totalAccepted: number;
  totalRejected: number;
  totalOptionalBypasses: number;
}

function normalizeMode(mode: string): ReplayProtectionMode {
  if (mode === 'off' || mode === 'required') {
    return mode;
  }
  return 'optional';
}

function parseTimestamp(raw: string): number | null {
  const numeric = Number(raw);
  if (Number.isFinite(numeric) && numeric > 0) {
    return numeric;
  }

  const parsed = Date.parse(raw);
  return Number.isNaN(parsed) ? null : parsed;
}

export class ReplayProtection {
  private readonly cache = new Map<string, CacheEntry>();
  private totalAccepted = 0;
  private totalRejected = 0;
  private totalOptionalBypasses = 0;
  private readonly mode: ReplayProtectionMode;

  constructor() {
    this.mode = normalizeMode(config.replayProtection.mode);
  }

  evaluate(request: {
    principalDid: string;
    method: string;
    path: string;
    nonce?: string;
    timestamp?: string;
  }): { ok: true } | { ok: false; statusCode: number; body: Record<string, unknown> } {
    if (this.mode === 'off') {
      return { ok: true };
    }

    this.evictExpired();

    const nonce = request.nonce?.trim();
    const timestamp = request.timestamp?.trim();
    if (!nonce || !timestamp) {
      if (this.mode === 'optional') {
        this.totalOptionalBypasses += 1;
        return { ok: true };
      }

      this.totalRejected += 1;
      return {
        ok: false,
        statusCode: 400,
        body: {
          error: 'Replay protection headers are required',
          code: 'REPLAY_HEADERS_REQUIRED',
        },
      };
    }

    const timestampMs = parseTimestamp(timestamp);
    if (timestampMs === null) {
      this.totalRejected += 1;
      return {
        ok: false,
        statusCode: 400,
        body: {
          error: 'Invalid X-Request-Timestamp header',
          code: 'REPLAY_TIMESTAMP_INVALID',
        },
      };
    }

    const now = Date.now();
    if (Math.abs(now - timestampMs) > config.replayProtection.allowedSkewMs) {
      this.totalRejected += 1;
      return {
        ok: false,
        statusCode: 408,
        body: {
          error: 'Request freshness window expired',
          code: 'REPLAY_TIMESTAMP_EXPIRED',
        },
      };
    }

    const key = [
      request.principalDid,
      request.method.toUpperCase(),
      request.path,
      nonce,
    ].join(':');

    if (this.cache.has(key)) {
      this.totalRejected += 1;
      return {
        ok: false,
        statusCode: 409,
        body: {
          error: 'Replay detected for nonce-bound request',
          code: 'REPLAY_DETECTED',
        },
      };
    }

    this.ensureCapacity();
    this.cache.set(key, {
      firstSeenAt: now,
      expiresAt: now + config.replayProtection.ttlMs,
    });
    this.totalAccepted += 1;
    return { ok: true };
  }

  getStatus(): ReplayProtectionStatus {
    this.evictExpired();
    return {
      mode: this.mode,
      ttlMs: config.replayProtection.ttlMs,
      allowedSkewMs: config.replayProtection.allowedSkewMs,
      cacheSize: this.cache.size,
      totalAccepted: this.totalAccepted,
      totalRejected: this.totalRejected,
      totalOptionalBypasses: this.totalOptionalBypasses,
    };
  }

  private evictExpired(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache.entries()) {
      if (entry.expiresAt <= now) {
        this.cache.delete(key);
      }
    }
  }

  private ensureCapacity(): void {
    if (this.cache.size < config.replayProtection.maxEntries) {
      return;
    }

    let oldestKey: string | null = null;
    let oldestSeenAt = Number.POSITIVE_INFINITY;
    for (const [key, entry] of this.cache.entries()) {
      if (entry.firstSeenAt < oldestSeenAt) {
        oldestSeenAt = entry.firstSeenAt;
        oldestKey = key;
      }
    }
    if (oldestKey) {
      this.cache.delete(oldestKey);
    }
  }
}

export function enforceRequestFreshness(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method.toUpperCase())) {
    next();
    return;
  }

  const principal = (req as Partial<AuthRequest>).principal;
  if (!principal?.did) {
    next();
    return;
  }

  const { replayProtection } = getServices();
  const decision = replayProtection.evaluate({
    principalDid: principal.did,
    method: req.method,
    path: req.path,
    nonce: req.get('X-Request-Nonce') ?? undefined,
    timestamp: req.get('X-Request-Timestamp') ?? undefined,
  });

  if (!decision.ok) {
    res.status(decision.statusCode).json(decision.body);
    return;
  }

  next();
}
