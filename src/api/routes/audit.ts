// ─────────────────────────────────────────────────────────────
// Audit routes — blockchain + hash-log queries
//
// GET /api/audit/record/:id      full provenance of one record
// GET /api/audit/tx/:txId        look up a specific transaction
// GET /api/audit/chain/validate  integrity report of the chain
// GET /api/audit/chain/stats     chain length + pending txs
// GET /api/audit/anchor/status   anchor scheduler state
// POST /api/audit/anchor/policy  switch fixed/adaptive anchoring
// POST /api/audit/anchor/flush   wait for queue drain
// GET /api/audit/security/replay-status replay cache state
// GET /api/audit/logs            MongoDB hash-log query
// ─────────────────────────────────────────────────────────────
import { Router, Request, Response } from 'express';

import { authenticate } from '../middleware/auth';
import type { AuthRequest } from '../middleware/auth';
import { requirePermission } from '../../access/rbac';
import { getServices } from '../middleware/services';

export const auditRouter = Router();

// ── GET /api/audit/record/:id ─────────────────────────────────
auditRouter.get('/record/:id', authenticate, async (req: Request, res: Response) => {
  const actor = (req as AuthRequest).principal;
  try {
    requirePermission(actor.role, 'audit:read');
  } catch {
    return res.status(403).json({ error: 'Insufficient permissions' });
  }

  const { id } = req.params;
  const { chainValidator } = getServices();
  const history = chainValidator.verifyRecord(id);
  return res.json({ recordId: id, transactionCount: history.length, history });
});

// ── GET /api/audit/tx/:txId ───────────────────────────────────
auditRouter.get('/tx/:txId', authenticate, async (req: Request, res: Response) => {
  const actor = (req as AuthRequest).principal;
  try {
    requirePermission(actor.role, 'audit:read');
  } catch {
    return res.status(403).json({ error: 'Insufficient permissions' });
  }

  const { txId } = req.params;
  const { chainValidator } = getServices();
  const result = chainValidator.findTransaction(txId);
  if (!result.found) {
    return res.status(404).json({ error: 'Transaction not found' });
  }
  return res.json({
    transactionId: txId,
    blockIndex: result.block?.index,
    tx: result.tx,
  });
});

// ── GET /api/audit/chain/validate ─────────────────────────────
auditRouter.get('/chain/validate', authenticate, async (req: Request, res: Response) => {
  const actor = (req as AuthRequest).principal;
  try {
    requirePermission(actor.role, 'blockchain:read');
  } catch {
    return res.status(403).json({ error: 'Insufficient permissions' });
  }

  const { chainValidator } = getServices();
  const report = chainValidator.validateChain();
  return res.status(report.valid ? 200 : 409).json(report);
});

// ── GET /api/audit/chain/stats ────────────────────────────────
auditRouter.get('/chain/stats', authenticate, async (req: Request, res: Response) => {
  const actor = (req as AuthRequest).principal;
  try {
    requirePermission(actor.role, 'blockchain:read');
  } catch {
    return res.status(403).json({ error: 'Insufficient permissions' });
  }

  const { chain, consensus } = getServices();
  return res.json({
    chainLength: chain.getChainLength(),
    lastBlock: chain.getLastBlock(),
    pendingTransactions: consensus.getPendingCount(),
    anchor: chain.getAnchorStatus(),
  });
});

auditRouter.get('/anchor/status', authenticate, async (req: Request, res: Response) => {
  const actor = (req as AuthRequest).principal;
  try {
    requirePermission(actor.role, 'blockchain:read');
  } catch {
    return res.status(403).json({ error: 'Insufficient permissions' });
  }

  const { chain } = getServices();
  return res.json(chain.getAnchorStatus());
});

auditRouter.get('/anchor/sealing-config', authenticate, async (req: Request, res: Response) => {
  const actor = (req as AuthRequest).principal;
  try {
    requirePermission(actor.role, 'blockchain:read');
  } catch {
    return res.status(403).json({ error: 'Insufficient permissions' });
  }

  const { consensus } = getServices();
  return res.json(consensus.getSealingConfig());
});

auditRouter.post('/anchor/sealing-config', authenticate, async (req: Request, res: Response) => {
  const actor = (req as AuthRequest).principal;
  try {
    requirePermission(actor.role, 'system:bypass');
  } catch {
    return res.status(403).json({ error: 'Insufficient permissions' });
  }

  const body = (req.body as { blockIntervalMs?: number; maxTxPerBlock?: number } | undefined) || {};
  const { consensus } = getServices();
  return res.json(consensus.setSealingConfig(body));
});

auditRouter.post('/anchor/seal-now', authenticate, async (req: Request, res: Response) => {
  const actor = (req as AuthRequest).principal;
  try {
    requirePermission(actor.role, 'system:bypass');
  } catch {
    return res.status(403).json({ error: 'Insufficient permissions' });
  }

  const { consensus, chain } = getServices();
  await consensus.sealNow();
  return res.json({
    pendingTransactions: consensus.getPendingCount(),
    anchor: chain.getAnchorStatus(),
  });
});

auditRouter.post('/anchor/policy', authenticate, async (req: Request, res: Response) => {
  const actor = (req as AuthRequest).principal;
  try {
    requirePermission(actor.role, 'system:bypass');
  } catch {
    return res.status(403).json({ error: 'Insufficient permissions' });
  }

  const mode = (req.body as { mode?: string } | undefined)?.mode;
  if (mode !== 'fixed' && mode !== 'adaptive') {
    return res.status(400).json({ error: 'mode must be fixed or adaptive' });
  }

  const { chain } = getServices();
  const appliedMode = chain.setAnchorMode(mode);
  return res.json({
    mode: appliedMode,
    anchor: chain.getAnchorStatus(),
  });
});

auditRouter.post('/anchor/flush', authenticate, async (req: Request, res: Response) => {
  const actor = (req as AuthRequest).principal;
  try {
    requirePermission(actor.role, 'system:bypass');
  } catch {
    return res.status(403).json({ error: 'Insufficient permissions' });
  }

  const timeoutMs = Number((req.body as { timeoutMs?: number } | undefined)?.timeoutMs ?? 120000);
  const { chain } = getServices();
  const drained = await chain.flushAnchors(timeoutMs);
  return res.status(drained ? 200 : 202).json({
    drained,
    anchor: chain.getAnchorStatus(),
  });
});

auditRouter.get('/security/replay-status', authenticate, async (req: Request, res: Response) => {
  const actor = (req as AuthRequest).principal;
  try {
    requirePermission(actor.role, 'audit:read');
  } catch {
    return res.status(403).json({ error: 'Insufficient permissions' });
  }

  const { replayProtection } = getServices();
  return res.json(replayProtection.getStatus());
});

// ── GET /api/audit/logs ───────────────────────────────────────
auditRouter.get('/logs', authenticate, async (req: Request, res: Response) => {
  const actor = (req as AuthRequest).principal;
  try {
    requirePermission(actor.role, 'audit:read');
  } catch {
    return res.status(403).json({ error: 'Insufficient permissions' });
  }

  const {
    recordId,
    actorDID,
    operation,
    limit = '50',
    skip = '0',
  } = req.query as Record<string, string | undefined>;

  const query: Record<string, unknown> = {};
  if (recordId) query.recordId = recordId;
  if (actorDID) query.actorDID = actorDID;
  if (operation) query.operation = operation;

  const { hashLogStore } = getServices();
  const logs = await hashLogStore.findByQuery(query, {
    limit: Math.min(parseInt(limit, 10), 200),
    skip: parseInt(skip, 10),
    includeDeleted: true,
  });

  return res.json({ logs, count: logs.length });
});
