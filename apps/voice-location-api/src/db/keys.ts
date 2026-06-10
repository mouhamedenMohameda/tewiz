import crypto from 'node:crypto';
import { pool } from './pool.js';

export interface ApiKeyRow {
  id: string;
  client_name: string;
  key_prefix: string;
  monthly_quota: number;
  is_active: boolean;
}

export function hashKey(key: string): string {
  return crypto.createHash('sha256').update(key).digest('hex');
}

export function generateKey(): { key: string; prefix: string; hash: string } {
  // 32 random bytes -> 43-char base64url. Prefix for human-readable identification.
  const raw = crypto.randomBytes(32).toString('base64url');
  const key = `vl_live_${raw}`;
  const prefix = key.slice(0, 12); // "vl_live_xxxx"
  return { key, prefix, hash: hashKey(key) };
}

export async function findKeyByHash(hash: string): Promise<ApiKeyRow | null> {
  const { rows } = await pool.query<ApiKeyRow>(
    `SELECT id, client_name, key_prefix, monthly_quota, is_active
       FROM voiceloc_api_keys
      WHERE key_hash = $1
      LIMIT 1`,
    [hash],
  );
  return rows[0] ?? null;
}

export async function touchLastUsed(id: string): Promise<void> {
  await pool.query(`UPDATE voiceloc_api_keys SET last_used_at = now() WHERE id = $1`, [id]);
}

export async function countUsageThisMonth(apiKeyId: string): Promise<number> {
  const { rows } = await pool.query<{ c: string }>(
    `SELECT COUNT(*)::text AS c
       FROM voiceloc_usage_logs
      WHERE api_key_id = $1
        AND created_at >= date_trunc('month', now())
        AND status_code < 400`,
    [apiKeyId],
  );
  return Number(rows[0]?.c ?? 0);
}

export interface UsageLog {
  apiKeyId: string;
  endpoint: string;
  statusCode: number;
  durationMs?: number;
  audioBytes?: number;
  transcriptChars?: number;
  detectedLang?: string;
  geocodeStatus?: string;
  errorMessage?: string;
}

export async function logUsage(u: UsageLog): Promise<void> {
  await pool.query(
    `INSERT INTO voiceloc_usage_logs
       (api_key_id, endpoint, status_code, duration_ms, audio_bytes,
        transcript_chars, detected_lang, geocode_status, error_message)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [
      u.apiKeyId,
      u.endpoint,
      u.statusCode,
      u.durationMs ?? null,
      u.audioBytes ?? null,
      u.transcriptChars ?? null,
      u.detectedLang ?? null,
      u.geocodeStatus ?? null,
      u.errorMessage ?? null,
    ],
  );
}
