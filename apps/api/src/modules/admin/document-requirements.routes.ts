/**
 * Admin endpoints to read and update the per-document-type stage — i.e. what
 * each document blocks while it is missing (candidature, mise en ligne,
 * retrait, ou rien).
 *
 *   GET  /admin/document-requirements        — list every type + stage
 *   PUT  /admin/document-requirements/:type  — { stage: DocumentStage }
 *
 * Mounted under the admin router (admin role already enforced).
 */

import { Router } from 'express';
import { z } from 'zod';
import { HttpError } from '../../middleware/error.js';
import { audit } from './audit.js';
import {
  DOCUMENT_STAGES,
  type DocumentStage,
  getDocumentRequirements,
  updateDocumentRequirement,
} from './document-requirements.service.js';
import type { DocumentType } from '@tewiz/shared-types';

export const adminDocumentRequirementsRouter = Router();

const ALL_TYPES = [
  'selfie',
  'nni_front', 'nni_back',
  'license_front', 'license_back',
  'carte_grise', 'assurance', 'vignette', 'visite_technique',
  'car_front', 'car_back', 'car_left', 'car_right', 'car_interior',
] as const satisfies readonly DocumentType[];

const typeParam = z.enum(ALL_TYPES);
const patchBody = z.object({
  stage: z.enum(DOCUMENT_STAGES as [DocumentStage, ...DocumentStage[]]),
});

adminDocumentRequirementsRouter.get('/', async (_req, res) => {
  res.json(await getDocumentRequirements());
});

adminDocumentRequirementsRouter.put('/:type', async (req, res) => {
  const adminId = req.user!.id;
  const parsed = typeParam.safeParse(req.params.type);
  if (!parsed.success) {
    throw new HttpError(400, 'invalid_type', 'Unknown document type');
  }
  const body = patchBody.parse(req.body);
  const after = await updateDocumentRequirement(adminId, parsed.data, body.stage);
  await audit({
    adminId,
    action: 'document_requirement.update',
    targetType: 'document_requirement',
    targetId: parsed.data,
    after: { stage: after.stage },
  });
  res.json(after);
});
