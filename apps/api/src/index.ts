import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import pinoHttp from 'pino-http';
import pino from 'pino';
import { env } from './config/env.js';
import { healthRouter } from './modules/health/health.routes.js';
import { devRouter } from './modules/health/dev.routes.js';
import { authRouter } from './modules/auth/auth.routes.js';
import { captainRouter } from './modules/captain/captain.routes.js';
import { riderRouter } from './modules/rider/rider.routes.js';
import { adminRouter } from './modules/admin/admin.routes.js';
import { publicRouter } from './modules/public/public.routes.js';
import { roadReportsRouter } from './modules/reports/road-reports.routes.js';
import { errorHandler, notFound } from './middleware/error.js';

const logger = pino({
  level: env.NODE_ENV === 'production' ? 'info' : 'debug',
  transport:
    env.NODE_ENV === 'production'
      ? undefined
      : { target: 'pino-pretty', options: { colorize: true } },
});

const app = express();

app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(pinoHttp({ logger }));

app.use(healthRouter);
app.use('/dev', devRouter);
app.use('/auth', authRouter);
app.use('/public', publicRouter);
app.use('/captain', captainRouter);
app.use('/rider', riderRouter);
app.use('/admin', adminRouter);
// Shared by riders and captains
app.use('/road-reports', roadReportsRouter);

app.use(notFound);
app.use(errorHandler);

app.listen(env.PORT, () => {
  logger.info(`Tewiz API listening on http://localhost:${env.PORT}`);
  logger.info(`Health: http://localhost:${env.PORT}/health`);
});
