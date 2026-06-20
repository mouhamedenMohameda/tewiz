import type { Request, Response, NextFunction, RequestHandler } from 'express';
import type { UserRole } from '@tewiz/shared-types';
import { verifyAccessToken } from '../modules/auth/jwt.js';
import { HttpError } from './error.js';
import { bumpHeartbeat } from './heartbeat.js';

/**
 * Augment Express.Request so `req.user` is statically known across the
 * codebase. The field is optional in the type (because unauthenticated
 * routes never attach it) but every handler downstream of requireAuth /
 * requireRole can rely on it being set — `req.user!` or AuthedRequest
 * for an explicit non-nullable view.
 *
 * This kills the dozens of `(req as AuthedRequest)` casts that TS rightly
 * complained about (generic Request types didn't structurally overlap
 * with the extended interface).
 */
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: { id: string; role: UserRole; sid: string };
    }
  }
}

export interface AuthedRequest extends Request {
  user: { id: string; role: UserRole; sid: string };
}

/**
 * Extracts and verifies the bearer token, then attaches `req.user`.
 * Throws 401 if missing or invalid.
 */
export const requireAuth: RequestHandler = (req, _res, next) => {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return next(new HttpError(401, 'no_token', 'Missing bearer token'));
  }
  const token = header.slice(7);
  try {
    const payload = verifyAccessToken(token);
    // JWT standard claim is `sub` for the subject (user id). Expose it
    // as `id` on req.user for ergonomic access in route handlers.
    req.user! = {
      id: payload.sub,
      role: payload.role,
      sid: payload.sid,
    };
    bumpHeartbeat(payload.sub);
    next();
  } catch {
    next(new HttpError(401, 'invalid_token', 'Token invalid or expired'));
  }
};

/**
 * Use AFTER requireAuth. Restricts the route to the given roles.
 */
export function requireRole(...roles: UserRole[]): RequestHandler {
  return (req, _res, next) => {
    const user = req.user!;
    if (!user) return next(new HttpError(401, 'no_token', 'Not authenticated'));
    if (!roles.includes(user.role)) {
      return next(new HttpError(403, 'forbidden', `Required role: ${roles.join(', ')}`));
    }
    next();
  };
}
