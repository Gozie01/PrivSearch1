// ─────────────────────────────────────────────────────────────
// Auth routes — DID challenge-response + JWT issuance
//
// POST /api/auth/challenge   — request a nonce for a DID
// POST /api/auth/verify      — submit signed nonce → get JWT
// GET  /api/auth/me          — decode current session
// POST /api/auth/register    — register a new DID (admin only)
// ─────────────────────────────────────────────────────────────
import { Router, Request, Response, NextFunction } from 'express';
import crypto from 'crypto';

import { getDb } from '../middleware/db';
import { authenticate } from '../middleware/auth';
import type { AuthRequest } from '../middleware/auth';
import {
  generateChallenge,
  verifyChallenge,
  issueSessionToken,
  deriveDidFromPublicKey,
} from '../../access/did-auth';
import { requirePermission } from '../../access/rbac';
import type { Role } from '../../access/rbac';
import type { DIDDocument } from '../../access/did-auth';

export const authRouter = Router();

// In-memory nonce store (replace with Redis TTL in production)
const challengeStore = new Map<string, { nonce: string; expiresAt: number }>();

// ── POST /api/auth/challenge ──────────────────────────────────
authRouter.post('/challenge', async (req: Request, res: Response) => {
  const { did } = req.body as { did?: string };
  if (!did || typeof did !== 'string') {
    return res.status(400).json({ error: 'did is required' });
  }

  const nonce = generateChallenge();
  // Nonce is valid for 5 minutes
  challengeStore.set(did, { nonce, expiresAt: Date.now() + 5 * 60_000 });

  return res.json({ did, nonce, expiresAt: challengeStore.get(did)!.expiresAt });
});

// ── POST /api/auth/verify ─────────────────────────────────────
authRouter.post('/verify', async (req: Request, res: Response) => {
  const { did, signature } = req.body as { did?: string; signature?: string };

  if (!did || !signature) {
    return res.status(400).json({ error: 'did and signature are required' });
  }

  const entry = challengeStore.get(did);
  if (!entry || Date.now() > entry.expiresAt) {
    challengeStore.delete(did);
    return res.status(401).json({ error: 'Challenge expired or not found' });
  }

  // Fetch the DID document from MongoDB
  const db = getDb();
  const identity = await db
    .collection<DIDDocument>('identities')
    .findOne({ did });

  if (!identity || !identity.isActive) {
    return res.status(401).json({ error: 'DID not registered or inactive' });
  }

  const valid = verifyChallenge(entry.nonce, signature, identity.publicKeyPem);
  challengeStore.delete(did); // consume nonce immediately

  if (!valid) {
    return res.status(401).json({ error: 'Signature verification failed' });
  }

  const token = issueSessionToken(did, identity.role);
  return res.json({ token, role: identity.role, did });
});

// ── GET /api/auth/me ──────────────────────────────────────────
authRouter.get('/me', authenticate, (req: Request, res: Response) => {
  return res.json({ principal: (req as AuthRequest).principal });
});

// ── POST /api/auth/register ───────────────────────────────────
authRouter.post(
  '/register',
  authenticate,
  async (req: Request, res: Response) => {
    const actor = (req as AuthRequest).principal;

    try {
      requirePermission(actor.role, 'admin:users');
    } catch {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    const { publicKeyPem, role, label } = req.body as {
      publicKeyPem?: string;
      role?: Role;
      label?: string;
    };

    if (!publicKeyPem || !role) {
      return res.status(400).json({ error: 'publicKeyPem and role are required' });
    }

    // Validate PEM
    try {
      crypto.createPublicKey(publicKeyPem);
    } catch {
      return res.status(400).json({ error: 'Invalid publicKeyPem' });
    }

    const did = deriveDidFromPublicKey(publicKeyPem);

    const db = getDb();
    const existing = await db.collection('identities').findOne({ did });
    if (existing) {
      return res.status(409).json({ error: 'DID already registered', did });
    }

    const doc: DIDDocument = {
      did,
      publicKeyPem,
      role,
      createdAt: Date.now(),
      isActive: true,
      label,
    };

    await db.collection('identities').insertOne(doc);
    return res.status(201).json({ did, role });
  },
);
