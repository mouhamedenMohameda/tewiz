// Mirrors packages/shared-types — duplicated here to keep the mobile app
// dependency-free of the workspace types package.

export type ApplicationStatus =
  | 'draft' | 'submitted' | 'under_review'
  | 'needs_correction' | 'approved' | 'rejected';

export type DocumentType =
  | 'selfie'
  | 'nni_front' | 'nni_back'
  | 'license_front' | 'license_back'
  | 'carte_grise' | 'assurance' | 'vignette' | 'visite_technique'
  | 'car_front' | 'car_back' | 'car_left' | 'car_right' | 'car_interior';

export type DocumentStatus = 'pending' | 'approved' | 'rejected' | 'expired';
export type VehicleType = 'car' | 'moto';

export const DOCUMENTS_WITH_EXPIRY: DocumentType[] = [
  'assurance', 'vignette', 'visite_technique',
];

export const DOCUMENT_ORDER: DocumentType[] = [
  'selfie',
  'nni_front', 'nni_back',
  'license_front', 'license_back',
  'carte_grise', 'assurance', 'vignette', 'visite_technique',
  'car_front', 'car_back', 'car_left', 'car_right', 'car_interior',
];

export const DOC_LABELS: Record<DocumentType, string> = {
  selfie: 'Selfie',
  nni_front: 'NNI — recto',
  nni_back: 'NNI — verso',
  license_front: 'Permis — recto',
  license_back: 'Permis — verso',
  carte_grise: 'Carte grise',
  assurance: 'Assurance',
  vignette: 'Vignette',
  visite_technique: 'Visite technique',
  car_front: 'Voiture — avant',
  car_back: 'Voiture — arrière',
  car_left: 'Voiture — gauche',
  car_right: 'Voiture — droite',
  car_interior: 'Voiture — intérieur',
};

export interface AppDoc {
  id: string;
  type: DocumentType;
  status: DocumentStatus;
  expiresAt?: string | null;
  rejectReason?: string | null;
  uploadedAt: string;
}

export interface ApplicationDto {
  id: string;
  status: ApplicationStatus;
  phone: string;
  fullName: string | null;
  nni: string | null;
  dateOfBirth: string | null;
  addressLabel: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  whatsapp: string | null;
  vehiclePlate: string | null;
  vehicleBrand: string | null;
  vehicleModel: string | null;
  vehicleYear: number | null;
  vehicleColor: string | null;
  vehicleSeats: number | null;
  vehicleType: VehicleType;
  acceptsColis: boolean;
  acceptsLongDistance: boolean;
  agencyCode?: string | null;
  rejectReason?: string | null;
  correctionNotes?: string | null;
  documents: AppDoc[];
  documentRequirements?: { type: DocumentType; stage?: DocumentStage }[];
}

/**
 * Ce que chaque document bloque tant qu'il manque (migration 0087).
 *
 *   application — la candidature ne part pas sans lui.
 *   online      — le captain est accepté, mais ne peut pas rouler.
 *   off         — déposable, ne bloque rien.
 */
export type DocumentStage = 'application' | 'online' | 'off';

/**
 * Les types bloquants à une étape.
 *
 * Repli quand le serveur ne renvoie pas encore la liste (ancienne API) : on
 * réclame le permis et la carte grise à la candidature et rien ailleurs —
 * la politique par défaut, plutôt que « tout est obligatoire » qui rendrait
 * la candidature impossible à envoyer.
 *
 * `online` est vide (0089) : aucun document ne barre la route après
 * l'acceptation. Le repli doit refléter la politique par défaut, pas une
 * exigence que le serveur n'applique plus — sinon un client sur une API
 * ancienne bloquerait des captains que le serveur laisse rouler.
 */
const FALLBACK_STAGES: Record<DocumentStage, DocumentType[]> = {
  application: ['license_front', 'carte_grise'],
  online: [],
  off: [],
};

export function docTypesForStage(
  a: ApplicationDto,
  stage: DocumentStage,
): DocumentType[] {
  const reqs = a.documentRequirements;
  // Une API antérieure à la 0087 renvoie `{ type, isRequired }` : la liste est
  // bien là, mais `stage` est absent de CHAQUE entrée. Ne tester que la
  // présence de la liste laissait alors le filtre ne rien matcher — aucune
  // pièce affichée, `docsComplete` vrai par vacuité, et le bouton « Envoyer »
  // partait se faire refuser par le serveur. Tant qu'aucune entrée ne porte de
  // `stage`, on retombe sur la politique par défaut.
  if (!reqs?.length || !reqs.some((r) => r.stage)) return FALLBACK_STAGES[stage];
  return DOCUMENT_ORDER.filter((type) =>
    reqs.find((r) => r.type === type)?.stage === stage);
}

/** Les documents qui bloquent l'envoi de la candidature sont-ils tous là ? */
export function docsComplete(a: ApplicationDto): boolean {
  const have = new Set(a.documents.map((d) => d.type));
  return docTypesForStage(a, 'application').every((t) => have.has(t));
}
