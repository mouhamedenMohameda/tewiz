/**
 * Ce qu'il reste au Captain à fournir après son acceptation.
 *
 * L'onboarding v3 accepte quelqu'un sur son permis et sa carte grise, puis
 * réclame le reste — véhicule déclaré, assurance, photo du véhicule, NNI — de
 * l'autre côté du "oui". Ce module est la lecture de cet état, partagée par
 * l'accueil Captain (carte de complétion + interrupteur « en ligne » grisé) et
 * l'écran de complétion lui-même.
 *
 * Le serveur reste l'autorité : POST /captain/state/online refuse un profil
 * incomplet même si le client se trompe. Ce qui suit sert à expliquer le
 * blocage au captain, pas à le faire respecter.
 */

import { useCallback, useEffect, useState } from 'react';
import { api } from './api';
import type { DocumentType, VehicleType } from './kyc';

export type DocGapReason = 'missing' | 'pending' | 'rejected' | 'expired';

export interface DocGap {
  type: DocumentType;
  reason: DocGapReason;
}

export interface OnboardingVehicle {
  id: string;
  plate: string;
  brand: string;
  model: string;
  year: number;
  color: string;
  seats: number;
  vehicleType: VehicleType;
  /** null tant qu'un opérateur ne l'a pas confronté à la carte grise. */
  verifiedAt: string | null;
}

export interface OnboardingStatus {
  /** Nom affiché aux clients. Repris du compte, sinon saisi à la complétion. */
  fullName: string | null;
  vehicle: OnboardingVehicle | null;
  onlineGaps: DocGap[];
  canGoOnline: boolean;
}

export async function fetchOnboardingStatus(): Promise<OnboardingStatus> {
  const r = await api.get<OnboardingStatus>('/captain/onboarding');
  return r.data;
}

/**
 * Nombre d'éléments encore bloquants pour rouler — véhicule non déclaré ou non
 * vérifié compte pour un.
 */
export function remainingForOnline(s: OnboardingStatus): number {
  // Déclarer le véhicule est une action du captain, donc décomptée. La
  // vérification par les ops n'en est pas une : l'afficher comme « reste 1 »
  // donnait un compteur que le captain ne pouvait pas faire descendre.
  const vehicleGap = !s.vehicle ? 1 : 0;
  const nameGap = s.fullName ? 0 : 1;
  return nameGap + vehicleGap + s.onlineGaps.length;
}

export function useOnboarding() {
  const [status, setStatus] = useState<OnboardingStatus | null>(null);
  const [error, setError] = useState<unknown>(null);

  const reload = useCallback(async () => {
    try {
      setStatus(await fetchOnboardingStatus());
      setError(null);
    } catch (e) {
      // Un échec réseau ne doit pas faire croire au captain que son profil est
      // incomplet : on garde le dernier état connu et on laisse le serveur
      // trancher au moment du passage en ligne.
      setError(e);
    }
  }, []);

  useEffect(() => { reload(); }, [reload]);

  return { status, error, reload };
}
