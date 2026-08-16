/**
 * French labels for the scenario axes.
 *
 * Kept in a plain map rather than i18n: admin-web has no translation layer and
 * these are operator-facing terms in a single language.
 */

export const STRUCTURE_LABELS: Record<string, string> = {
  pickup_only: 'Départ seul',
  destination_only: 'Destination seule',
  from_to: 'De X vers Y',
  round_trip: 'Aller-retour',
  open_ride: 'Course ouverte',
};

export const NOISE_LABELS: Record<string, string> = {
  quiet_indoor: 'Intérieur calme',
  street: 'Dans la rue',
  moving_car: 'Voiture en marche',
  wind: 'Vent',
};

export const LANGUAGE_LABELS: Record<string, string> = {
  hassaniya: 'Hassaniya pur',
  hassaniya_french: 'Hassaniya + français',
  french: 'Français',
  arabic: 'Arabe littéraire',
};

export const DIFFICULTY_LABELS: Record<string, string> = {
  plain: 'Nom simple',
  landmarks: 'Avec repères',
  homonym: 'Nom ambigu',
  vague: 'Lieu imprécis',
};

export const ZONE_LABELS: Record<string, string> = {
  tevragh_zeina: 'Tevragh-Zeina',
  ksar: 'Ksar',
  sebkha: 'Sebkha',
  riyad: 'Riyad',
  arafat: 'Arafat',
  toujounine: 'Toujounine',
  dar_naim: 'Dar Naim',
  el_mina: 'El Mina',
  teyarett: 'Teyarett',
};

export const AXIS_LABELS: {
  key: 'structure' | 'noise' | 'language' | 'difficulty' | 'zone';
  title: string;
  labels: Record<string, string>;
}[] = [
  { key: 'structure', title: 'Structure', labels: STRUCTURE_LABELS },
  { key: 'noise', title: 'Ambiance sonore', labels: NOISE_LABELS },
  { key: 'language', title: 'Langue', labels: LANGUAGE_LABELS },
  { key: 'difficulty', title: 'Difficulté', labels: DIFFICULTY_LABELS },
  { key: 'zone', title: 'Quartier', labels: ZONE_LABELS },
];

export function scenarioSummary(s: {
  structure: string; noise: string; language: string; difficulty: string; zone: string;
}): string {
  return [
    STRUCTURE_LABELS[s.structure] ?? s.structure,
    ZONE_LABELS[s.zone] ?? s.zone,
    LANGUAGE_LABELS[s.language] ?? s.language,
    NOISE_LABELS[s.noise] ?? s.noise,
    DIFFICULTY_LABELS[s.difficulty] ?? s.difficulty,
  ].join(' · ');
}
