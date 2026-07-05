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
  { key: 'history', icon: 'history', label: 'rider.home.history', route: '/(app)/rider/history', tint: colors.saffronSoft, fg: colors.warning },
  { key: 'favorites', icon: 'drivers', label: 'rider.home.drivers', route: '/(app)/rider/favorites', tint: '#E9EFE6', fg: colors.success },
  { key: 'recurring', icon: 'recurring', label: 'rider.home.recurring', route: '/(app)/rider/recurring', tint: '#FDE2D7', fg: colors.emberDeep },
  { key: 'restaurants', icon: 'restaurant', label: 'rider.home.restaurants', route: '/(app)/rider/restaurants', tint: '#E6F4EA', fg: colors.success },
];
