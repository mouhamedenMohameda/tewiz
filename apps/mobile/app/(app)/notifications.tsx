/**
 * /notifications — user inbox.
 *
 * Lists notifications from /notifications. Unread rows have a colored border
 * and a small dot; tapping an item marks it read. A "tout lire" button at the
 * top marks every unread item read in one shot.
 *
 * Both captains and riders can open this screen; the server filters by
 * recipient_id so each user sees only their own messages.
 */

import { useCallback } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useApiQuery } from '@/lib/useApiQuery';
import { INBOX_KEY, UNREAD_KEY } from '@/lib/notificationKeys';
import { AppText, Card, Icon, PressableScale, Screen, ScreenHeader } from '@/components/ui';
import { colors, radius, schemed, spacing } from '@/theme';

interface InboxItem {
  id: string;
  type: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
  readAt: string | null;
  createdAt: string;
}

interface InboxResponse {
  items: InboxItem[];
  unreadCount: number;
}

// schemed(): a bare object literal here would freeze whichever
// palette was active when this module was first imported, and then
// never follow the user into dark mode.
const TYPE_ACCENT = schemed((): Record<string, { tint: string; fg: string }> => ({
  bonus_earned:  { tint: colors.successSoft, fg: colors.success },
  bonus_config:  { tint: colors.saffronSoft, fg: colors.warning },
  system:        { tint: colors.surfaceAlt,  fg: colors.ink },
  info:          { tint: colors.surfaceAlt,  fg: colors.ink },
}));

export default function NotificationsScreen() {
  const router = useRouter();
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const {
    data, isLoading, isFetching, refetch,
  } = useApiQuery<InboxResponse>(INBOX_KEY, '/notifications');

  /**
   * Apply an optimistic change to the cached inbox, then tell the bell badge
   * to re-check itself.
   *
   * The badge lives on a DIFFERENT query (`['notifications','unread']`, polled
   * every 60 s by NotificationsBellButton). Without the invalidate, marking
   * everything read here left the bell showing a count for up to a minute
   * after the list it counts had visibly emptied.
   */
  const patchInbox = useCallback((fn: (prev: InboxResponse) => InboxResponse) => {
    queryClient.setQueryData<InboxResponse>(INBOX_KEY, (prev) => (prev ? fn(prev) : prev));
    void queryClient.invalidateQueries({ queryKey: UNREAD_KEY });
  }, [queryClient]);

  const markRead = async (id: string) => {
    patchInbox((prev) => ({
      ...prev,
      items: prev.items.map((it) => it.id === id ? { ...it, readAt: it.readAt ?? new Date().toISOString() } : it),
      unreadCount: Math.max(0, prev.unreadCount - 1),
    }));
    try {
      await api.post(`/notifications/${id}/read`);
    } catch {
      // silent — next load will re-sync
    }
  };

  const markAllRead = async () => {
    patchInbox((prev) => ({
      ...prev,
      items: prev.items.map((it) => it.readAt ? it : { ...it, readAt: new Date().toISOString() }),
      unreadCount: 0,
    }));
    try {
      await api.post('/notifications/read-all');
    } catch {
      // silent
    }
  };

  return (
    <Screen>
      <ScreenHeader
        title={t('inbox.title')}
        onBack={() => router.back()}
        right={data && data.unreadCount > 0 ? (
          <PressableScale onPress={markAllRead}>
            <AppText variant="label" color={colors.ember}>{t('inbox.markAllRead')}</AppText>
          </PressableScale>
        ) : null}
      />

      {isLoading && !data && (
        <View style={{ marginTop: spacing.xxl, alignItems: 'center' }}>
          <ActivityIndicator color={colors.ember} />
        </View>
      )}

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: spacing.xxl }}
        refreshControl={
          <RefreshControl
            refreshing={isFetching}
            onRefresh={refetch}
            tintColor={colors.ember}
          />
        }
      >
        {data && data.items.length === 0 && (
          <View style={{ alignItems: 'center', marginTop: spacing.xxl }}>
            <Icon name="bell" size={56} color={colors.faint} />
            <AppText variant="bodyStrong" color={colors.muted} style={{ marginTop: spacing.base }}>
              {t('inbox.emptyTitle')}
            </AppText>
            <AppText variant="caption" color={colors.ink2} style={{ marginTop: spacing.xs, textAlign: 'center' }}>
              {t('inbox.emptyHint')}
            </AppText>
          </View>
        )}

        {data?.items.map((item) => {
          const accent = TYPE_ACCENT[item.type] ?? TYPE_ACCENT.info!;
          const unread = !item.readAt;
          return (
            <Card
              key={item.id}
              onPress={() => unread && markRead(item.id)}
              padding={spacing.lg}
              style={{
                marginTop: spacing.base,
                flexDirection: 'row',
                gap: spacing.base,
                ...(unread ? { borderColor: accent.fg, borderWidth: 1 } : null),
              }}
            >
              <View style={{
                width: 42, height: 42, borderRadius: radius.md,
                backgroundColor: accent.tint, alignItems: 'center', justifyContent: 'center',
              }}>
                <Icon name="bell" size={20} color={accent.fg} />
              </View>
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
                  <AppText variant="bodyStrong" style={{ flex: 1 }}>{item.title}</AppText>
                  {unread && (
                    <View style={{
                      width: 8, height: 8, borderRadius: 4, backgroundColor: accent.fg,
                    }} />
                  )}
                </View>
                <AppText variant="body" color={colors.ink2} style={{ marginTop: 2 }}>
                  {item.body}
                </AppText>
                <AppText variant="caption" color={colors.muted} style={{ marginTop: spacing.xs }}>
                  {new Date(item.createdAt).toLocaleString(i18n.language, {
                    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
                  })}
                </AppText>
              </View>
            </Card>
          );
        })}
      </ScrollView>
    </Screen>
  );
}
