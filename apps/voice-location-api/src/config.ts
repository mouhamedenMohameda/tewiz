import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Try local .env first, fall back to monorepo root .env.
// override:true so the .env file wins over inherited shell vars
// (Claude Code sets ANTHROPIC_API_KEY in the shell — we want our own).
dotenv.config({ path: path.resolve(__dirname, '../.env'), override: true });
dotenv.config({ path: path.resolve(__dirname, '../../../.env'), override: true });

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  VOICE_API_PORT: z.coerce.number().default(4100),

  VOICE_API_DATABASE_URL: z.string().url(),

  OPENAI_API_KEY: z.string().min(10),
  ANTHROPIC_API_KEY: z.string().min(10),
  ANTHROPIC_MODEL: z.string().default('claude-haiku-4-5-20251001'),
  GOOGLE_MAPS_API_KEY: z.string().min(10),

  GEOCODE_REGION: z.string().default('mr'),
  GEOCODE_LANGUAGE: z.string().default('fr'),
  GEOCODE_BOUNDS: z.string().optional(),

  MAX_AUDIO_BYTES: z.coerce.number().default(10 * 1024 * 1024),
  DEFAULT_MONTHLY_QUOTA: z.coerce.number().default(0),
});

export const env = EnvSchema.parse(process.env);
export type Env = z.infer<typeof EnvSchema>;
