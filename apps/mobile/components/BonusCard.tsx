/**
 * Captain commission bonus progress card.
 *
 * Two states:
 *   - Bonus active   → green banner with countdown until expiry.
 *   - Accumulating   → progress bar (counter / threshold) with hint text.
 *
 * Hidden entirely when the feature is disabled (the backend still returns
 * the row but with enabled=false, so nothing pollutes the captain home).
 *
 * Fetches /captain/bonus on mount and refreshes whenever the parent screen
 * remounts; caller can also pass `refreshKey` to force a re-fetch (e.g.
 * after a ride completes).
 */

import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { api } from '@/lib/api';
import { AppText, Card, Icon } from '@/components/ui';
import { colors, radius, spacing } from '@/theme';

interface BonusProgress {
  enabled: boolean;
  thresholdMru: number;
  windowDays: number;
  rewardDays: number;
  counterMru: number;
  windowStartedAt: string | null;
  windowEndsAt: string | null;
  bonusActive: boolean;
  bonusUntil: string | null;
}

export function BonusCard({ refreshKey }: { refreshKey?: number | string }) {
  const [data, setData] = useState<BonusProgress | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await api.get<BonusProgress>('/captain/bonus');
        if (!cancelled) setData(r.data);
      } catch {
        // Silent: feature is optional — never block the home screen.
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, [refreshKey]);

  if (!loaded || !data) return null;
  // If the feature is off AND the captain has no in-flight bonus, hide entirely.
  if (!data.enabled && !data.bonusActive) return null;

  if (data.bonusActive && data.bonusUntil) {
    return <BonusActiveCard until={new Date(data.bonusUntil)} />;
  }

  return <BonusProgressCard data={data} />;
}

function BonusActiveCard({ until }: { until: Date }) {
  return (
    <Card
      padding={spacing.lg}
      style={{
        marginTop: spacing.base,
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.base,
        backgroundColor: colors.successSoft,
        borderColor: colors.success,
        borderWidth: 1,
      }}
    >
      <View style={{
        width: 50, height: 50, borderRadius: radius.md,
        backgroundColor: colors.success, alignItems: 'center', justifyContent: 'center',
      }}>
        <Icon name="gift" size={26} color={colors.white} />
      </View>
      <View style={{ flex: 1 }}>
        <AppText variant="overline" color={colors.success}>BONUS ACTIF</AppText>
        <AppText variant="bodyStrong" style={{ marginTop: 1 }}>
          Commission divisée par 2
        </AppText>
        <AppText variant="caption" color={colors.ink2} style={{ marginTop: 2 }}>
          Jusqu&apos;au {until.toLocaleDateString('fr-FR', {
            day: '2-digit', month: '2-digit',
          })} à {until.toLocaleTimeString('fr-FR', {
            hour: '2-digit', minute: '2-digit',
          })}
        </AppText>
      </View>
    </Card>
  );
}

function BonusProgressCard({ data }: { data: BonusProgress }) {
  const pct = Math.min(100, Math.round((data.counterMru / data.thresholdMru) * 100));
  const remaining = Math.max(0, data.thresholdMru - data.counterMru);
  const deadline = data.windowEndsAt ? new Date(data.windowEndsAt) : null;
  const daysLeft = deadline
    ? Math.max(0, Math.ceil((deadline.getTime() - Date.now()) / 86_400_000))
    : data.windowDays;

  return (
    <Card
      padding={spacing.lg}
      style={{
        marginTop: spacing.base,
        gap: spacing.sm,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.base }}>
        <View style={{
          width: 50, height: 50, borderRadius: radius.md,
          backgroundColor: colors.saffronSoft, alignItems: 'center', justifyContent: 'center',
        }}>
          <Icon name="gift" size={26} color={colors.warning} />
        </View>
        <View style={{ flex: 1 }}>
          <AppText variant="overline" color={colors.muted}>BONUS CHAUFFEUR</AppText>
          <AppText variant="bodyStrong" style={{ marginTop: 1 }}>
            {data.counterMru} / {data.thresholdMru} MRU
          </AppText>
        </View>
      </View>

      {/* Progress bar */}
      <View style={{
        height: 8, borderRadius: 4, backgroundColor: colors.surfaceAlt, overflow: 'hidden',
      }}>
        <View style={{
          width: `${pct}%`, height: '100%', backgroundColor: colors.warning,
        }} />
      </View>

      <AppText variant="caption" color={colors.ink2}>
        {remaining > 0
          ? `Encore ${remaining} MRU de commission en ${daysLeft} j pour diviser ta commission par 2 pendant ${data.rewardDays} j.`
          : `Tu as atteint le seuil — le bonus s'active à la fin de cette course.`}
      </AppText>
    </Card>
  );
}
