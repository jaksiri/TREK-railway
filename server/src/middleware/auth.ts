import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { db } from '../db/database';
import { JWT_SECRET } from '../config';
import { AuthRequest, OptionalAuthRequest, User } from '../types';

export function extractToken(req: Request): string | null {
  // Prefer httpOnly cookie; fall back to Authorization: Bearer (MCP, API clients)
  const cookieToken = (req as any).cookies?.trek_session;
  if (cookieToken) return cookieToken;
  const authHeader = req.headers['authorization'];
  return (authHeader && authHeader.split(' ')[1]) || null;
}

function verifyJwtAndLoadUser(token: string): User | null {
  try {
    const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] }) as { id: number };
    const user = db.prepare(
      'SELECT id, username, email, role FROM users WHERE id = ?'
    ).get(decoded.id) as User | undefined;
    return user ?? null;
  } catch {
    return null;
  }
}

const authenticate = (req: Request, res: Response, next: NextFunction): void => {
  const token = extractToken(req);

  if (!token) {
    res.status(401).json({ error: 'Access token required', code: 'AUTH_REQUIRED' });
    return;
  }

  const user = verifyJwtAndLoadUser(token);
  if (!user) {
    res.status(401).json({ error: 'Invalid or expired token', code: 'AUTH_REQUIRED' });
    return;
  }
  (req as AuthRequest).user = user;
  next();
};

/** Like `authenticate` but rejects requests that don't carry an httpOnly session cookie.
 *  Used on state-mutating OAuth endpoints (consent POST, client CRUD, session revoke)
 *  to prevent Bearer JWT tokens obtained by other means from managing OAuth clients. */
const requireCookieAuth = (req: Request, res: Response, next: NextFunction): void => {
  const cookieToken = (req as any).cookies?.trek_session;
  if (!cookieToken) {
    res.status(401).json({ error: 'Cookie session required for this endpoint', code: 'COOKIE_AUTH_REQUIRED' });
    return;
  }
  const user = verifyJwtAndLoadUser(cookieToken);
  if (!user) {
    res.status(401).json({ error: 'Invalid or expired session', code: 'AUTH_REQUIRED' });
    return;
  }
  (req as AuthRequest).user = user;
  next();
};

const optionalAuth = (req: Request, res: Response, next: NextFunction): void => {
  const token = extractToken(req);

  if (!token) {
    (req as OptionalAuthRequest).user = null;
    return next();
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] }) as { id: number };
    const user = db.prepare(
      'SELECT id, username, email, role FROM users WHERE id = ?'
    ).get(decoded.id) as User | undefined;
    (req as OptionalAuthRequest).user = user || null;
  } catch (err: unknown) {
    (req as OptionalAuthRequest).user = null;
  }
  next();
};

const adminOnly = (req: Request, res: Response, next: NextFunction): void => {
  const authReq = req as AuthRequest;
  if (!authReq.user || authReq.user.role !== 'admin') {
    res.status(403).json({ error: 'Admin access required' });
    return;
  }
  next();
};

const demoUploadBlock = (req: Request, res: Response, next: NextFunction): void => {
  const authReq = req as AuthRequest;
  if (process.env.DEMO_MODE === 'true' && authReq.user?.email === 'demo@nomad.app') {
    res.status(403).json({ error: 'Uploads are disabled in demo mode. Self-host NOMAD for full functionality.' });
    return;
  }
  next();
};

export { authenticate, requireCookieAuth, optionalAuth, adminOnly, demoUploadBlock };
