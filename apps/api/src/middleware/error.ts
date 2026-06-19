import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';
import { env } from '../config/env.js';
import { StorageNotFoundError } from '../modules/storage/storage.js';

export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export const notFound: RequestHandler = (req, res) => {
  res.status(404).json({ error: { code: 'not_found', message: `No route for ${req.method} ${req.path}` } });
};

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  if (err instanceof ZodError) {
    res.status(400).json({
      error: {
        code: 'validation_error',
        message: 'Invalid request',
        issues: err.issues,
      },
    });
    return;
  }

  if (err instanceof StorageNotFoundError) {
    // Log the missing key so the operator can correlate (was the file
    // wiped on redeploy? wrong UPLOAD_DIR? key mismatch?).
    req.log?.warn({ key: err.key }, 'storage: file missing');
    res.status(404).json({
      error: { code: 'file_missing', message: 'File not found in storage', details: { key: err.key } },
    });
    return;
  }

  if (err instanceof HttpError) {
    res.status(err.status).json({
      error: { code: err.code, message: err.message, details: err.details },
    });
    return;
  }

  req.log?.error({ err }, 'unhandled error');
  // In dev we expose the real message + stack so the client/curl can see what
  // actually broke. In prod we keep the generic message to avoid leaking
  // internals (DB names, file paths, etc.).
  const e = err as { message?: string; stack?: string; code?: string; name?: string };
  if (env.NODE_ENV !== 'production') {
    res.status(500).json({
      error: {
        code: 'internal_error',
        message: e.message ?? 'Something went wrong',
        debug: {
          name: e.name,
          dbCode: e.code,                      // pg / redis driver code (e.g. ECONNREFUSED, 28P01)
          stack: e.stack?.split('\n').slice(0, 5).join('\n'),
        },
      },
    });
    return;
  }
  res.status(500).json({
    error: { code: 'internal_error', message: 'Something went wrong' },
  });
};
