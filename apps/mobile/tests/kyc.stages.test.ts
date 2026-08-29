/**
 * Compatibilité de version entre l'app et l'API sur les étapes documentaires.
 *
 * Le cas qui a cassé en vrai : un build récent installé sur un téléphone, une
 * API pas encore déployée. Celle-ci renvoie encore `{ type, isRequired }`, donc
 * une liste PRÉSENTE mais sans `stage`. Filtrer sur `stage` ne matchait alors
 * plus rien : zéro pièce affichée, `docsComplete` vrai par vacuité, bouton
 * « Envoyer » actif — et un refus serveur listant les 8 champs de l'ancien
 * formulaire. Le repli doit se déclencher sur l'absence de `stage`, pas sur
 * l'absence de la liste.
 */
import { describe, expect, it } from 'vitest';
import { docTypesForStage, docsComplete, type ApplicationDto } from '../lib/kyc';

const base: ApplicationDto = {
  id: 'a1', status: 'draft', phone: '+22200000000',
  fullName: null, nni: null, dateOfBirth: null, addressLabel: null,
  emergencyContactName: null, emergencyContactPhone: null, whatsapp: null,
  vehiclePlate: null, vehicleBrand: null, vehicleModel: null, vehicleYear: null,
  vehicleColor: null, vehicleSeats: null, vehicleType: 'car',
  acceptsColis: false, acceptsLongDistance: false, documents: [],
};

describe('docTypesForStage', () => {
  it('utilise le repli quand le serveur ne renvoie aucune liste', () => {
    expect(docTypesForStage(base, 'application')).toEqual(['license_front', 'carte_grise']);
  });

  it('utilise le repli face à une API pré-0087 (liste présente, `stage` absent)', () => {
    const legacy = {
      ...base,
      documentRequirements: [
        { type: 'nni_front', isRequired: true },
        { type: 'license_front', isRequired: true },
        { type: 'carte_grise', isRequired: true },
        { type: 'assurance', isRequired: true },
        { type: 'car_front', isRequired: true },
      ] as unknown as ApplicationDto['documentRequirements'],
    };
    expect(docTypesForStage(legacy, 'application')).toEqual(['license_front', 'carte_grise']);
    // Le piège : sans pièce requise, `docsComplete` renvoyait true sur un
    // dossier vide et laissait envoyer une candidature vouée au refus.
    expect(docsComplete(legacy)).toBe(false);
  });

  it('respecte les étapes envoyées par une API à jour', () => {
    const modern: ApplicationDto = {
      ...base,
      documentRequirements: [
        { type: 'license_front', stage: 'application' },
        { type: 'carte_grise', stage: 'application' },
        { type: 'assurance', stage: 'online' },
        { type: 'car_front', stage: 'online' },
        { type: 'nni_front', stage: 'payout' },
        { type: 'selfie', stage: 'off' },
      ],
    };
    expect(docTypesForStage(modern, 'application')).toEqual(['license_front', 'carte_grise']);
    expect(docTypesForStage(modern, 'online')).toEqual(['assurance', 'car_front']);
    expect(docTypesForStage(modern, 'payout')).toEqual(['nni_front']);
    expect(docTypesForStage(modern, 'off')).toEqual(['selfie']);
  });

  it('suit une politique admin qui déplace une pièce entre étapes', () => {
    const moved: ApplicationDto = {
      ...base,
      documentRequirements: [
        { type: 'license_front', stage: 'application' },
        { type: 'carte_grise', stage: 'application' },
        { type: 'assurance', stage: 'application' },
      ],
    };
    expect(docTypesForStage(moved, 'application'))
      .toEqual(['license_front', 'carte_grise', 'assurance']);
    expect(docTypesForStage(moved, 'online')).toEqual([]);
  });

  it('docsComplete ne regarde que les pièces de la candidature', () => {
    const modern: ApplicationDto = {
      ...base,
      documentRequirements: [
        { type: 'license_front', stage: 'application' },
        { type: 'carte_grise', stage: 'application' },
        { type: 'assurance', stage: 'online' },
      ],
      documents: [
        { id: 'd1', type: 'license_front', status: 'pending', uploadedAt: '2026-08-29' },
        { id: 'd2', type: 'carte_grise', status: 'pending', uploadedAt: '2026-08-29' },
      ],
    };
    // L'assurance manque, mais elle bloque la mise en ligne, pas l'envoi.
    expect(docsComplete(modern)).toBe(true);
  });
});
