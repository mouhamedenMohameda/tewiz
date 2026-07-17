import type { IconName } from '@/components/ui';
import { colors } from '@/theme';

/**
 * `tier` drives the home screen's visual hierarchy (see rider/index.tsx):
 *  - spotlight : the 1-2 services worth a full-size featured card
 *  - transport / logistics / food : secondary services, grouped behind tabs
 *  - utility : personal shortcuts (history, favorites...), bundled into one
 *    low-emphasis card rather than competing with actual services
 */
export type ModuleTier = 'spotlight' | 'transport' | 'logistics' | 'food' | 'utility';

export interface AppModule {
  key: string;
  icon: IconName;
  label: string;
  route: string;
  tint: string;
  fg: string;
  tier: ModuleTier;
}

export const APP_MODULES: AppModule[] = [
  { key: 'private_driver', icon: 'clock', label: 'rider.home.modules.private_driver', route: '/(app)/listings?category=private_driver', tint: '#dbeafe', fg: '#1e40af', tier: 'spotlight' },
  { key: 'carpooling', icon: 'Ervdni', label: 'rider.home.modules.carpooling', route: '/(app)/carpooling', tint: colors.emberSoft, fg: colors.ember, tier: 'spotlight' },
  { key: 'convoyage', icon: 'ride', label: 'rider.home.modules.convoyage', route: '/(app)/convoyage', tint: '#ede9fe', fg: '#7c3aed', tier: 'transport' },
  { key: 'car_rental', icon: 'car', label: 'rider.home.modules.car_rental', route: '/(app)/car-rental', tint: '#fef3c7', fg: '#d97706', tier: 'transport' },
  { key: 'roadside_assistance', icon: 'shield', label: 'rider.home.modules.roadside_assistance', route: '/(app)/roadside', tint: '#fee2e2', fg: '#dc2626', tier: 'logistics' },
  { key: 'light_moving', icon: 'parcel', label: 'rider.home.modules.light_moving', route: '/(app)/listings?category=light_moving', tint: '#dbeafe', fg: '#0284c7', tier: 'logistics' },
  { key: 'intercity_freight', icon: 'car', label: 'rider.home.modules.intercity_freight', route: '/(app)/freight', tint: '#f3e8ff', fg: '#a855f7', tier: 'logistics' },
  { key: 'equipment_rental', icon: 'tune', label: 'rider.home.modules.equipment_rental', route: '/(app)/listings?category=equipment_rental', tint: '#e0e7ff', fg: '#6366f1', tier: 'logistics' },
  { key: 'history', icon: 'history', label: 'rider.home.history', route: '/(app)/rider/history', tint: colors.saffronSoft, fg: colors.warning, tier: 'utility' },
  { key: 'favorites', icon: 'drivers', label: 'rider.home.drivers', route: '/(app)/rider/favorites', tint: '#E9EFE6', fg: colors.success, tier: 'utility' },
  { key: 'recurring', icon: 'recurring', label: 'rider.home.recurring', route: '/(app)/rider/recurring', tint: '#FDE2D7', fg: colors.emberDeep, tier: 'utility' },
  { key: 'restaurants', icon: 'restaurant', label: 'rider.home.restaurants', route: '/(app)/rider/restaurants', tint: '#E6F4EA', fg: colors.success, tier: 'food' },
];
