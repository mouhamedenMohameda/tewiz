/**
 * Bell button with unread-count badge.
 *
 * Polls /notifications light-weight every 60 s to keep the badge fresh. Tap
 * routes to /(app)/notifications.
 */

import { Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import { AppText, Icon } from '@/components/ui';
import { useApiQuery } from '@/lib/useApiQuery';
import { UNREAD_KEY } from '@/lib/notificationKeys';
import { colors, radius, shadow, spacing } from '@/theme';

export function NotificationsBellButton() {
  const router = useRouter();
  // Shared `['notifications','unread']` cache: the bell renders on several
  // screens, so they all read one poll and the badge updates everywhere at
  // once instead of each mount running its own 60 s timer.
  const { data } = useApiQuery<{ unreadCount: number }>(
    UNREAD_KEY,
    '/notifications?limit=1',
    { pollMs: 60_000, staleMs: 30_000 },
  );
  const unread = data?.unreadCount ?? 0;

  return (
    <Pressable
      onPress={() => router.push('/(app)/notifications')}
      hitSlop={10}
      accessibilityLabel="Notifications"
      style={{
        width: 44, height: 44, borderRadius: radius.md,
        backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center',
        ...shadow.card,
      }}
    >
      <Icon name={unread > 0 ? 'bellFilled' : 'bell'} size={22} color={unread > 0 ? colors.ember : colors.ink} />
      {unread > 0 && (
        <View style={{
          position: 'absolute',
          top: 4, right: 4,
          // minHeight, not height: the count inside scales with Dynamic Type,
          // and a fixed 18pt box would clip "99+" at large text sizes.
          minWidth: 18, minHeight: 18, borderRadius: 9,
          backgroundColor: colors.ember,
          paddingHorizontal: 5,
          alignItems: 'center', justifyContent: 'center',
        }}>
          <AppText variant="caption" color={colors.white} style={{ fontSize: 11, lineHeight: 14, fontWeight: '700' }}>
            {unread > 99 ? '99+' : String(unread)}
          </AppText>
        </View>
      )}
    </Pressable>
  );
}
