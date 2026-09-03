/**
 * À quel moment du parcours chaque type de document devient bloquant.
 * Adossé à `document_requirements` (migrations 0026, 0087).
 *
 * Un booléen `is_required` ne savait dire que « obligatoire ou pas » — jamais
 * « obligatoire, mais après l'acceptation ». C'est pourtant ce dont dépend
 * tout l'onboarding v3 : ne demander avant le "oui" que ce qui sert à dire
 * oui, et réclamer le reste au captain une fois qu'il est accepté.
 *
 * Les lectures sont mises en cache `CACHE_TTL_MS` (chaque chargement de fiche
 * candidature et chaque contrôle de validation passent ici) ; les écritures
 * invalident le cache pour que l'appel suivant voie le changement.
 */

import { pool } from '../../db/pool.js';
import type { DocumentType } from '@tewiz/shared-types';

/** Ce que le document bloque tant qu'il manque. */
export type DocumentStage = 'application' | 'online' | 'off';

export const DOCUMENT_STAGES: DocumentStage[] = ['application', 'online', 'off'];

export interface DocumentRequirement {
  type: DocumentType;
  stage: DocumentStage;
  updatedAt: string;
  updatedBy: string | null;
}

const CACHE_TTL_MS = 30_000;
let cache: { value: DocumentRequirement[]; loadedAt: number } | null = null;

interface Row {
  type: DocumentType;
  stage: DocumentStage;
  updated_at: Date;
  updated_by: string | null;
}

function toRequirement(r: Row): DocumentRequirement {
  return {
    type: r.type,
    stage: r.stage,
    updatedAt: r.updated_at.toISOString(),
    updatedBy: r.updated_by,
  };
}

export async function getDocumentRequirements(): Promise<DocumentRequirement[]> {
  if (cache && Date.now() - cache.loadedAt < CACHE_TTL_MS) {
    return cache.value;
  }
  const { rows } = await pool.query<Row>(
    `SELECT type, stage, updated_at, updated_by
       FROM document_requirements
      ORDER BY type`,
  );
  const value = rows.map(toRequirement);
  cache = { value, loadedAt: Date.now() };
  return value;
}

/** Les types bloquants à une étape donnée. */
export async function getDocumentTypesForStage(
  stage: Exclude<DocumentStage, 'off'>,
): Promise<Set<DocumentType>> {
  const all = await getDocumentRequirements();
  return new Set(all.filter((r) => r.stage === stage).map((r) => r.type));
}

export async function updateDocumentRequirement(
  adminId: string,
  type: DocumentType,
  stage: DocumentStage,
): Promise<DocumentRequirement> {
  const { rows } = await pool.query<Row>(
    `UPDATE document_requirements
        SET stage      = $1,
            updated_at = now(),
            updated_by = $2
      WHERE type = $3
      RETURNING type, stage, updated_at, updated_by`,
    [stage, adminId, type],
  );
  cache = null;
  if (!rows[0]) {
    throw new Error(`Unknown document type: ${type}`);
  }
  return toRequirement(rows[0]);
}
