import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, Animated, Easing, Pressable, Switch, View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import * as Location from 'expo-location';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatMru } from '@/lib/format';
import { usePolling } from '@/lib/usePolling';
import { ModeToggle } from '@/components/ModeToggle';
import { resetRideAlerts } from '@/components/CaptainRideWatcher';
import {
  AppText, Button, Card, FadeInView, Icon, PressableScale, Screen, type IconName,
} from '@/components/ui';
import { colors, gradients, radius, shadow, spacing } from '@/theme';
import { APP_NAME } from '@/lib/brand';

type Presence = 'offline' | 'online' | 'on_ride';

interface WalletSummary {
  balanceMru: number;
  updatedAt: string;
}

interface StateRow {
  presence: Presence;
  updated_at: string;
  lat: number | null;
  lng: number | null;
}

interface GoingHomeSession {
  id: string;
  startedAt: string;
  expiresAt: string;
}

export default function CaptainHome() {
  const router = useRouter();
  const user = useAuth((s) => s.user);

  const [wallet, setWallet] = useState<WalletSummary | null>(null);
  const [state, setState] = useState<StateRow | null>(null);
  const [goingHome, setGoingHome] = useState<GoingHomeSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState(false);
  const [togglingGoingHome, setTogglingGoingHome] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [walletRes, stateRes, ghRes] = await Promise.allSettled([
        api.get<WalletSummary>('/captain/wallet'),
        api.get<StateRow>('/captain/state'),
        api.get<GoingHomeSession>('/captain/state/going-home'),
      ]);
      if (walletRes.status === 'fulfilled') setWallet(walletRes.value.data);
      if (stateRes.status === 'fulfilled') {
        setState(stateRes.value.data);
      } else {
        // 404 = no state row yet → captain has never been online.
        setState({ presence: 'offline', updated_at: '', lat: null, lng: null });
      }
      if (ghRes.status === 'fulfilled' && ghRes.value.status !== 204) {
        setGoingHome(ghRes.value.data);
      } else {
        setGoingHome(null);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  // Refresh balance/state/going-home periodically (battery-friendly cadence).
  usePolling(load, 30_000);

  async function goOnline() {
    setToggling(true);
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (perm.status !== 'granted') {
        Alert.alert('Position requise',
          `${APP_NAME} a besoin de votre position pour vous mettre en ligne.`);
        return;
      }
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      await api.post('/captain/state/online', {
        lat: loc.coords.latitude,
        lng: loc.coords.longitude,
      });
      await load();
    } catch (e: any) {
      Alert.alert('Impossible',
        e.response?.data?.error?.message ?? 'Erreur lors du passage en ligne.');
    } finally {
      setToggling(false);
    }
  }

  async function goOffline() {
    setToggling(true);
    try {
      await api.post('/captain/state/offline', {});
      await load();
    } catch (e: any) {
      Alert.alert('Impossible',
        e.response?.data?.error?.message ?? 'Erreur lors du passage hors ligne.');
    } finally {
      setToggling(false);
    }
  }

  async function toggleGoingHome(next: boolean) {
    setTogglingGoingHome(true);
    try {
      if (next) {
        const r = await api.post<GoingHomeSession>('/captain/state/going-home', {});
        setGoingHome(r.data);
      } else {
        await api.delete('/captain/state/going-home');
        setGoingHome(null);
      }
    } catch (e: any) {
      Alert.alert('Impossible',
        e.response?.data?.error?.message ?? 'Erreur sur le mode "Je rentre chez moi".');
    } finally {
      setTogglingGoingHome(false);
    }
  }

  function confirmReset() {
    Alert.alert(
      'Réinitialiser les alertes ?',
      'Vide la liste des courses déjà vues et lève toute pause. À utiliser si vous ne recevez plus de notifications alors que vous êtes en ligne.',
      [
        { text: 'Non', style: 'cancel' },
        {
          text: 'Réinitialiser',
          onPress: async () => {
            await resetRideAlerts();
            Alert.alert('Fait', 'Les alertes vont reprendre à la prochaine course.');
          },
        },
      ],
    );
  }

  const presence: Presence = state?.presence ?? 'offline';
  const online = presence === 'online' || presence === 'on_ride';

  return (
    <Screen scroll onRefresh={load} refreshing={loading}>
      {/* Header */}
      <View style={{
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        marginTop: spacing.sm, marginBottom: spacing.lg,
      }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md, flex: 1 }}>
          <View style={{
            width: 46, height: 46, borderRadius: radius.md,
            backgroundColor: colors.espresso, alignItems: 'center', justifyContent: 'center',
          }}>
            <Icon name="captain" size={26} color={colors.saffron} />
          </View>
          <View style={{ flex: 1 }}>
            <AppText variant="overline" color={colors.muted}>Chauffeur</AppText>
            <AppText variant="title" numberOfLines={1} style={{ marginTop: 1 }}>
              {user?.fullName ?? user?.phone}
            </AppText>
          </View>
        </View>
        <Pressable
          onPress={() => router.push('/(app)/account')}
          hitSlop={10}
          accessibilityLabel="Compte"
          style={{
            width: 44, height: 44, borderRadius: radius.md,
            backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center',
            ...shadow.card,
          }}
        >
          <Icon name="person" size={22} color={colors.ink} />
        </Pressable>
      </View>

      <ModeToggle />

      {/* Online / offline state — the primary control */}
      <FadeInView style={{ marginTop: spacing.lg }}>
        <StateCard
          presence={presence}
          toggling={toggling}
          onGoOnline={goOnline}
          onGoOffline={goOffline}
        />
      </FadeInView>

      {/* Wallet */}
      <FadeInView delay={70}>
        <Card
          onPress={() => router.push('/(app)/captain/wallet')}
          padding={spacing.lg}
          style={{ marginTop: spacing.base, flexDirection: 'row', alignItems: 'center', gap: spacing.base }}
        >
          <View style={{
            width: 50, height: 50, borderRadius: radius.md,
            backgroundColor: colors.saffronSoft, alignItems: 'center', justifyContent: 'center',
          }}>
            <Icon name="wallet" size={26} color={colors.warning} />
          </View>
          <View style={{ flex: 1 }}>
            <AppText variant="overline" color={colors.muted}>Solde</AppText>
            <AppText variant="h1" style={{ marginTop: 1 }}>
              {wallet ? formatMru(wallet.balanceMru) : '—'}
            </AppText>
          </View>
          <Icon name="chevron" size={22} color={colors.faint} />
        </Card>
      </FadeInView>

      {/* Going-home */}
      <FadeInView delay={130}>
        <Card
          padding={spacing.lg}
          style={{ marginTop: spacing.base, flexDirection: 'row', alignItems: 'center', gap: spacing.base }}
        >
          <View style={{
            width: 50, height: 50, borderRadius: radius.md,
            backgroundColor: colors.emberSoft, alignItems: 'center', justifyContent: 'center',
          }}>
            <Icon name="home" size={24} color={colors.ember} />
          </View>
          <View style={{ flex: 1 }}>
            <AppText variant="bodyStrong">Je rentre chez moi</AppText>
            <AppText variant="caption" color={colors.ink2} style={{ marginTop: 2 }}>
              Priorité aux courses qui vous rapprochent de votre domicile.
            </AppText>
            {goingHome ? (
              <AppText variant="caption" color={colors.ember} style={{ marginTop: 3 }}>
                Actif jusqu'à {new Date(goingHome.expiresAt).toLocaleTimeString('fr-FR', {
                  hour: '2-digit', minute: '2-digit',
                })}
              </AppText>
            ) : null}
          </View>
          {togglingGoingHome ? (
            <ActivityIndicator color={colors.ember} />
          ) : (
            <Switch
              value={!!goingHome}
              onValueChange={toggleGoingHome}
              disabled={!online}
              trackColor={{ false: colors.lineStrong, true: colors.ember }}
              thumbColor={colors.white}
              ios_backgroundColor={colors.lineStrong}
            />
          )}
        </Card>
      </FadeInView>

      {/* Navigation */}
      <FadeInView delay={190}>
        <AppText variant="overline" color={colors.muted} style={{ marginTop: spacing.xxl, marginBottom: spacing.md }}>
          Gérer
        </AppText>
        <View style={{ gap: spacing.md }}>
          <NavRow icon="ride" tint={colors.emberSoft} fg={colors.ember}
            title="Courses" subtitle="Inbox des courses et course en cours"
            onPress={() => router.push('/(app)/captain/rides')} />
          <NavRow icon="home" tint={colors.saffronSoft} fg={colors.warning}
            title="Mon domicile" subtitle={'Pour le mode "Je rentre chez moi"'}
            onPress={() => router.push('/(app)/captain/home-location')} />
          <NavRow icon="heatmap" tint={colors.dangerSoft} fg={colors.danger}
            title="Zones chaudes" subtitle="Où se trouve la demande maintenant"
            onPress={() => router.push('/(app)/captain/heatmap')} />
          <NavRow icon="recurring" tint="#E9EFE6" fg={colors.success}
            title="Courses récurrentes" subtitle="Engagements hebdomadaires"
            onPress={() => router.push('/(app)/captain/recurring')} />
        </View>
      </FadeInView>

      <Pressable onPress={confirmReset} style={({ pressed }) => ({
        marginTop: spacing.xl, paddingVertical: spacing.md,
        flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm,
        opacity: pressed ? 0.6 : 1,
      })}>
        <Icon name="refresh" size={15} color={colors.muted} />
        <AppText variant="label" color={colors.muted}>Réinitialiser les alertes</AppText>
      </Pressable>
    </Screen>
  );
}

/* ------------------------------------------------------------------ */

function StateCard({
  presence, toggling, onGoOnline, onGoOffline,
}: {
  presence: Presence; toggling: boolean; onGoOnline: () => void; onGoOffline: () => void;
}) {
  const online = presence === 'online' || presence === 'on_ride';
  const onRide = presence === 'on_ride';

  if (online) {
    return (
      <LinearGradient
        colors={onRide ? gradients.espresso : gradients.sunrise}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{ borderRadius: radius.xxl, padding: spacing.xl, ...(onRide ? shadow.raised : shadow.ember) }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <PulseDot color={onRide ? colors.saffron : colors.white} />
          <AppText variant="overline" color={onRide ? colors.saffron : '#FFF1DD'}>Vous êtes</AppText>
        </View>
        <AppText variant="display" color={colors.white} style={{ marginTop: spacing.xs }}>
          {onRide ? 'En course' : 'En ligne'}
        </AppText>
        <AppText variant="body" color={onRide ? colors.onEspressoMuted : '#FFF1DD'} style={{ marginTop: spacing.xs }}>
          {onRide
            ? 'Course en cours — bonne route.'
            : 'Vous recevez les courses proches de vous.'}
        </AppText>

        {!onRide ? (
          <PressableScale
            onPress={onGoOffline}
            disabled={toggling}
            style={{
              marginTop: spacing.lg, opacity: toggling ? 0.6 : 1,
              borderRadius: radius.lg, paddingVertical: 13,
              flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm,
              borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.6)',
            }}
          >
            {toggling
              ? <ActivityIndicator color={colors.white} />
              : <Icon name="power" size={19} color={colors.white} />}
            <AppText variant="bodyStrong" color={colors.white}>Passer hors ligne</AppText>
          </PressableScale>
        ) : null}
      </LinearGradient>
    );
  }

  return (
    <Card padding={spacing.xl}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colors.faint }} />
        <AppText variant="overline" color={colors.muted}>Vous êtes</AppText>
      </View>
      <AppText variant="display" style={{ marginTop: spacing.xs }}>Hors ligne</AppText>
      <AppText variant="body" color={colors.ink2} style={{ marginTop: spacing.xs }}>
        Passez en ligne pour commencer à recevoir des courses.
      </AppText>
      <Button
        title="Passer en ligne"
        icon="power"
        busy={toggling}
        onPress={onGoOnline}
        style={{ marginTop: spacing.lg }}
      />
    </Card>
  );
}

function NavRow({
  icon, tint, fg, title, subtitle, onPress,
}: {
  icon: IconName; tint: string; fg: string; title: string; subtitle: string; onPress: () => void;
}) {
  return (
    <Card onPress={onPress} padding={spacing.base}
      style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.base }}>
      <View style={{
        width: 46, height: 46, borderRadius: radius.md,
        backgroundColor: tint, alignItems: 'center', justifyContent: 'center',
      }}>
        <Icon name={icon} size={24} color={fg} />
      </View>
      <View style={{ flex: 1 }}>
        <AppText variant="title">{title}</AppText>
        <AppText variant="caption" color={colors.ink2} style={{ marginTop: 2 }}>{subtitle}</AppText>
      </View>
      <Icon name="chevron" size={20} color={colors.faint} />
    </Card>
  );
}

/* A soft breathing dot for the live state indicator. */
function PulseDot({ color }: { color: string }) {
  const o = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(o, { toValue: 0.25, duration: 850, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      Animated.timing(o, { toValue: 1, duration: 850, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [o]);
  return <Animated.View style={{ width: 9, height: 9, borderRadius: 4.5, backgroundColor: color, opacity: o }} />;
}
