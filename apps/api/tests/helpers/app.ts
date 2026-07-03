import express from 'express';
import type { Server } from 'node:http';
import { errorHandler, notFound } from '../../src/middleware/error.js';

/**
 * Shared harness for route-level HTTP tests.
 *
 * Mounts a router on a throwaway express app with the REAL error handler,
 * optionally injecting an authenticated user (so routers that expect
 * requireAuth to have run upstream can be tested in isolation, mirroring
 * how they are mounted under captainRouter / riderRouter / adminRouter).
 */
export interface TestUser {
  id: string;
  role: 'rider' | 'captain' | 'admin';
  adminRole?: string | null;
  sid?: string;
}

export interface TestAppHandle {
  baseUrl: string;
  close: () => Promise<void>;
}

export async function startTestApp(
  mountPath: string,
  router: express.Router,
  user?: TestUser | null,
): Promise<TestAppHandle> {
  const app = express();
  app.use(express.json());

  if (user) {
    app.use((req, _res, next) => {
      req.user = {
        id: user.id,
        role: user.role,
        adminRole: (user.adminRole ?? null) as never,
        sid: user.sid ?? 'sid-test',
      };
      next();
    });
  }

  app.use(mountPath, router);
  app.use(notFound);
  app.use(errorHandler);

  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const addr = server.address();
  if (!addr || typeof addr === 'string') throw new Error('Cannot resolve test server port');

  return {
    baseUrl: `http://127.0.0.1:${addr.port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}

/** JSON request helper: returns { status, body }. */
export async function api(
  baseUrl: string,
  method: string,
  path: string,
  body?: unknown,
  headers?: Record<string, string>,
): Promise<{ status: number; body: any }> {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let parsed: any = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }
  return { status: res.status, body: parsed };
}
