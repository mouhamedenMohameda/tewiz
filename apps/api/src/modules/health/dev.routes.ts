import { Router } from 'express';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { HttpError } from '../../middleware/error.js';
import { getMockMessages } from '../auth/sms.js';

// Dev-only endpoints. Disabled outside NODE_ENV=development.
export const devRouter = Router();

devRouter.use((_req, _res, next) => {
  if (env.NODE_ENV !== 'development') {
    return next(new HttpError(404, 'not_found', 'Not found'));
  }
  next();
});

const q = z.object({ phone: z.string() });

/**
 * GET /dev/mock-sms?phone=+222...
 * Returns recent mock SMS messages sent to this number.
 */
devRouter.get('/mock-sms', (req, res) => {
  const { phone } = q.parse(req.query);
  res.json(getMockMessages(phone));
});
