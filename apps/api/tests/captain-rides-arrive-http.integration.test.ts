import express from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HttpError } from '../src/middleware/error.js';

const { arriveRideMock } = vi.hoisted(() => ({
  arriveRideMock: vi.fn(),
}));

vi.mock('../src/modules/rides/rides.service.js', () => ({
  arriveRide: arriveRideMock,
}));

import { captainRidesRouter } from '../src/modules/rides/captain-rides.routes.js';

let server: ReturnType<express.Application['listen']> | null = null;

function buildApp() {
  const app = express();
  app.use(express.json());

  // Inject an authenticated captain user for this route-level integration test.
  app.use((req, _res, next) => {
    (req as any).user = { id: 'captain-http-1', role: 'captain' };
    next();
  });

  app.use('/captain/rides', captainRidesRouter);

  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (err instanceof HttpError) {
      res.status(err.status).json({ error: { code: err.code, message: err.message } });
      return;
    }
    res.status(500).json({ error: { code: 'internal_error', message: 'Internal Server Error' } });
  });

  return app;
}

async function listen(app: express.Application): Promise<number> {
  return await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', () => {
      const addr = server!.address();
      if (!addr || typeof addr === 'string') throw new Error('Cannot resolve test server port');
      resolve(addr.port);
    });
  });
}

describe('captain rides arrive route http integration', () => {
  beforeEach(() => {
    arriveRideMock.mockReset();
  });

  afterEach(async () => {
    if (!server) return;
    await new Promise<void>((resolve, reject) => {
      server!.close((err) => (err ? reject(err) : resolve()));
    });
    server = null;
  });

  it('POST /captain/rides/:id/arrive forwards captain id and returns service payload', async () => {
    arriveRideMock.mockResolvedValue({ id: 'ride-open-http', status: 'in_progress', isOpen: true });

    const app = buildApp();
    const port = await listen(app);

    const response = await fetch(`http://127.0.0.1:${port}/captain/rides/ride-open-http/arrive`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ id: 'ride-open-http', status: 'in_progress', isOpen: true });
    expect(arriveRideMock).toHaveBeenCalledTimes(1);
    expect(arriveRideMock).toHaveBeenCalledWith('ride-open-http', 'captain-http-1');
  });
});
