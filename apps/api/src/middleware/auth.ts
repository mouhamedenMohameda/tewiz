import type { Request, Response, NextFunction, RequestHandler } from 'express';
import type { UserRole } from '@tewiz/shared-types';
import { verifyAccessToken } from '../modules/auth/jwt.js';
import { HttpError } from './error.js';

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
    (req as AuthedRequest).user = {
      id: payload.sub,
      role: payload.role,
      sid: payload.sid,
    };
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
    const user = (req as AuthedRequest).user;
    if (!user) return next(new HttpError(401, 'no_token', 'Not authenticated'));
    if (!roles.includes(user.role)) {
      return next(new HttpError(403, 'forbidden', `Required role: ${roles.join(', ')}`));
    }
    next();
  };
}
