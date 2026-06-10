import type { Request, Response, NextFunction } from 'express';
import { countUsageThisMonth, findKeyByHash, hashKey, touchLastUsed, type ApiKeyRow } from '../db/keys.js';

// Augment the Express namespace (declared globally by @types/express).
// Using `declare global { namespace Express ... }` avoids the
// "express-serve-static-core cannot be found" error that occurs with
// pnpm's non-hoisted layout when emitting declarations.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      apiKey?: ApiKeyRow;
    }
  }
}

export async function requireApiKey(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const raw =
    (req.header('x-api-key') ?? req.header('authorization')?.replace(/^Bearer\s+/i, '') ?? '')
      .trim();

  if (!raw) {
    res.status(401).json({ error: 'missing_api_key', message: 'Provide X-API-Key header.' });
    return;
  }

  const key = await findKeyByHash(hashKey(raw));
  if (!key || !key.is_active) {
    res.status(401).json({ error: 'invalid_api_key' });
    return;
  }

  if (key.monthly_quota > 0) {
    const used = await countUsageThisMonth(key.id);
    if (used >= key.monthly_quota) {
      res.status(429).json({
        error: 'quota_exceeded',
        message: `Monthly quota of ${key.monthly_quota} requests reached.`,
        used,
      });
      return;
    }
  }

  // Fire-and-forget; don't block the request on a write.
  touchLastUsed(key.id).catch(() => undefined);
  req.apiKey = key;
  next();
}
