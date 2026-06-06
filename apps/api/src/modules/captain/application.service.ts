import crypto from 'node:crypto';
import sharp from 'sharp';
import type pg from 'pg';
import { pool, withTx } from '../../db/pool.js';
import { HttpError } from '../../middleware/error.js';
import { env } from '../../config/env.js';
import { defaultStorage } from '../storage/local-disk.js';
import type { DocumentType, ApplicationStatus } from '@tewiz/shared-types';

// MVP: only the 4 essentials are required to submit. Admin can mark the
// application as needs_correction to request additional docs later.
const REQUIRED_DOCS: DocumentType[] = [
  'selfie',
  'nni_front',
  'license_front',
  'car_front',
];

const DOCS_WITH_EXPIRY: DocumentType[] = ['assurance', 'vignette', 'visite_technique'];

const EDITABLE_STATUSES: ApplicationStatus[] = ['draft', 'needs_correction'];

interface ApplicationRow {
  id: string;
  phone: string;
  user_id: string | null;
  status: ApplicationStatus;
  full_name: string | null;
  nni: string | null;
  date_of_birth: string | null;
  address_label: string | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  vehicle_plate: string | null;
  vehicle_brand: string | null;
  vehicle_model: string | null;
  vehicle_year: number | null;
  vehicle_color: string | null;
  vehicle_seats: number | null;
  accepts_colis: boolean;
  accepts_long_distance: boolean;
  submitted_at: Date | null;
  reviewed_at: Date | null;
  rejection_reason: string | null;
  correction_notes: string | null;
  created_at: Date;
  updated_at: Date;
}

export async function getOrCreateDraft(userId: string) {
  const existing = await pool.query<ApplicationRow>(
    `SELECT * FROM captain_applications
      WHERE user_id = $1
        AND status IN ('draft','submitted','under_review','needs_correction')
      ORDER BY created_at DESC LIMIT 1`,
    [userId],
  );
  if (existing.rows[0]) return await withDocuments(existing.rows[0]);

  const captain = await pool.query(`SELECT 1 FROM captains WHERE user_id = $1`, [userId]);
  if ((captain.rowCount ?? 0) > 0) {
    throw new HttpError(409, 'already_captain', 'You are already an approved captain');
  }

  const user = await pool.query<{ phone: string; role: string }>(
    `SELECT phone, role FROM users WHERE id = $1`,
    [userId],
  );
  if (!user.rows[0]) throw new HttpError(404, 'user_not_found', 'User not found');
  if (!['rider', 'captain'].includes(user.rows[0].role)) {
    throw new HttpError(403, 'wrong_role', 'Only riders or captains can apply');
  }

  const created = await pool.query<ApplicationRow>(
    `INSERT INTO captain_applications (phone, user_id, status)
     VALUES ($1, $2, 'draft') RETURNING *`,
    [user.rows[0].phone, userId],
  );
  return await withDocuments(created.rows[0]!);
}

export async function getMyApplication(userId: string) {
  const r = await pool.query<ApplicationRow>(
    `SELECT * FROM captain_applications WHERE user_id = $1
     ORDER BY created_at DESC LIMIT 1`,
    [userId],
  );
  if (!r.rows[0]) return null;
  return await withDocuments(r.rows[0]);
}

// Column whitelist for the PATCH endpoint.
const PATCH_COLUMNS: Record<string, string> = {
  fullName: 'full_name',
  nni: 'nni',
  dateOfBirth: 'date_of_birth',
  addressLabel: 'address_label',
  emergencyContactName: 'emergency_contact_name',
  emergencyContactPhone: 'emergency_contact_phone',
  vehiclePlate: 'vehicle_plate',
  vehicleBrand: 'vehicle_brand',
  vehicleModel: 'vehicle_model',
  vehicleYear: 'vehicle_year',
  vehicleColor: 'vehicle_color',
  vehicleSeats: 'vehicle_seats',
  acceptsColis: 'accepts_colis',
  acceptsLongDistance: 'accepts_long_distance',
};

export async function updateMyApplication(
  userId: string,
  patch: Record<string, unknown>,
) {
  const app = await getEditableApplication(userId);
  const fields: string[] = [];
  const values: unknown[] = [];
  for (const [k, v] of Object.entries(patch)) {
    const col = PATCH_COLUMNS[k];
    if (!col || v === undefined) continue;
    values.push(v);
    fields.push(`${col} = $${values.length}`);
  }
  if (!fields.length) return await withDocuments(app);
  values.push(app.id);
  const updated = await pool.query<ApplicationRow>(
    `UPDATE captain_applications SET ${fields.join(', ')}
      WHERE id = $${values.length} RETURNING *`,
    values,
  );
  return await withDocuments(updated.rows[0]!);
}

export async function uploadDocument(
  userId: string,
  input: {
    type: DocumentType;
    expiresAt: string | null;
    buffer: Buffer;
    mimeType: string;
  },
) {
  const app = await getEditableApplication(userId);

  if (DOCS_WITH_EXPIRY.includes(input.type) && !input.expiresAt) {
    throw new HttpError(400, 'expires_at_required',
      `expiresAt is required for ${input.type}`);
  }

  // Sharp: auto-rotate per EXIF, resize, recompress as JPEG.
  const processed = await sharp(input.buffer)
    .rotate()
    .resize({ width: env.IMAGE_MAX_WIDTH_PX, withoutEnlargement: true })
    .jpeg({ quality: env.IMAGE_JPEG_QUALITY, mozjpeg: true })
    .toBuffer();

  const contentHash = crypto.createHash('sha256').update(processed).digest('hex');

  // Cheap fraud check: same hash already used for ANOTHER document type in
  // this application means the captain uploaded the same image twice.
  const dup = await pool.query(
    `SELECT id, type FROM application_documents
      WHERE application_id = $1 AND content_hash = $2 AND type <> $3`,
    [app.id, contentHash, input.type],
  );
  if ((dup.rowCount ?? 0) > 0) {
    throw new HttpError(400, 'duplicate_image',
      `This image has already been uploaded as ${dup.rows[0]!.type}`);
  }

  const storageKey = `applications/${app.id}/${input.type}-${Date.now()}.jpg`;
  await defaultStorage.put(storageKey, processed, 'image/jpeg');

  // One document per type per application: upsert manually since we need to
  // delete the old storage object.
  const existing = await pool.query<{ id: string; storage_key: string }>(
    `SELECT id, storage_key FROM application_documents
      WHERE application_id = $1 AND type = $2`,
    [app.id, input.type],
  );

  let row;
  if (existing.rows[0]) {
    await defaultStorage.delete(existing.rows[0].storage_key);
    const upd = await pool.query(
      `UPDATE application_documents
          SET storage_key = $1, content_hash = $2, status = 'pending',
              expires_at = $3, reject_reason = NULL,
              reviewed_by = NULL, reviewed_at = NULL, uploaded_at = now()
        WHERE id = $4
       RETURNING id, type, status, expires_at, uploaded_at`,
      [storageKey, contentHash, input.expiresAt, existing.rows[0].id],
    );
    row = upd.rows[0];
  } else {
    const ins = await pool.query(
      `INSERT INTO application_documents
         (application_id, type, storage_key, content_hash, expires_at)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, type, status, expires_at, uploaded_at`,
      [app.id, input.type, storageKey, contentHash, input.expiresAt],
    );
    row = ins.rows[0];
  }
  return row;
}

export async function deleteDocument(userId: string, docId: string) {
  const app = await getEditableApplication(userId);
  const r = await pool.query<{ storage_key: string }>(
    `DELETE FROM application_documents
      WHERE id = $1 AND application_id = $2
   RETURNING storage_key`,
    [docId, app.id],
  );
  if (r.rows[0]) await defaultStorage.delete(r.rows[0].storage_key);
}

export async function submitApplication(userId: string) {
  return withTx(async (client) => {
    const r = await client.query<ApplicationRow>(
      `SELECT * FROM captain_applications
        WHERE user_id = $1
          AND status IN ('draft','needs_correction')
        FOR UPDATE`,
      [userId],
    );
    const app = r.rows[0];
    if (!app) throw new HttpError(404, 'no_draft', 'No draft application found');

    const missing: string[] = [];
    const requiredFields: [keyof ApplicationRow, string][] = [
      ['full_name', 'Nom complet'],
      ['nni', 'NNI'],
      ['date_of_birth', 'Date de naissance'],
      ['address_label', 'Adresse'],
      ['emergency_contact_phone', "Téléphone d'urgence"],
      ['vehicle_plate', 'Plaque'],
      ['vehicle_brand', 'Marque'],
      ['vehicle_model', 'Modèle'],
      ['vehicle_year', 'Année'],
      ['vehicle_color', 'Couleur'],
      ['vehicle_seats', 'Nombre de places'],
    ];
    for (const [col, label] of requiredFields) {
      const v = app[col];
      if (v === null || v === '' || v === undefined) missing.push(label);
    }

    const docs = await client.query<{ type: DocumentType }>(
      `SELECT type FROM application_documents WHERE application_id = $1`,
      [app.id],
    );
    const have = new Set(docs.rows.map((d) => d.type));
    for (const t of REQUIRED_DOCS) {
      if (!have.has(t)) missing.push(`Document manquant: ${t}`);
    }

    if (missing.length) {
      throw new HttpError(400, 'incomplete', 'Application incomplete', { missing });
    }

    const upd = await client.query<ApplicationRow>(
      `UPDATE captain_applications
          SET status = 'submitted', submitted_at = now()
        WHERE id = $1 RETURNING *`,
      [app.id],
    );
    return await withDocuments(upd.rows[0]!, client);
  });
}

// --- helpers ---

async function getEditableApplication(userId: string): Promise<ApplicationRow> {
  const r = await pool.query<ApplicationRow>(
    `SELECT * FROM captain_applications
      WHERE user_id = $1
        AND status IN ('draft','submitted','under_review','needs_correction')
      ORDER BY created_at DESC LIMIT 1`,
    [userId],
  );
  const app = r.rows[0];
  if (!app) throw new HttpError(404, 'no_application', 'No application');
  if (!EDITABLE_STATUSES.includes(app.status)) {
    throw new HttpError(409, 'not_editable',
      `Application is ${app.status} and cannot be edited`);
  }
  return app;
}

async function withDocuments(app: ApplicationRow, client?: pg.PoolClient) {
  const q = client ?? pool;
  const docs = await q.query(
    `SELECT id, type, status, expires_at, reject_reason, uploaded_at
       FROM application_documents
      WHERE application_id = $1
      ORDER BY type`,
    [app.id],
  );
  return {
    id: app.id,
    status: app.status,
    phone: app.phone,
    fullName: app.full_name,
    nni: app.nni,
    dateOfBirth: app.date_of_birth,
    addressLabel: app.address_label,
    emergencyContactName: app.emergency_contact_name,
    emergencyContactPhone: app.emergency_contact_phone,
    vehiclePlate: app.vehicle_plate,
    vehicleBrand: app.vehicle_brand,
    vehicleModel: app.vehicle_model,
    vehicleYear: app.vehicle_year,
    vehicleColor: app.vehicle_color,
    vehicleSeats: app.vehicle_seats,
    acceptsColis: app.accepts_colis,
    acceptsLongDistance: app.accepts_long_distance,
    submittedAt: app.submitted_at,
    rejectionReason: app.rejection_reason,
    correctionNotes: app.correction_notes,
    createdAt: app.created_at,
    updatedAt: app.updated_at,
    documents: docs.rows,
  };
}
