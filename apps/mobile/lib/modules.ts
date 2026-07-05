import type { IconName } from '@/components/ui';
import { colors } from '@/theme';

export interface AppModule {
  key: string;
  icon: IconName;
  label: string;
  route: string;
  tint: string;
  fg: string;
}

export const APP_MODULES: AppModule[] = [
  { key: 'carpooling', icon: 'tfag', label: 'Tfag', route: '/(app)/carpooling', tint: colors.emberSoft, fg: colors.ember },
  { key: 'private_driver', icon: 'clock', label: 'Chauffeur Privé', route: '/(app)/rider/private-driver', tint: '#dbeafe', fg: '#1e40af' },
  { key: 'convoyage', icon: 'ride', label: 'Convoyage', route: '/(app)/rider/convoyage', tint: '#ede9fe', fg: '#7c3aed' },
  { key: 'car_rental', icon: 'ride', label: 'Location Auto', route: '/(app)/rider/car-rental', tint: '#fef3c7', fg: '#d97706' },
  { key: 'roadside_assistance', icon: 'check', label: 'Assistance Routière', route: '/(app)/rider/roadside-assistance', tint: '#fee2e2', fg: '#dc2626' },
  { key: 'light_moving', icon: 'ride', label: 'Déménagement Léger', route: '/(app)/rider/light-moving', tint: '#dbeafe', fg: '#0284c7' },
  { key: 'intercity_freight', icon: 'ride', label: 'Fret Intercité', route: '/(app)/rider/intercity-freight', tint: '#f3e8ff', fg: '#a855f7' },
  { key: 'equipment_rental', icon: 'clock', label: 'Location Équipement', route: '/(app)/rider/equipment-rental', tint: '#e0e7ff', fg: '#6366f1' },
  { key: 'history', icon: 'history', label: 'rider.home.history', route: '/(app)/rider/history', tint: colors.saffronSoft, fg: colors.warning },
  { key: 'favorites', icon: 'drivers', label: 'rider.home.drivers', route: '/(app)/rider/favorites', tint: '#E9EFE6', fg: colors.success },
  { key: 'recurring', icon: 'recurring', label: 'rider.home.recurring', route: '/(app)/rider/recurring', tint: '#FDE2D7', fg: colors.emberDeep },
  { key: 'restaurants', icon: 'restaurant', label: 'rider.home.restaurants', route: '/(app)/rider/restaurants', tint: '#E6F4EA', fg: colors.success },
];
