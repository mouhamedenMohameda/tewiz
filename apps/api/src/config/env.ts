import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

// .env lives at the monorepo root, but cwd may be apps/api when running.
// Resolve relative to THIS file so it works from anywhere.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../../../.env') });

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(3000),

  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),

  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  JWT_ACCESS_TTL_SECONDS: z.coerce.number().default(900),
  JWT_REFRESH_TTL_SECONDS: z.coerce.number().default(60 * 60 * 24 * 30),

  OTP_TTL_SECONDS: z.coerce.number().default(300),
  OTP_MAX_ATTEMPTS: z.coerce.number().default(5),
  SMS_PROVIDER: z.enum(['mock', 'twilio', 'chinguitel']).default('mock'),

  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_FROM_NUMBER: z.string().optional(),

  // Business config — basis points (1% = 100 bps)
  DEFAULT_COMMISSION_BPS: z.coerce.number().default(700),
  COLIS_COMMISSION_BPS: z.coerce.number().default(1000),
  MIN_BALANCE_TO_GO_ONLINE_KHOUMS: z.coerce.number().default(100),
  NEGATIVE_BALANCE_FLOOR_KHOUMS: z.coerce.number().default(-250),

  HOME_LOCK_DAYS: z.coerce.number().default(30),
  HOME_GPS_TOLERANCE_M: z.coerce.number().default(200),
  GOING_HOME_SESSION_MAX_HOURS: z.coerce.number().default(2),
  GOING_HOME_MAX_PER_DAY: z.coerce.number().default(2),
  GOING_HOME_ARRIVAL_RADIUS_M: z.coerce.number().default(500),

  // Storage
  UPLOAD_DIR: z.string().default('./uploads'),
  MAX_UPLOAD_BYTES: z.coerce.number().default(10 * 1024 * 1024),
  IMAGE_MAX_WIDTH_PX: z.coerce.number().default(1600),
  IMAGE_JPEG_QUALITY: z.coerce.number().min(40).max(95).default(80),

  // Pricing (all amounts in khoums; 1 MRU = 5 khoums)
  BASE_FARE_KHOUMS: z.coerce.number().int().default(100),       // 20 MRU
  PER_KM_KHOUMS: z.coerce.number().int().default(150),          // 30 MRU/km
  MIN_FARE_KHOUMS: z.coerce.number().int().default(200),        // 40 MRU
  ROUTE_MULTIPLIER: z.coerce.number().default(1.3),             // crow-flies × N ≈ road distance
  // Dispatch
  DISPATCH_RADIUS_M: z.coerce.number().int().default(3000),
  DISPATCH_TOP_N: z.coerce.number().int().default(5),

  // Geocoding (Google Places). Falls back to Nominatim when unset.
  GOOGLE_PLACES_API_KEY: z.string().optional(),

  // Voice-to-Location proxy. The main API forwards rider audio to the
  // voice-location-api (which lives behind an API key the client must
  // never see). Defaults assume both apps run on the same host.
  VOICE_API_INTERNAL_URL: z.string().url().default('http://127.0.0.1:4100'),
  VOICE_API_KEY: z.string().min(10).optional(),
});

export const env = EnvSchema.parse(process.env);
export type Env = z.infer<typeof EnvSchema>;
