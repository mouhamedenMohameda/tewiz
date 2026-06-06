// Shapes the API returns. Kept loose where the API hasn't fully nailed shapes.

export type ApplicationStatus =
  | 'draft' | 'submitted' | 'under_review' | 'needs_correction'
  | 'approved' | 'rejected';

export type DocumentType =
  | 'selfie' | 'nni_front' | 'nni_back'
  | 'license_front' | 'license_back'
  | 'carte_grise' | 'assurance' | 'vignette' | 'visite_technique'
  | 'car_front' | 'car_back' | 'car_left' | 'car_right' | 'car_interior';

export interface ApplicationListItem {
  id: string;
  phone: string;
  full_name: string | null;
  status: ApplicationStatus;
  submitted_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ApplicationDocument {
  id: string;
  type: DocumentType;
  status: 'pending' | 'approved' | 'rejected' | 'expired';
  expires_at: string | null;
  reject_reason: string | null;
  uploaded_at: string;
  content_hash: string;
}

export interface ApplicationDetail {
  application: {
    id: string;
    phone: string;
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
    submitted_at: string | null;
    status: ApplicationStatus;
  };
  documents: ApplicationDocument[];
}

export type TopupStatus = 'pending' | 'approved' | 'partial' | 'rejected' | 'duplicate';
export type TopupProvider = 'bankily' | 'masrivi' | 'sedad' | 'cash_office';

export interface TopupListItem {
  id: string;
  captainId: string;
  provider: TopupProvider;
  referenceCode: string;
  claimedAmountKhoums: number;
  providerRefNumber: string | null;
  status: TopupStatus;
  approvedAmountKhoums: number | null;
  rejectReason: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  createdAt: string;
  captain: { phone: string; fullName: string | null };
}

export const DOCUMENT_TYPES: DocumentType[] = [
  'selfie',
  'nni_front', 'nni_back',
  'license_front', 'license_back',
  'carte_grise', 'assurance', 'vignette', 'visite_technique',
  'car_front', 'car_back', 'car_left', 'car_right', 'car_interior',
];

export const DOCUMENT_LABELS: Record<DocumentType, string> = {
  selfie: 'Selfie',
  nni_front: 'NNI (recto)',
  nni_back: 'NNI (verso)',
  license_front: 'Permis (recto)',
  license_back: 'Permis (verso)',
  carte_grise: 'Carte grise',
  assurance: 'Assurance',
  vignette: 'Vignette',
  visite_technique: 'Visite technique',
  car_front: 'Voiture (avant)',
  car_back: 'Voiture (arrière)',
  car_left: 'Voiture (gauche)',
  car_right: 'Voiture (droite)',
  car_interior: 'Voiture (intérieur)',
};
