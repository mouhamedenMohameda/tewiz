/**
 * Écran Abonnement Captain (migration 0089).
 *
 * LE MESSAGE, EN UNE PHRASE
 *   « Payez une fois, gardez 100% de vos courses. »
 *
 * L'écran n'a que trois états, et il le dit avant tout le reste :
 *   1. abonné       → jusqu'à quand, et le bouton pour prolonger
 *   2. pas abonné   → les formules en vente, une carte par formule
 *   3. désactivé    → un simple message, aucune carte
 *
 * L'écran ne calcule RIEN. Les prix, les durées, la date de fin et même
 * « suis-je abonné » viennent tous de GET /captain/subscription. Un vieux build
 * affiche donc toujours les vrais tarifs du jour, et il n'existe aucun endroit
 * où l'app et le serveur pourraient se contredire.
 */

import { useCallback, useState } from 'react';
import { Alert, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { LinearGradient } from 'expo-linear-gradient';
import { api } from '@/lib/api';
import { useApiQuery } from '@/lib/useApiQuery';
import { formatMru } from '@/lib/format';
import { AppText, Button, Card, Icon, Screen, ScreenHeader } from '@/components/ui';
import { colors, gradients, radius, spacing } from '@/theme';
import { useThemeRepaint } from '@/theme/ThemeProvider';

type Plan = 'week' | 'month';

interface PlanOffer {
  plan: Plan;
  days: number;
  priceMru: number;
}
interface Current {
  id: string;
  plan: Plan;
  startsAt: string;
  endsAt: string;
  daysLeft: number;
}
interface Status {
  enabled: boolean;
  active: boolean;
  current: Current | null;
  /** Le serveur dit si l'achat est ouvert ; l'écran ne recalcule pas la règle. */
  canPurchase: boolean;
  plans: PlanOffer[];
  balanceMru: number;
}

export default function SubscriptionScreen() {
  useThemeRepaint();
  const router = useRouter();
  const { t, i18n } = useTranslation();
  // Quelle formule est en cours d'achat — sert à ne faire tourner le spinner
  // que sur la carte touchée, et à bloquer un double tap.
  const [buying, setBuying] = useState<Plan | null>(null);

  const statusQ = useApiQuery<Status>(['captain', 'subscription'], '/captain/subscription');
  const s = statusQ.data ?? null;

  const buy = useCallback(async (plan: PlanOffer) => {
    // Le solde est revérifié par le serveur ; ce contrôle-ci n'est là que pour
    // proposer tout de suite la recharge au lieu d'un message d'erreur.
    if (s && s.balanceMru < plan.priceMru) {
      Alert.alert(
        t('captain.subscription.lowBalanceTitle'),
        t('captain.subscription.lowBalanceBody', {
          price: formatMru(plan.priceMru),
          balance: formatMru(s.balanceMru),
        }),
        [
          { text: t('common.cancel'), style: 'cancel' },
          { text: t('captain.subscription.topupAction'), onPress: () => router.push('/(app)/captain/wallet') },
        ],
      );
      return;
    }

    Alert.alert(
      t('captain.subscription.confirmTitle'),
      t('captain.subscription.confirmBody', {
        plan: t(`captain.subscription.plans.${plan.plan}`),
        price: formatMru(plan.priceMru),
        days: plan.days,
      }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('captain.subscription.confirmAction'),
          onPress: async () => {
            setBuying(plan.plan);
            try {
              await api.post('/captain/subscription/purchase', { plan: plan.plan });
              await statusQ.refetch();
              Alert.alert(
                t('captain.subscription.successTitle'),
                t('captain.subscription.successBody'),
              );
            } catch (e: any) {
              const msg = e?.response?.data?.error?.message ?? e?.message ?? String(e);
              Alert.alert(t('captain.subscription.failTitle'), msg);
            } finally {
              setBuying(null);
            }
          },
        },
      ],
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s, t, router, statusQ.refetch]);

  return (
    <Screen scroll onRefresh={statusQ.refetch} refreshing={statusQ.isFetching}>
      <ScreenHeader title={t('captain.subscription.title')} onBack={() => router.back()} />

      {/* Bandeau d'état : la seule chose qui compte, en haut, en grand. */}
      <LinearGradient
        colors={s?.active ? gradients.espresso : gradients.ember}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{ borderRadius: radius.xxl, padding: spacing.xl }}
      >
        <AppText variant="overline" color={colors.onEspresso}>
          {s?.active ? t('captain.subscription.activeLabel') : t('captain.subscription.inactiveLabel')}
        </AppText>
        <AppText variant="hero" color={colors.white} style={{ marginTop: spacing.xs, fontSize: 28 }}>
          {s?.active && s.current
            ? t('captain.subscription.daysLeft', { days: s.current.daysLeft })
            : t('captain.subscription.pitch')}
        </AppText>
        <AppText variant="caption" color={colors.onEspresso} style={{ marginTop: spacing.sm, opacity: 0.95 }}>
          {s?.active && s.current
            ? t('captain.subscription.until', {
                date: new Date(s.current.endsAt).toLocaleString(i18n.language, {
                  dateStyle: 'long', timeStyle: 'short',
                }),
              })
            : t('captain.subscription.pitchDetail')}
        </AppText>
      </LinearGradient>

      {/* Ce que l'abonnement donne, en trois lignes. */}
      <View style={{ marginTop: spacing.base, gap: spacing.sm }}>
        <Perk icon="cash" text={t('captain.subscription.perkCommission')} />
        <Perk icon="power" text={t('captain.subscription.perkOnline')} />
        <Perk icon="bell" text={t('captain.subscription.perkRides')} />
      </View>

      {s && !s.enabled ? (
        <AppText variant="body" color={colors.muted} style={{ marginTop: spacing.xxl }}>
          {t('captain.subscription.disabled')}
        </AppText>
      ) : s && !s.canPurchase ? (
        // Un abonnement à la fois : tant que celui-ci court, rien n'est en
        // vente. Le serveur refuse de toute façon (409 subscription_active) ;
        // on ne montre pas un bouton qui ne peut mener qu'à une erreur.
        <AppText variant="body" color={colors.muted} style={{ marginTop: spacing.xxl }}>
          {t('captain.subscription.alreadyActive', {
            date: s.current
              ? new Date(s.current.endsAt).toLocaleString(i18n.language, {
                  dateStyle: 'long', timeStyle: 'short',
                })
              : '',
          })}
        </AppText>
      ) : (
        <>
          {/* Dernières 24 h : les formules reviennent, mais on dit que la
              période achetée se colle au reliquat — sinon « acheter alors que
              je suis encore abonné » ressemble à des jours perdus. */}
          <AppText variant="overline" color={colors.muted}
            style={{ marginTop: spacing.xxl, marginBottom: spacing.sm }}>
            {s?.active ? t('captain.subscription.renewHeading') : t('captain.subscription.chooseHeading')}
          </AppText>
          {s?.active ? (
            <AppText variant="caption" color={colors.muted} style={{ marginBottom: spacing.sm }}>
              {t('captain.subscription.renewNote')}
            </AppText>
          ) : null}

          <View style={{ gap: spacing.sm }}>
            {(s?.plans ?? []).map((p) => (
              <PlanCard
                key={p.plan}
                offer={p}
                busy={buying === p.plan}
                disabled={buying !== null}
                onPress={() => buy(p)}
              />
            ))}
          </View>

          {/* Le paiement passe par le wallet : on rappelle le solde ici pour que
              « pas assez » ne soit jamais une surprise au moment du tap. */}
          {s ? (
            <AppText variant="caption" color={colors.muted} style={{ marginTop: spacing.md }}>
              {t('captain.subscription.balanceNote', { balance: formatMru(s.balanceMru) })}
            </AppText>
          ) : null}

          <Button
            title={t('captain.subscription.topupAction')}
            variant="secondary"
            icon="wallet"
            onPress={() => router.push('/(app)/captain/wallet')}
            style={{ marginTop: spacing.base }}
          />
        </>
      )}
    </Screen>
  );
}

function Perk({ icon, text }: { icon: 'cash' | 'power' | 'bell'; text: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
      <Icon name={icon} size={18} color={colors.success} />
      <AppText variant="body" style={{ flex: 1 }}>{text}</AppText>
    </View>
  );
}

function PlanCard({
  offer, busy, disabled, onPress,
}: {
  offer: PlanOffer;
  busy: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Card padding={spacing.lg}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
        <View style={{ flex: 1 }}>
          <AppText variant="bodyStrong">{t(`captain.subscription.plans.${offer.plan}`)}</AppText>
          <AppText variant="caption" color={colors.muted} style={{ marginTop: 2 }}>
            {t('captain.subscription.planDays', { days: offer.days })}
          </AppText>
        </View>
        <AppText variant="title">{formatMru(offer.priceMru)}</AppText>
      </View>
      <Button
        title={t('captain.subscription.buyAction')}
        size="md"
        busy={busy}
        disabled={disabled}
        onPress={onPress}
        style={{ marginTop: spacing.md }}
      />
    </Card>
  );
}
