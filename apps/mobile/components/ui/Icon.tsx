/**
 * Semantic icon registry over @expo/vector-icons.
 *
 * Screens reference icons by *meaning* (`<Icon name="voice" />`), not by glyph,
 * so we can recolor, resize and swap the underlying set from one place. This is
 * what replaces the old emoji (🚖 🎙 🧾 …) — emoji can't be recolored or sized
 * to the grid; these can.
 */

import Ionicons from '@expo/vector-icons/Ionicons';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { colors } from '@/theme';

type IconEntry =
  | { set: 'ion'; glyph: React.ComponentProps<typeof Ionicons>['name'] }
  | { set: 'mci'; glyph: React.ComponentProps<typeof MaterialCommunityIcons>['name'] };

const REGISTRY = {
  ride: { set: 'mci', glyph: 'car-side' },
  voice: { set: 'ion', glyph: 'mic' },
  map: { set: 'ion', glyph: 'map' },
  pin: { set: 'ion', glyph: 'location' },
  history: { set: 'ion', glyph: 'receipt-outline' },
  drivers: { set: 'mci', glyph: 'account-heart-outline' },
  recurring: { set: 'ion', glyph: 'repeat' },
  calendar: { set: 'ion', glyph: 'calendar-outline' },
  captain: { set: 'mci', glyph: 'steering' },
  wallet: { set: 'ion', glyph: 'wallet-outline' },
  heatmap: { set: 'ion', glyph: 'flame' },
  home: { set: 'ion', glyph: 'home' },
  power: { set: 'ion', glyph: 'power' },
  refresh: { set: 'ion', glyph: 'refresh' },
  cash: { set: 'ion', glyph: 'cash-outline' },
  logout: { set: 'ion', glyph: 'log-out-outline' },
  chevron: { set: 'ion', glyph: 'chevron-forward' },
  chevronBack: { set: 'ion', glyph: 'chevron-back' },
  chevronDown: { set: 'ion', glyph: 'chevron-down' },
  search: { set: 'ion', glyph: 'search' },
  arrow: { set: 'ion', glyph: 'arrow-forward' },
  eye: { set: 'ion', glyph: 'eye-outline' },
  eyeOff: { set: 'ion', glyph: 'eye-off-outline' },
  phone: { set: 'ion', glyph: 'call-outline' },
  lock: { set: 'ion', glyph: 'lock-closed-outline' },
  whatsapp: { set: 'ion', glyph: 'logo-whatsapp' },
  check: { set: 'ion', glyph: 'checkmark-circle' },
  checkSmall: { set: 'ion', glyph: 'checkmark' },
  sparkle: { set: 'ion', glyph: 'sparkles' },
  star: { set: 'ion', glyph: 'star' },
  person: { set: 'ion', glyph: 'person-circle-outline' },
  shield: { set: 'ion', glyph: 'shield-checkmark' },
  clock: { set: 'ion', glyph: 'time-outline' },
  alert: { set: 'ion', glyph: 'alert-circle' },
  close: { set: 'ion', glyph: 'close' },
  trash: { set: 'ion', glyph: 'trash-outline' },
  send: { set: 'ion', glyph: 'paper-plane' },
  document: { set: 'ion', glyph: 'document-text-outline' },
  car: { set: 'mci', glyph: 'car-estate' },
  parcel: { set: 'mci', glyph: 'package-variant-closed' },
  tune: { set: 'mci', glyph: 'tune-variant' },
  restaurant: { set: 'ion', glyph: 'restaurant' },
  menu: { set: 'mci', glyph: 'silverware-fork-knife' },
} as const satisfies Record<string, IconEntry>;

export type IconName = keyof typeof REGISTRY;

export interface IconProps {
  name: IconName;
  size?: number;
  color?: string;
}

export function Icon({ name, size = 22, color = colors.ink }: IconProps) {
  const entry = REGISTRY[name];
  if (entry.set === 'ion') {
    return <Ionicons name={entry.glyph} size={size} color={color} />;
  }
  return <MaterialCommunityIcons name={entry.glyph} size={size} color={color} />;
}
