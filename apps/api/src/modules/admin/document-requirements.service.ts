/**
 * Per-document-type "required" flag. Used to decide whether a captain
 * application can be approved with a missing/unapproved document of that
 * type. Backed by the `document_requirements` table (migration 0026).
 *
 * Reads are cached for `CACHE_TTL_MS` because every application detail page
 * load and every approve check hits this; writes bust the cache so the next
 * call sees the change immediately.
 */

import { pool } from '../../db/pool.js';
import type { DocumentType } from '@tewiz/shared-types';

export interface DocumentRequirement {
  type: DocumentType;
  isRequired: boolean;
  updatedAt: string;
  updatedBy: string | null;
}

const CACHE_TTL_MS = 30_000;
let cache: { value: DocumentRequirement[]; loadedAt: number } | null = null;

interface Row {
  type: DocumentType;
  is_required: boolean;
  updated_at: Date;
  updated_by: string | null;
}

function toRequirement(r: Row): DocumentRequirement {
  return {
    type: r.type,
    isRequired: r.is_required,
    updatedAt: r.updated_at.toISOString(),
    updatedBy: r.updated_by,
  };
}

export async function getDocumentRequirements(): Promise<DocumentRequirement[]> {
  if (cache && Date.now() - cache.loadedAt < CACHE_TTL_MS) {
    return cache.value;
  }
  const { rows } = await pool.query<Row>(
    `SELECT type, is_required, updated_at, updated_by
       FROM document_requirements
      ORDER BY type`,
  );
  const value = rows.map(toRequirement);
  cache = { value, loadedAt: Date.now() };
  return value;
}

/** Set of required document types — convenient for the approve endpoint. */
export async function getRequiredDocumentTypes(): Promise<Set<DocumentType>> {
  const all = await getDocumentRequirements();
  return new Set(all.filter((r) => r.isRequired).map((r) => r.type));
}

export async function updateDocumentRequirement(
  adminId: string,
  type: DocumentType,
  isRequired: boolean,
): Promise<DocumentRequirement> {
  const { rows } = await pool.query<Row>(
    `UPDATE document_requirements
        SET is_required = $1,
            updated_at  = now(),
            updated_by  = $2
      WHERE type = $3
      RETURNING type, is_required, updated_at, updated_by`,
    [isRequired, adminId, type],
  );
  cache = null;
  if (!rows[0]) {
    throw new Error(`Unknown document type: ${type}`);
  }
  return toRequirement(rows[0]);
}
