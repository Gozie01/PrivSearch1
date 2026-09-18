// ─────────────────────────────────────────────────────────────
// Auth middleware — JWT extraction and principal injection
// ─────────────────────────────────────────────────────────────
import { Request, Response, NextFunction } from 'express';
import { verifySessionToken, principalFromPayload } from '../../access/did-auth';
import type { Principal } from '../../access/rbac';

export interface AuthRequest extends Request {
  principal: Principal;
}

export function authenticate(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing or invalid Authorization header' });
    return;
  }

  const token = authHeader.slice(7);
  try {
    const payload = verifySessionToken(token);
    (req as AuthRequest).principal = principalFromPayload(payload);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}
