import { mkdirSync } from 'node:fs';
import path from 'node:path';
import multer from 'multer';
import { env } from '../config/env.js';

const ALLOWED_MIMES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/heic',
  'image/heif',
  'image/webp',
]);

/**
 * In-memory upload. Files go straight to sharp for processing, then to storage.
 * Memory usage is bounded by MAX_UPLOAD_BYTES per request.
 */
export const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.MAX_UPLOAD_BYTES, files: 1 },
  fileFilter(_req, file, cb) {
    if (ALLOWED_MIMES.has(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`Unsupported file type: ${file.mimetype}`));
    }
  },
});

// Voice-ride memos. The mobile recorder produces m4a (AAC), but the exact
// mimetype varies by platform/library (audio/m4a, audio/x-m4a, audio/mp4,
// audio/aac on iOS; sometimes application/octet-stream from a raw upload).
// We accept any audio/* plus octet-stream and store it as m4a — same bound
// as the old voice-to-location proxy (MAX_UPLOAD_BYTES, default 10 MB).
const ALLOWED_AUDIO_MIMES = new Set([
  'audio/m4a',
  'audio/x-m4a',
  'audio/mp4',
  'audio/aac',
  'audio/mpeg',
  'audio/3gpp',
  'audio/wav',
  'audio/x-wav',
]);

/**
 * In-memory single-file audio upload for voice rides. Streams to the
 * StorageProvider in the route handler. Bounded by MAX_UPLOAD_BYTES.
 */
export const uploadAudio = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.MAX_UPLOAD_BYTES, files: 1 },
  fileFilter(_req, file, cb) {
    if (
      ALLOWED_AUDIO_MIMES.has(file.mimetype) ||
      file.mimetype.startsWith('audio/') ||
      file.mimetype === 'application/octet-stream'
    ) {
      cb(null, true);
    } else {
      cb(new Error(`Unsupported audio type: ${file.mimetype}`));
    }
  },
});

// APK builds are large (tens/hundreds of MB), so unlike photos/audio we do NOT
// buffer them in memory — multer writes to a temp dir on disk and the route
// gets a file path. That path is what the APK manifest parser (which reads a
// file, not a Buffer) and the storage put both consume; the route deletes the
// temp file afterwards.
const APK_TMP_DIR = path.join(path.resolve(env.UPLOAD_DIR), 'tmp');
mkdirSync(APK_TMP_DIR, { recursive: true });

/**
 * In-memory-safe single-file APK upload for the admin app-release uploader.
 * Streams straight to disk (APK_TMP_DIR), bounded by MAX_APK_UPLOAD_BYTES.
 * super_admin-only route — the guard lives on the router, not here.
 */
export const uploadApk = multer({
  storage: multer.diskStorage({ destination: APK_TMP_DIR }),
  limits: { fileSize: env.MAX_APK_UPLOAD_BYTES, files: 1 },
  fileFilter(_req, file, cb) {
    // Android sets application/vnd.android.package-archive; some clients send
    // application/octet-stream. Fall back to the .apk extension either way.
    const ok =
      file.mimetype === 'application/vnd.android.package-archive' ||
      file.mimetype === 'application/octet-stream' ||
      file.originalname.toLowerCase().endsWith('.apk');
    if (ok) {
      cb(null, true);
    } else {
      cb(new Error(`Unsupported file type for APK upload: ${file.mimetype}`));
    }
  },
});
