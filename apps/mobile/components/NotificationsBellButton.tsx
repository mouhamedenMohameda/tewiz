/**
 * Bell button with unread-count badge.
 *
 * Polls /notifications light-weight every 60 s to keep the badge fresh. Tap
 * routes to /(app)/notifications.
 */

import { useCallback, useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import { api } from '@/lib/api';
import { AppText, Icon } from '@/components/ui';
import { colors, radius, shadow, spacing } from '@/theme';

export function NotificationsBellButton() {
  const router = useRouter();
  const [unread, setUnread] = useState(0);

  const refresh = useCallback(async () => {
    try {
      const r = await api.get<{ unreadCount: number }>('/notifications?limit=1');
      setUnread(r.data.unreadCount);
    } catch {
      // silent
    }
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 60_000);
    return () => clearInterval(id);
  }, [refresh]);

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
          minWidth: 18, height: 18, borderRadius: 9,
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
