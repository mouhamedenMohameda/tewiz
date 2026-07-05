import type { Request, Response, NextFunction, RequestHandler } from 'express';
import type { UserRole, AdminRole } from '@tewiz/shared-types';
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
      user?: {
        id: string;
        role: UserRole;
        adminRole: AdminRole | null;
        sid: string;
      };
    }
  }
}

export interface AuthedRequest extends Request {
  user: {
    id: string;
    role: UserRole;
    adminRole: AdminRole | null;
    sid: string;
  };
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
      adminRole: payload.adminRole ?? null,
      sid: payload.sid,
    };
    bumpHeartbeat(payload.sub);
    next();
  } catch {
    next(new HttpError(401, 'invalid_token', 'Token invalid or expired'));
  }
};

/**
 * Like requireAuth but silent — attaches req.user if a valid token is
 * present, otherwise continues without error.
 */
export const optionalAuth: RequestHandler = (req, _res, next) => {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return next();
  const token = header.slice(7);
  try {
    const payload = verifyAccessToken(token);
    req.user = {
      id: payload.sub,
      role: payload.role,
      adminRole: payload.adminRole ?? null,
      sid: payload.sid,
    };
    bumpHeartbeat(payload.sub);
  } catch {
    // ignore invalid token — treat as unauthenticated
  }
  next();
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

/**
 * Use AFTER requireAuth. Restricts a route to admins with one of the given
 * sub-roles. super_admin implicitly passes every check.
 */
export function requireAdminRole(...adminRoles: AdminRole[]): RequestHandler {
  return (req, _res, next) => {
    const user = req.user!;
    if (!user) return next(new HttpError(401, 'no_token', 'Not authenticated'));
    if (user.role !== 'admin' || !user.adminRole) {
      return next(new HttpError(403, 'forbidden', 'Admin access required'));
    }
    if (user.adminRole === 'super_admin') return next();
    if (!adminRoles.includes(user.adminRole)) {
      return next(
        new HttpError(403, 'forbidden', `Required admin role: ${adminRoles.join(', ')}`),
      );
    }
    next();
  };
}

/**
 * Convenience guard for whole sub-routers where the read/write permissions
 * differ — GET/HEAD use viewRoles, everything else uses actionRoles. Both
 * lists pass through requireAdminRole, so super_admin always wins.
 */
export function requireAdminRoleByMethod(
  viewRoles: AdminRole[],
  actionRoles: AdminRole[],
): RequestHandler {
  return (req, res, next) => {
    const isView = req.method === 'GET' || req.method === 'HEAD';
    const roles = isView ? viewRoles : actionRoles;
    return requireAdminRole(...roles)(req, res, next);
  };
}
