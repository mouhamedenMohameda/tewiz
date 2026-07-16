/**
 * "Mes gains partenaire" — dashboard for restaurant / member / agency
 * partner accounts (users referenced by partners.user_id).
 *
 * Near-real-time transparency is the anti-dispute tool of the partner
 * program: every attributed ride shows up here the moment it completes,
 * while the payout itself stays monthly (settlements section).
 *
 * The screen is only reachable from the account screen, which shows the
 * entry point when GET /partner/me answers 200 for the signed-in user.
 */

import { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { api } from '@/lib/api';
import { formatMru } from '@/lib/format';
import { AppText, Card, Screen, ScreenHeader } from '@/components/ui';
import { colors, radius, spacing } from '@/theme';

interface PartnerMe {
  partner: {
    id: string;
    type: 'agency' | 'restaurant' | 'individual';
    name: string;
    code: string;
    status: 'active' | 'suspended' | 'ended';
    shareBps: number;
  };
  earningsByStatus: Partial<Record<'pending' | 'on_hold' | 'settled' | 'cancelled',
    { totalMru: number; count: number }>>;
  quota: { coursesUsed: number; coursesMax: number; endsAt: string } | null;
  windows: {
    captainId: string;
    captainName: string | null;
    coursesCounted: number;
    coursesMax: number;
    expiresAt: string;
    closedAt: string | null;
  }[] | null;
}

interface Earning {
  id: string;
  role: 'ride_creator' | 'captain_provider' | 'closure_bonus' | 'conversion_bonus';
  amountMru: number;
  status: 'pending' | 'on_hold' | 'settled' | 'cancelled';
  createdAt: string;
  ride: { pickupLabel: string | null; dropoffLabel: string | null };
}

interface Settlement {
  id: string;
  periodStart: string;
  periodEnd: string;
  totalMru: number;
  status: 'draft' | 'paid';
  paidAt: string | null;
}

export default function PartnerEarningsScreen() {
  const router = useRouter();
  const { t, i18n } = useTranslation();
  const [me, setMe] = useState<PartnerMe | null>(null);
  const [earnings, setEarnings] = useState<Earning[]>([]);
  const [settlements, setSettlements] = useState<Settlement[]>([]);
  const [error, setError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      setError(false);
      const [m, e, s] = await Promise.all([
        api.get<PartnerMe>('/partner/me'),
        api.get<Earning[]>('/partner/earnings?limit=50'),
        api.get<Settlement[]>('/partner/settlements'),
      ]);
      setMe(m.data);
      setEarnings(e.data);
      setSettlements(s.data);
    } catch {
      setError(true);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function refresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  const fmtDate = (iso: string) =>
    new Date(iso).toLocaleDateString(i18n.language === 'ar' ? 'ar' : 'fr-FR');

  const statusLabel = me?.partner.status === 'active'
    ? t('partner.statusActive')
    : me?.partner.status === 'suspended'
    ? t('partner.statusSuspended')
    : t('partner.statusEnded');

  return (
    <Screen scroll onRefresh={refresh} refreshing={refreshing} contentStyle={{ gap: spacing.md }}>
      <ScreenHeader title={t('partner.title')} onBack={() => router.back()} />
        {error && (
          <AppText color={colors.danger} style={{ marginTop: spacing.lg }}>
            {t('partner.loadError')}
          </AppText>
        )}

        {me && (
          <>
            {/* Contract header */}
            <Card>
              <AppText variant="title">{me.partner.name}</AppText>
              <AppText variant="caption" color={colors.muted} style={{ marginTop: 2 }}>
                {t('partner.code')} {me.partner.code} · {t('partner.share')}{' '}
                {(me.partner.shareBps / 100).toFixed(1)} % · {statusLabel}
              </AppText>

              {/* Totals */}
              <View style={{ flexDirection: 'row', gap: spacing.md, marginTop: spacing.md }}>
                {(['pending', 'on_hold', 'settled'] as const).map((s) => (
                  <View
                    key={s}
                    style={{
                      flex: 1,
                      backgroundColor: colors.surfaceAlt,
                      borderRadius: radius.md,
                      padding: spacing.sm,
                    }}
                  >
                    <AppText variant="caption" color={colors.muted}>
                      {t(`partner.${s === 'on_hold' ? 'onHold' : s}`)}
                    </AppText>
                    <AppText variant="title" style={{ marginTop: 2 }}>
                      {formatMru(me.earningsByStatus[s]?.totalMru ?? 0)}
                    </AppText>
                  </View>
                ))}
              </View>
            </Card>

            {/* Member quota progression */}
            {me.quota && (
              <Card>
                <AppText variant="title">{t('partner.quotaTitle')}</AppText>
                <AppText variant="caption" color={colors.muted} style={{ marginTop: 2 }}>
                  {t('partner.quotaProgress', {
                    used: me.quota.coursesUsed,
                    max: me.quota.coursesMax,
                    date: fmtDate(me.quota.endsAt),
                  })}
                </AppText>
                <ProgressBar ratio={me.quota.coursesUsed / me.quota.coursesMax} />
              </Card>
            )}

            {/* Agency courier windows */}
            {me.windows && me.windows.length > 0 && (
              <Card>
                <AppText variant="title">{t('partner.windowsTitle')}</AppText>
                {me.windows.map((w) => (
                  <View key={w.captainId} style={{ marginTop: spacing.md }}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                      <AppText numberOfLines={1} style={{ flex: 1 }}>
                        {w.captainName ?? '—'}
                      </AppText>
                      <AppText variant="caption" color={w.closedAt ? colors.muted : colors.success}>
                        {w.closedAt ? t('partner.windowClosed') : t('partner.windowOpen')}
                      </AppText>
                    </View>
                    <AppText variant="caption" color={colors.muted}>
                      {t('partner.windowProgress', {
                        count: w.coursesCounted,
                        max: w.coursesMax,
                        date: fmtDate(w.expiresAt),
                      })}
                    </AppText>
                    <ProgressBar ratio={w.coursesCounted / w.coursesMax} muted={!!w.closedAt} />
                  </View>
                ))}
              </Card>
            )}

            {/* Recent earnings */}
            <Card>
              <AppText variant="title">{t('partner.earningsTitle')}</AppText>
              {earnings.length === 0 && (
                <AppText variant="caption" color={colors.muted} style={{ marginTop: spacing.sm }}>
                  {t('partner.empty')}
                </AppText>
              )}
              {earnings.map((e) => (
                <View
                  key={e.id}
                  style={{
                    flexDirection: 'row',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginTop: spacing.md,
                  }}
                >
                  <View style={{ flex: 1, paddingEnd: spacing.sm }}>
                    <AppText numberOfLines={1}>{t(`partner.roles.${e.role}`)}</AppText>
                    <AppText variant="caption" color={colors.muted} numberOfLines={1}>
                      {fmtDate(e.createdAt)}
                      {e.ride.pickupLabel ? ` · ${e.ride.pickupLabel}` : ''}
                    </AppText>
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <AppText style={{ fontWeight: '700' }}>{formatMru(e.amountMru)}</AppText>
                    <AppText
                      variant="caption"
                      color={
                        e.status === 'settled' ? colors.success
                        : e.status === 'on_hold' ? colors.warning
                        : colors.muted
                      }
                    >
                      {t(`partner.${e.status === 'on_hold' ? 'onHold' : e.status === 'settled' ? 'settled' : 'pending'}`)}
                    </AppText>
                  </View>
                </View>
              ))}
            </Card>

            {/* Settlements */}
            {settlements.length > 0 && (
              <Card>
                <AppText variant="title">{t('partner.settlementsTitle')}</AppText>
                {settlements.map((s) => (
                  <View
                    key={s.id}
                    style={{
                      flexDirection: 'row',
                      justifyContent: 'space-between',
                      marginTop: spacing.md,
                    }}
                  >
                    <View>
                      <AppText>
                        {fmtDate(s.periodStart)} → {fmtDate(s.periodEnd)}
                      </AppText>
                      <AppText variant="caption" color={colors.muted}>
                        {s.status === 'paid' && s.paidAt
                          ? t('partner.settlementPaid', { date: fmtDate(s.paidAt) })
                          : t('partner.settlementDraft')}
                      </AppText>
                    </View>
                    <AppText style={{ fontWeight: '700' }}>{formatMru(s.totalMru)}</AppText>
                  </View>
                ))}
              </Card>
            )}
          </>
        )}
    </Screen>
  );
}

function ProgressBar({ ratio, muted }: { ratio: number; muted?: boolean }) {
  return (
    <View
      style={{
        height: 6,
        borderRadius: 3,
        backgroundColor: '#e2e8f0',
        overflow: 'hidden',
        marginTop: spacing.sm,
      }}
    >
      <View
        style={{
          height: '100%',
          width: `${Math.min(100, Math.max(0, ratio * 100))}%`,
          backgroundColor: muted ? '#94a3b8' : colors.ember,
        }}
      />
    </View>
  );
}
