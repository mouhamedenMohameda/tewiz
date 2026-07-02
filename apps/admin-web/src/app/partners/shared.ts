// Shared labels/badges for the partner pages.

import type {
  PartnerEarningRole,
  PartnerEarningStatus,
  PartnerStatus,
  PartnerType,
} from '@tewiz/shared-types';

export const PARTNER_TYPE_LABEL: Record<PartnerType, string> = {
  agency: 'Agence de livraison',
  restaurant: 'Restaurant',
  individual: 'Membre particulier',
};

export const PARTNER_STATUS_LABEL: Record<PartnerStatus, string> = {
  active: 'Actif',
  suspended: 'Suspendu',
  ended: 'Terminé',
};

export const EARNING_ROLE_LABEL: Record<PartnerEarningRole, string> = {
  ride_creator: 'Création de course',
  captain_provider: 'Livreur affilié',
  closure_bonus: 'Prime de clôture',
  conversion_bonus: 'Prime de conversion',
};

export const EARNING_STATUS_LABEL: Record<PartnerEarningStatus, string> = {
  pending: 'En attente',
  on_hold: 'Gelé',
  settled: 'Réglé',
  cancelled: 'Annulé',
};

export function partnerTypeBadge(type: PartnerType) {
  switch (type) {
    case 'agency':     return 'bg-blue-100 text-blue-700';
    case 'restaurant': return 'bg-orange-100 text-orange-700';
    case 'individual': return 'bg-teal-100 text-teal-700';
  }
}

export function partnerStatusBadge(status: PartnerStatus) {
  switch (status) {
    case 'active':    return 'bg-emerald-100 text-emerald-700';
    case 'suspended': return 'bg-amber-100 text-amber-700';
    case 'ended':     return 'bg-slate-100 text-slate-600';
  }
}

export function earningStatusBadge(status: PartnerEarningStatus) {
  switch (status) {
    case 'pending':   return 'bg-blue-100 text-blue-700';
    case 'on_hold':   return 'bg-amber-100 text-amber-700';
    case 'settled':   return 'bg-emerald-100 text-emerald-700';
    case 'cancelled': return 'bg-slate-100 text-slate-500';
  }
}
