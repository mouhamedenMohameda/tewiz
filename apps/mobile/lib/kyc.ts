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
  vehiclePlate: string | null;
  vehicleBrand: string | null;
  vehicleModel: string | null;
  vehicleYear: number | null;
  vehicleColor: string | null;
  vehicleSeats: number | null;
  acceptsColis: boolean;
  acceptsLongDistance: boolean;
  rejectReason?: string | null;
  correctionNotes?: string | null;
  documents: AppDoc[];
  documentRequirements?: { type: DocumentType; isRequired: boolean }[];
}

/** Types currently marked as required by the admin. Defaults to "all required"
 *  when the server doesn't (yet) return the requirement list. */
export function requiredDocTypes(a: ApplicationDto): Set<DocumentType> {
  if (!a.documentRequirements) return new Set(DOCUMENT_ORDER);
  return new Set(
    a.documentRequirements.filter((r) => r.isRequired).map((r) => r.type),
  );
}

export function isDocRequired(a: ApplicationDto, type: DocumentType): boolean {
  if (!a.documentRequirements) return true;
  return a.documentRequirements.find((r) => r.type === type)?.isRequired ?? true;
}

export function personalFieldsComplete(a: ApplicationDto): boolean {
  return !!(
    a.fullName && a.nni && a.dateOfBirth &&
    a.addressLabel && a.emergencyContactPhone
  );
}

export function vehicleFieldsComplete(a: ApplicationDto): boolean {
  return !!(
    a.vehiclePlate && a.vehicleBrand && a.vehicleModel &&
    a.vehicleYear && a.vehicleColor && a.vehicleSeats
  );
}

export function docsComplete(a: ApplicationDto): boolean {
  const have = new Set(a.documents.map((d) => d.type));
  const required = requiredDocTypes(a);
  for (const t of required) {
    if (!have.has(t)) return false;
  }
  return true;
}
