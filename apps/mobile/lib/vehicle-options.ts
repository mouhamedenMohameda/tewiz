/**
 * Curated lists of vehicle brands and colours used by the KYC vehicle form.
 *
 * Brands cover what is actually on Mauritanian roads (Toyota, Hyundai, Kia,
 * Mercedes, Renault, Peugeot, Nissan…) with an `other` escape hatch. Colours
 * are stored as language-agnostic keys; the UI looks up the localized label.
 */

export const VEHICLE_BRANDS = [
  'Toyota',
  'Hyundai',
  'Kia',
  'Nissan',
  'Mercedes-Benz',
  'BMW',
  'Renault',
  'Peugeot',
  'Citroën',
  'Ford',
  'Mitsubishi',
  'Mazda',
  'Honda',
  'Suzuki',
  'Volkswagen',
  'Audi',
  'Chevrolet',
  'Dacia',
  'Fiat',
  'Land Rover',
  'Lexus',
  'Opel',
  'Skoda',
  'Subaru',
  'Volvo',
  'Iveco',
  'Isuzu',
  'Tata',
] as const;

export interface ColorOption {
  /** Stable key persisted by the API (English). */
  key: string;
  /** CSS hex for the swatch. */
  hex: string;
}

export const VEHICLE_COLORS: ColorOption[] = [
  { key: 'white',  hex: '#F8F8F8' },
  { key: 'black',  hex: '#0F172A' },
  { key: 'silver', hex: '#C0C0C0' },
  { key: 'gray',   hex: '#6B7280' },
  { key: 'beige',  hex: '#E5D3B3' },
  { key: 'red',    hex: '#DC2626' },
  { key: 'blue',   hex: '#2563EB' },
  { key: 'navy',   hex: '#1E3A8A' },
  { key: 'green',  hex: '#16A34A' },
  { key: 'yellow', hex: '#FACC15' },
  { key: 'orange', hex: '#F97316' },
  { key: 'brown',  hex: '#78350F' },
  { key: 'gold',   hex: '#D4AF37' },
];

export function colorHexFor(key: string | null | undefined): string | undefined {
  if (!key) return undefined;
  return VEHICLE_COLORS.find((c) => c.key === key.toLowerCase())?.hex;
}
