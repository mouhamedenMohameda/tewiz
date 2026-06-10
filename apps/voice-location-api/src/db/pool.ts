import { Pool } from 'pg';
import { env } from '../config.js';

export const pool = new Pool({ connectionString: env.VOICE_API_DATABASE_URL });
