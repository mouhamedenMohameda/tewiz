import pino from 'pino';
import { env } from '../config/env.js';

/**
 * Single shared logger for the whole API. Lives here (not in index.ts) so
 * infrastructure modules like the DB pool can log through the same instance
 * and formatting — e.g. slow-query warnings show up in the same stream as
 * request logs.
 */
export const logger = pino({
  level: env.NODE_ENV === 'production' ? 'info' : 'debug',
  transport:
    env.NODE_ENV === 'production'
      ? undefined
      : { target: 'pino-pretty', options: { colorize: true } },
});
