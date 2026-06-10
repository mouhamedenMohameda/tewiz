import type { Request, Response, NextFunction } from 'express';

export function notFound(_req: Request, res: Response): void {
  res.status(404).json({ error: 'not_found' });
}

export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  const message = err instanceof Error ? err.message : 'unknown_error';
  req.log?.error({ err }, message);
  if (res.headersSent) return;
  res.status(500).json({ error: 'internal_error', message });
}
