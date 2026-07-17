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

import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { api } from '@/lib/api';
import { AppText, Card, Icon, PressableScale, Screen, ScreenHeader } from '@/components/ui';
import { colors, radius, spacing } from '@/theme';

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

const TYPE_ACCENT: Record<string, { tint: string; fg: string }> = {
  bonus_earned:  { tint: colors.successSoft, fg: colors.success },
  bonus_config:  { tint: colors.saffronSoft, fg: colors.warning },
  system:        { tint: colors.surfaceAlt,  fg: colors.ink },
  info:          { tint: colors.surfaceAlt,  fg: colors.ink },
};

export default function NotificationsScreen() {
  const router = useRouter();
  const { t, i18n } = useTranslation();
  const [data, setData] = useState<InboxResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await api.get<InboxResponse>('/notifications');
      setData(r.data);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const markRead = async (id: string) => {
    setData((prev) => prev ? {
      ...prev,
      items: prev.items.map((it) => it.id === id ? { ...it, readAt: it.readAt ?? new Date().toISOString() } : it),
      unreadCount: Math.max(0, prev.unreadCount - 1),
    } : prev);
    try {
      await api.post(`/notifications/${id}/read`);
    } catch {
      // silent — next load will re-sync
    }
  };

  const markAllRead = async () => {
    setData((prev) => prev ? {
      ...prev,
      items: prev.items.map((it) => it.readAt ? it : { ...it, readAt: new Date().toISOString() }),
      unreadCount: 0,
    } : prev);
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

      {loading && !data && (
        <View style={{ marginTop: spacing.xxl, alignItems: 'center' }}>
          <ActivityIndicator color={colors.ember} />
        </View>
      )}

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: spacing.xxl }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => { setRefreshing(true); load(); }}
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
