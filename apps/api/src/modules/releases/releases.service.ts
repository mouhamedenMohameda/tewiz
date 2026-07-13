/**
 * App releases — hosted Android builds (APK) uploaded from the back-office.
 *
 * The row in `app_releases` is the source of truth; the binary lives in the
 * storage provider at `storage_key`. "Latest" is simply the newest created_at.
 * See migration 0069_app_releases.sql.
 */

import { pool } from '../../db/pool.js';
import { defaultStorage } from '../storage/local-disk.js';

export interface AppRelease {
  id: string;
  platform: 'android';
  versionName: string;
  versionCode: number;
  packageName: string | null;
  storageKey: string;
  sizeBytes: number;
  notes: string | null;
  uploadedBy: string | null;
  createdAt: string;
}

/** Map a DB row (snake_case) to the camelCase shape the API returns. */
function rowToRelease(r: Record<string, unknown>): AppRelease {
  return {
    id: r.id as string,
    platform: r.platform as 'android',
    versionName: r.version_name as string,
    // bigint columns come back as strings from node-postgres.
    versionCode: Number(r.version_code),
    packageName: (r.package_name as string | null) ?? null,
    storageKey: r.storage_key as string,
    sizeBytes: Number(r.size_bytes),
    notes: (r.notes as string | null) ?? null,
    uploadedBy: (r.uploaded_by as string | null) ?? null,
    createdAt:
      r.created_at instanceof Date
        ? r.created_at.toISOString()
        : String(r.created_at),
  };
}

/** The most recently uploaded build, or null when none exists yet. */
export async function getLatestRelease(): Promise<AppRelease | null> {
  const { rows } = await pool.query(
    `SELECT * FROM app_releases ORDER BY created_at DESC LIMIT 1`,
  );
  return rows[0] ? rowToRelease(rows[0]) : null;
}

/** Full upload history, newest first (admin view). */
export async function listReleases(): Promise<AppRelease[]> {
  const { rows } = await pool.query(
    `SELECT * FROM app_releases ORDER BY created_at DESC LIMIT 100`,
  );
  return rows.map(rowToRelease);
}

export async function getReleaseById(id: string): Promise<AppRelease | null> {
  const { rows } = await pool.query(`SELECT * FROM app_releases WHERE id = $1`, [
    id,
  ]);
  return rows[0] ? rowToRelease(rows[0]) : null;
}

export async function insertRelease(input: {
  versionName: string;
  versionCode: number;
  packageName: string | null;
  storageKey: string;
  sizeBytes: number;
  notes: string | null;
  uploadedBy: string;
}): Promise<AppRelease> {
  const { rows } = await pool.query(
    `INSERT INTO app_releases
       (version_name, version_code, package_name, storage_key, size_bytes, notes, uploaded_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [
      input.versionName,
      input.versionCode,
      input.packageName,
      input.storageKey,
      input.sizeBytes,
      input.notes,
      input.uploadedBy,
    ],
  );
  return rowToRelease(rows[0]);
}

/** Delete a build row and its stored binary. Storage delete is best-effort. */
export async function deleteRelease(id: string): Promise<AppRelease | null> {
  const release = await getReleaseById(id);
  if (!release) return null;
  await pool.query(`DELETE FROM app_releases WHERE id = $1`, [id]);
  await defaultStorage.delete(release.storageKey).catch(() => {});
  return release;
}

/**
 * Public metadata shape returned by GET /public/app/latest and used to build
 * the download filename. `downloadUrl` is absolute so an <a href> or the
 * mobile app can hit it directly.
 */
export function toPublicJson(
  release: AppRelease,
  downloadUrl: string,
): {
  versionName: string;
  versionCode: number;
  sizeBytes: number;
  notes: string | null;
  createdAt: string;
  downloadUrl: string;
} {
  return {
    versionName: release.versionName,
    versionCode: release.versionCode,
    sizeBytes: release.sizeBytes,
    notes: release.notes,
    createdAt: release.createdAt,
    downloadUrl,
  };
}

/**
 * Build a safe download filename like "Aloo-1.2.0.apk". versionName is
 * attacker-influenced (it comes from the uploaded APK), so strip anything that
 * isn't filename-safe to avoid Content-Disposition header injection.
 */
export function downloadFilename(release: AppRelease): string {
  const safeVersion = release.versionName.replace(/[^A-Za-z0-9._-]/g, '') || 'latest';
  return `app-${safeVersion}.apk`;
}
