/**
 * Ce qui reste à faire au captain APRÈS son acceptation.
 *
 * L'onboarding v3 ne demande avant le "oui" que le permis et la carte grise —
 * de quoi décider si la personne peut conduire, et rien d'autre. Tout le reste
 * (véhicule déclaré, assurance, photo de la voiture, NNI) est réclamé ici,
 * une fois le captain accepté : à ce moment il est motivé pour le fournir,
 * alors qu'avant le "oui" chaque champ supplémentaire est un abandon.
 *
 * Un seul verrou : `canGoOnline` — le captain doit avoir un nom et un véhicule
 * déclaré. La vérification de ce véhicule par un opérateur est un contrôle a
 * posteriori, pas une condition de départ.
 *
 * Les DOCUMENTS ne bloquent plus (0089). Ils l'ont fait brièvement, et c'était
 * une erreur : l'exigence tombait rétroactivement sur des captains déjà
 * acceptés, qui roulaient la veille et se retrouvaient hors ligne pour une
 * pièce qu'on ne leur avait jamais demandée. `gapsForStage` reste appelée car
 * les ops peuvent replacer une pièce en 'online' depuis /settings/documents —
 * par défaut la liste est simplement vide.
 */

import { pool, withTx } from '../../db/pool.js';
import { HttpError } from '../../middleware/error.js';
import {
  type DocumentStage,
  getDocumentTypesForStage,
} from '../admin/document-requirements.service.js';
import type { DocumentType } from '@tewiz/shared-types';

export interface VehicleDto {
  id: string;
  plate: string;
  brand: string;
  model: string;
  year: number;
  color: string;
  seats: number;
  vehicleType: 'car' | 'moto';
  verifiedAt: string | null;
}

/** Pourquoi un document bloque : jamais déposé, refusé, périmé, ou en attente. */
export type DocGapReason = 'missing' | 'pending' | 'rejected' | 'expired';

export interface DocGap {
  type: DocumentType;
  reason: DocGapReason;
}

export interface OnboardingStatus {
  /** Nom affiché aux clients. Repris du compte, sinon saisi ici. */
  fullName: string | null;
  vehicle: VehicleDto | null;
  onlineGaps: DocGap[];
  canGoOnline: boolean;
}

interface DocRow {
  type: DocumentType;
  status: 'pending' | 'approved' | 'rejected' | 'expired';
  expires_at: Date | null;
}

interface VehicleRow {
  id: string;
  plate: string;
  brand: string;
  model: string;
  year: number;
  color: string;
  seats: number;
  vehicle_type: 'car' | 'moto';
  verified_at: Date | null;
}

function toVehicleDto(v: VehicleRow): VehicleDto {
  return {
    id: v.id,
    plate: v.plate,
    brand: v.brand,
    model: v.model,
    year: v.year,
    color: v.color,
    seats: v.seats,
    vehicleType: v.vehicle_type,
    verifiedAt: v.verified_at ? v.verified_at.toISOString() : null,
  };
}

export async function getActiveVehicle(captainId: string): Promise<VehicleDto | null> {
  const r = await pool.query<VehicleRow>(
    `SELECT id, plate, brand, model, year, color, seats, vehicle_type, verified_at
       FROM vehicles
      WHERE captain_id = $1 AND is_active = true
      LIMIT 1`,
    [captainId],
  );
  return r.rows[0] ? toVehicleDto(r.rows[0]) : null;
}

/**
 * Les documents d'une étape qui ne sont pas en règle, avec la raison — le
 * client affiche « à envoyer » et « refusé, à refaire » différemment, et
 * « en attente de validation » n'appelle aucune action du captain.
 */
async function gapsForStage(
  captainId: string,
  stage: Exclude<DocumentStage, 'off'>,
): Promise<DocGap[]> {
  const required = await getDocumentTypesForStage(stage);
  if (required.size === 0) return [];

  const r = await pool.query<DocRow>(
    `SELECT d.type, d.status, d.expires_at
       FROM application_documents d
       JOIN captain_applications a ON a.id = d.application_id
      WHERE a.user_id = $1
      ORDER BY d.uploaded_at DESC`,
    [captainId],
  );
  // Une candidature rejetée puis re-déposée laisse plusieurs lignes du même
  // type ; on garde la plus récente (tri ci-dessus).
  const latest = new Map<DocumentType, DocRow>();
  for (const row of r.rows) if (!latest.has(row.type)) latest.set(row.type, row);

  const now = Date.now();
  const gaps: DocGap[] = [];
  for (const type of required) {
    const doc = latest.get(type);
    if (!doc) { gaps.push({ type, reason: 'missing' }); continue; }
    if (doc.status === 'rejected') { gaps.push({ type, reason: 'rejected' }); continue; }
    if (doc.status === 'expired') { gaps.push({ type, reason: 'expired' }); continue; }
    // Une date d'expiration dépassée prime sur un statut 'approved' figé : le
    // batch qui bascule les documents en 'expired' peut n'être pas encore passé.
    if (doc.expires_at && doc.expires_at.getTime() < now) {
      gaps.push({ type, reason: 'expired' }); continue;
    }
    if (doc.status !== 'approved') gaps.push({ type, reason: 'pending' });
  }
  return gaps;
}

export async function getOnboardingStatus(captainId: string): Promise<OnboardingStatus> {
  const [nameRow, vehicle, onlineGaps] = await Promise.all([
    pool.query<{ full_name: string | null }>(
      `SELECT full_name FROM users WHERE id = $1`, [captainId],
    ),
    getActiveVehicle(captainId),
    gapsForStage(captainId, 'online'),
  ]);
  // Le nom n'est plus demandé à la candidature (il figure sur le permis, que
  // le candidat photographie). Un client venu du parcours invité peut donc
  // arriver ici sans nom — les passagers doivent voir quelqu'un, pas un vide.
  const fullName = nameRow.rows[0]?.full_name?.trim() || null;
  return {
    fullName,
    vehicle,
    onlineGaps,
    // La vérification du véhicule ne bloque PAS. Elle l'a fait, et ça revenait
    // à faire patienter le captain dans une seconde file juste après lui avoir
    // dit oui — alors qu'avant, les ops saisissaient le véhicule à la
    // validation et il roulait aussitôt. Le contrôle reste, en aval : la file
    // /captains/pending-online confronte la plaque saisie à la carte grise, et
    // un écart se traite en suspendant le captain. On accepte quelques heures
    // de route sur une plaque non confrontée ; on n'accepte pas de remettre une
    // attente sur le chemin de quelqu'un qu'on vient d'accepter.
    canGoOnline: !!fullName && !!vehicle && onlineGaps.length === 0,
  };
}

export interface ProfileInput {
  fullName: string;
  plate: string;
  brand: string;
  model: string;
  year: number;
  color: string;
  seats: number;
  vehicleType: 'car' | 'moto';
}

/**
 * Le captain déclare son nom et son véhicule — un seul bouton dans l'app, donc
 * un seul appel ici.
 *
 * Toute écriture sur le véhicule remet `verified_at` à NULL : c'est le point
 * du dispositif. L'opérateur ne recopie plus la carte grise, il confronte la
 * saisie du captain au document déjà au dossier — une saisie modifiée doit
 * donc repasser devant lui, sinon il suffirait de déclarer une plaque valide,
 * de se faire vérifier, puis de la changer.
 */
export async function declareProfile(
  captainId: string,
  input: ProfileInput,
): Promise<VehicleDto> {
  const plate = input.plate.trim().toUpperCase();

  return withTx(async (client) => {
    // `plate` est UNIQUE globalement : une plaque déjà rattachée à quelqu'un
    // d'autre est refusée explicitement plutôt que remontée en 500 sur
    // violation de contrainte.
    const owner = await client.query<{ captain_id: string }>(
      `SELECT captain_id FROM vehicles WHERE plate = $1 FOR UPDATE`,
      [plate],
    );
    if (owner.rows[0] && owner.rows[0].captain_id !== captainId) {
      throw new HttpError(409, 'plate_taken',
        `La plaque ${plate} est déjà associée à un autre Captain.`);
    }

    // `vehicles_one_active_per_captain` est un index unique partiel sur
    // (captain_id) WHERE is_active : désactiver AVANT d'insérer, sinon un
    // captain qui corrige sa plaque se heurte à son propre ancien véhicule.
    await client.query(
      `UPDATE vehicles SET is_active = false WHERE captain_id = $1`,
      [captainId],
    );

    const r = await client.query<VehicleRow>(
      `INSERT INTO vehicles
         (captain_id, plate, brand, model, year, color, seats, vehicle_type, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true)
       ON CONFLICT (plate) DO UPDATE
         SET brand        = EXCLUDED.brand,
             model        = EXCLUDED.model,
             year         = EXCLUDED.year,
             color        = EXCLUDED.color,
             seats        = EXCLUDED.seats,
             vehicle_type = EXCLUDED.vehicle_type,
             is_active    = true,
             verified_at  = NULL,
             verified_by  = NULL
       RETURNING id, plate, brand, model, year, color, seats, vehicle_type, verified_at`,
      [captainId, plate, input.brand.trim(), input.model.trim(),
        input.year, input.color.trim(), input.seats, input.vehicleType],
    );

    // `captains.vehicle_type` pilote le dispatch et la tarification : le laisser
    // sur la valeur par défaut ferait recevoir des courses voiture à une moto.
    await client.query(
      `UPDATE captains SET vehicle_type = $2 WHERE user_id = $1`,
      [captainId, input.vehicleType],
    );

    await client.query(
      `UPDATE users SET full_name = $2 WHERE id = $1`,
      [captainId, input.fullName.trim()],
    );

    return toVehicleDto(r.rows[0]!);
  });
}
