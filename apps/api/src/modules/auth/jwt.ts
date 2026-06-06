import jwt from 'jsonwebtoken';
import { env } from '../../config/env.js';
import type { UserRole } from '@tewiz/shared-types';

export interface AccessTokenPayload {
  sub: string;          // user id
  role: UserRole;
  sid: string;          // session id
}

export function signAccessToken(payload: AccessTokenPayload): string {
  return jwt.sign(payload, env.JWT_ACCESS_SECRET, {
    expiresIn: env.JWT_ACCESS_TTL_SECONDS,
  });
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  return jwt.verify(token, env.JWT_ACCESS_SECRET) as AccessTokenPayload;
}

export function signRefreshToken(payload: { sub: string; sid: string }): string {
  return jwt.sign(payload, env.JWT_REFRESH_SECRET, {
    expiresIn: env.JWT_REFRESH_TTL_SECONDS,
  });
}

export function verifyRefreshToken(token: string): { sub: string; sid: string } {
  return jwt.verify(token, env.JWT_REFRESH_SECRET) as { sub: string; sid: string };
}
