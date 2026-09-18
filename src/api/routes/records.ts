// ─────────────────────────────────────────────────────────────
// Records routes — CRUD for patient records and medical records
//
// POST   /api/records          create a record
// GET    /api/records/:id      fetch one record
// GET    /api/records          query records
// PATCH  /api/records/:id      update (partial delta)
// DELETE /api/records/:id      soft-delete (default)
// GET    /api/records/:id/history  version history
// ─────────────────────────────────────────────────────────────
import { Router, Request, Response } from 'express';

import { authenticate } from '../middleware/auth';
import type { AuthRequest } from '../middleware/auth';
import { getServices } from '../middleware/services';
import { enforceRequestFreshness } from '../middleware/replay-protection';
import type { DeleteType } from '../../crud/delete';

export const recordsRouter = Router();

// ── POST /api/records ─────────────────────────────────────────
recordsRouter.post('/', authenticate, enforceRequestFreshness, async (req: Request, res: Response) => {
  const actor = (req as AuthRequest).principal;
  const { recordType, encryptedFields, ...payload } = req.body as {
    recordType?: string;
    encryptedFields?: string[];
    [key: string]: unknown;
  };

  if (!recordType) {
    return res.status(400).json({ error: 'recordType is required' });
  }

  try {
    const { createOp } = getServices();
    const result = await createOp.execute(
      payload,
      recordType,
      actor,
      { encryptedFields },
      { ip: req.ip, userAgent: req.get('User-Agent') },
    );
    return res.status(201).json(result);
  } catch (err: unknown) {
    return handleError(res, err);
  }
});

// ── GET /api/records/:id ──────────────────────────────────────
recordsRouter.get('/:id', authenticate, async (req: Request, res: Response) => {
  const actor = (req as AuthRequest).principal;
  const { id } = req.params;
  const decrypt = req.query.decrypt === 'true';
  const recordType = (req.query.recordType as string | undefined) ?? 'UNKNOWN';

  try {
    const { readOp } = getServices();
    const record = await readOp.findById(
      id,
      recordType,
      actor,
      {
        decryptedFields: decrypt ? (req.query.fields as string | undefined)?.split(',') : [],
        anonymise: actor.role === 'RESEARCHER',
      },
      { ip: req.ip, userAgent: req.get('User-Agent') },
    );
    if (!record) return res.status(404).json({ error: 'Record not found' });
    return res.json(record);
  } catch (err: unknown) {
    return handleError(res, err);
  }
});

// ── GET /api/records ──────────────────────────────────────────
recordsRouter.get('/', authenticate, async (req: Request, res: Response) => {
  const actor = (req as AuthRequest).principal;
  const {
    recordType,
    patientId,
    limit = '20',
    skip = '0',
    decrypt,
    ...queryRest
  } = req.query as Record<string, string | undefined>;

  const query: Record<string, unknown> = { ...queryRest };
  if (patientId) query.patientId = patientId;

  try {
    const { readOp } = getServices();
    const records = await readOp.findByQuery(
      query,
      recordType ?? 'UNKNOWN',
      actor,
      {
        decryptedFields: decrypt === 'true' ? [] : [],
        anonymise: actor.role === 'RESEARCHER',
      },
      { limit: parseInt(limit, 10), skip: parseInt(skip, 10) },
      { ip: req.ip, userAgent: req.get('User-Agent') },
    );
    return res.json({ records, count: records.length });
  } catch (err: unknown) {
    return handleError(res, err);
  }
});

// ── PATCH /api/records/:id ────────────────────────────────────
recordsRouter.patch('/:id', authenticate, enforceRequestFreshness, async (req: Request, res: Response) => {
  const actor = (req as AuthRequest).principal;
  const { id } = req.params;
  const { recordType, encryptedFields, ...delta } = req.body as {
    recordType?: string;
    encryptedFields?: string[];
    [key: string]: unknown;
  };

  if (!recordType) {
    return res.status(400).json({ error: 'recordType is required' });
  }

  try {
    const { updateOp } = getServices();
    const result = await updateOp.execute(
      id,
      delta,
      recordType,
      actor,
      { encryptedFields },
      { ip: req.ip, userAgent: req.get('User-Agent') },
    );
    return res.json(result);
  } catch (err: unknown) {
    return handleError(res, err);
  }
});

// ── DELETE /api/records/:id ───────────────────────────────────
recordsRouter.delete('/:id', authenticate, enforceRequestFreshness, async (req: Request, res: Response) => {
  const actor = (req as AuthRequest).principal;
  const { id } = req.params;
  const recordType = (req.query.recordType as string | undefined) ?? 'UNKNOWN';
  const deleteType: DeleteType =
    req.query.hard === 'true' ? 'hard' : 'soft';

  try {
    const { deleteOp } = getServices();
    const result = await deleteOp.execute(
      id,
      recordType,
      actor,
      deleteType,
      { ip: req.ip, userAgent: req.get('User-Agent') },
    );
    return res.json(result);
  } catch (err: unknown) {
    return handleError(res, err);
  }
});

// ── GET /api/records/:id/history ─────────────────────────────
recordsRouter.get('/:id/history', authenticate, async (req: Request, res: Response) => {
  const actor = (req as AuthRequest).principal;
  const { id } = req.params;

  // Require auditor-level or above for version history
  if (!['SUPER_ADMIN', 'ADMIN', 'AUDITOR', 'PHYSICIAN'].includes(actor.role)) {
    return res.status(403).json({ error: 'Insufficient permissions for version history' });
  }

  try {
    const { documentStore } = getServices();
    const history = await documentStore.getVersionHistory(id);
    return res.json({ id, versions: history });
  } catch (err: unknown) {
    return handleError(res, err);
  }
});

// ── Error handler ─────────────────────────────────────────────

function handleError(res: Response, err: unknown): Response {
  const e = err as { message?: string; statusCode?: number; flags?: string[] };
  const status = e.statusCode ?? 500;
  return res.status(status).json({
    error: e.message ?? 'Internal server error',
    flags: e.flags,
  });
}
