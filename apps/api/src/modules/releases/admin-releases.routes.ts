/**
 * Admin endpoints to upload & manage hosted Android builds (APK).
 *
 *   GET    /admin/app-releases        — upload history (newest first)
 *   POST   /admin/app-releases        — upload an APK (multipart, field "file")
 *   DELETE /admin/app-releases/:id     — remove a build + its stored binary
 *
 * Mounted under the admin router behind requireAdminRole() → super_admin only.
 * The version is NOT typed by hand: it's extracted from the APK's
 * AndroidManifest at upload time so it always matches the real binary.
 */

import { readFile, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import ApkReader from '@devicefarmer/adbkit-apkreader';
import type { AuthedRequest } from '../../middleware/auth.js';
import { HttpError } from '../../middleware/error.js';
import { uploadApk } from '../../middleware/upload.js';
import { defaultStorage } from '../storage/local-disk.js';
import { audit } from '../admin/audit.js';
import {
  insertRelease,
  listReleases,
  deleteRelease,
  toPublicJson,
  type AppRelease,
} from './releases.service.js';

export const adminReleasesRouter = Router();

const APK_CONTENT_TYPE = 'application/vnd.android.package-archive';

/** Absolute download URL for the given release, honouring X-Forwarded-Proto. */
function downloadUrlFor(req: AuthedRequest): string {
  return `${req.protocol}://${req.get('host')}/public/app/download`;
}

/** Admin view of a release: everything plus a ready-to-use download URL. */
function adminJson(req: AuthedRequest, release: AppRelease) {
  return { ...release, ...toPublicJson(release, downloadUrlFor(req)) };
}

adminReleasesRouter.get('/', async (req, res) => {
  const releases = await listReleases();
  res.json(releases.map((r) => adminJson(req as AuthedRequest, r)));
});

const uploadBody = z.object({
  // Optional release notes, shown on the public download page.
  notes: z.string().trim().max(2000).optional(),
});

adminReleasesRouter.post('/', uploadApk.single('file'), async (req, res) => {
  const areq = req as AuthedRequest;
  const file = (req as unknown as { file?: Express.Multer.File }).file;
  if (!file) throw new HttpError(400, 'no_file', 'Aucun fichier APK fourni');

  const { notes } = uploadBody.parse(req.body);

  try {
    // 1. Extract versionName / versionCode / package from the APK manifest.
    let versionName: string | undefined;
    let versionCode: number | undefined;
    let packageName: string | undefined;
    try {
      const reader = await ApkReader.open(file.path);
      const manifest = await reader.readManifest();
      versionName = manifest.versionName;
      versionCode = manifest.versionCode;
      packageName = manifest.package;
    } catch {
      throw new HttpError(
        400,
        'invalid_apk',
        "Impossible de lire l'APK. Vérifiez que le fichier est bien un APK Android valide.",
      );
    }
    if (!versionName || typeof versionCode !== 'number') {
      throw new HttpError(
        400,
        'invalid_apk',
        "Version introuvable dans l'APK (versionName / versionCode manquant).",
      );
    }

    // 2. Persist the binary through the storage provider.
    const storageKey = `releases/${randomUUID()}.apk`;
    const buffer = await readFile(file.path);
    await defaultStorage.put(storageKey, buffer, APK_CONTENT_TYPE);

    // 3. Record the row.
    const release = await insertRelease({
      versionName,
      versionCode,
      packageName: packageName ?? null,
      storageKey,
      sizeBytes: file.size,
      notes: notes && notes.length > 0 ? notes : null,
      uploadedBy: areq.user!.id,
    });

    await audit({
      adminId: areq.user!.id,
      action: 'app_release.upload',
      targetType: 'app_release',
      targetId: release.id,
      after: {
        versionName: release.versionName,
        versionCode: release.versionCode,
        sizeBytes: release.sizeBytes,
      },
    });

    res.status(201).json(adminJson(areq, release));
  } finally {
    // Always clean up the temp upload, success or failure.
    await unlink(file.path).catch(() => {});
  }
});

adminReleasesRouter.delete('/:id', async (req, res) => {
  const areq = req as AuthedRequest;
  const id = req.params.id!;
  const removed = await deleteRelease(id);
  if (!removed) throw new HttpError(404, 'not_found', 'Build introuvable');

  await audit({
    adminId: areq.user!.id,
    action: 'app_release.delete',
    targetType: 'app_release',
    targetId: id,
    before: { versionName: removed.versionName, versionCode: removed.versionCode },
  });

  res.json({ ok: true });
});
