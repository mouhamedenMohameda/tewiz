import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import pino from 'pino';
import { env } from './config.js';
import { healthRouter } from './routes/health.js';
import { voiceRouter } from './routes/voice.js';
import { confirmRouter } from './routes/confirm.js';
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
app.use(pinoHttp({ logger }));
// JSON parser is mounted globally; multer handles multipart on its own routes.
app.use(express.json({ limit: '1mb' }));

app.use(healthRouter);
app.use(voiceRouter);
app.use(confirmRouter);

app.use(notFound);
app.use(errorHandler);

app.listen(env.VOICE_API_PORT, () => {
  logger.info(`Voice-Location API listening on http://0.0.0.0:${env.VOICE_API_PORT}`);
  logger.info(`Health: http://0.0.0.0:${env.VOICE_API_PORT}/health`);
});
