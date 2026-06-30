import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, KeyboardAvoidingView,
  Platform, Pressable, TextInput, View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import { api } from '@/lib/api';
import { MapShell } from '@/components/MapShell';
import { getMapbox, NKC_CENTER } from '@/lib/mapbox';
import { AppText, Button, Card, Icon, Screen, ScreenHeader } from '@/components/ui';
import { colors, radius, shadow, spacing } from '@/theme';
import { APP_NAME } from '@/lib/brand';

interface Home {
  captainId: string;
  lat: number;
  lng: number;
  label: string;
  setAt: string;
  lockedUntil: string;
  correctionUsed: boolean;
}

export default function HomeLocationScreen() {
  const router = useRouter();
  const { t, i18n } = useTranslation();
  const M = getMapbox();
  const cameraRef = useRef<any>(null);

  const [home, setHome] = useState<Home | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [label, setLabel] = useState('');

  // [lng, lat] of the pin the captain has placed on the map.
  const [pinCoord, setPinCoord] = useState<[number, number] | null>(null);
  // Current GPS used as proof-of-presence for the API proximity check.
  const [currentGps, setCurrentGps] = useState<{ lat: number; lng: number } | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await api.get<Home>('/captain/home', {
        validateStatus: (s) => s === 200 || s === 204,
      });
      if (r.status === 204) {
        setHome(null);
        setEditing(true);
      } else {
        setHome(r.data);
        setLabel(r.data.label);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // When entering edit mode, fetch GPS and centre the map on it.
  useEffect(() => {
    if (!editing) return;
    (async () => {
      try {
        const perm = await Location.requestForegroundPermissionsAsync();
        if (perm.status !== 'granted') return;
        const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        const gps = { lat: loc.coords.latitude, lng: loc.coords.longitude };
        setCurrentGps(gps);
        // Default pin to current GPS only when no pin is set yet.
        setPinCoord((prev) => prev ?? [gps.lng, gps.lat]);
        cameraRef.current?.setCamera({
          centerCoordinate: [gps.lng, gps.lat],
          zoomLevel: 16,
          animationDuration: 600,
        });
      } catch {}
    })();
  }, [editing]);

  function startEditing() {
    // Pre-seed pin with the existing home location so the captain sees it.
    if (home) setPinCoord([home.lng, home.lat]);
    setEditing(true);
  }

  async function save() {
    if (label.trim().length < 2) {
      Alert.alert(t('captain.homeLocation.errorTitle'), t('captain.homeLocation.errorBody'));
      return;
    }
    if (!pinCoord) {
      Alert.alert(t('captain.homeLocation.errorTitle'), t('captain.homeLocation.mapNoPin'));
      return;
    }
    setSaving(true);
    try {
      let gps = currentGps;
      if (!gps) {
        const perm = await Location.requestForegroundPermissionsAsync();
        if (perm.status !== 'granted') {
          Alert.alert(
            t('captain.state.locationRequiredTitle'),
            t('captain.homeLocation.locationRequiredBody', { app: APP_NAME }),
          );
          return;
        }
        const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        gps = { lat: loc.coords.latitude, lng: loc.coords.longitude };
        setCurrentGps(gps);
      }
      const body = {
        lat: pinCoord[1],
        lng: pinCoord[0],
        label: label.trim(),
        currentLat: gps.lat,
        currentLng: gps.lng,
      };
      const method = home ? 'patch' : 'post';
      const r = await api[method]<Home>('/captain/home', body);
      setHome(r.data);
      setEditing(false);
      setPinCoord(null);
      setCurrentGps(null);
      Alert.alert(
        t('captain.homeLocation.savedTitle'),
        t('captain.homeLocation.savedBody', { date: new Date(r.data.lockedUntil).toLocaleDateString(i18n.language) }),
      );
    } catch (e: any) {
      Alert.alert(t('common.impossible'), e.response?.data?.error?.message ?? t('errors.generic'));
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <SafeAreaView style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.canvas }}>
        <ActivityIndicator color={colors.ember} />
      </SafeAreaView>
    );
  }

  const now = Date.now();
  const lockedUntil = home ? new Date(home.lockedUntil).getTime() : 0;
  const isLocked = home ? lockedUntil > now : false;
  const setAtMs = home ? new Date(home.setAt).getTime() : 0;
  const inCorrectionWindow =
    !!home && !home.correctionUsed && (now - setAtMs) < 48 * 3600_000;
  const canEdit = __DEV__ || !home || !isLocked || inCorrectionWindow;

  // ── Map picker view ──────────────────────────────────────────────────────
  if (editing) {
    const mapCenter: [number, number] = pinCoord ?? (home ? [home.lng, home.lat] : NKC_CENTER);
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.canvas }} edges={['top']}>
        {/* Header */}
        <View style={{
          paddingHorizontal: spacing.base, paddingBottom: spacing.sm, paddingTop: spacing.xs,
          flexDirection: 'row', alignItems: 'center', gap: spacing.md,
        }}>
          <Pressable
            onPress={() => { setEditing(false); if (home) setLabel(home.label); }}
            hitSlop={10}
            style={{
              width: 44, height: 44, borderRadius: radius.md,
              backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center',
              ...shadow.card,
            }}
          >
            <Icon name="chevronBack" size={22} color={colors.ink} />
          </Pressable>
          <AppText variant="h2" style={{ flex: 1 }}>{t('captain.homeLocation.title')}</AppText>
        </View>

        {/* Map */}
        <View style={{ flex: 1 }}>
          <MapShell
            cameraRef={cameraRef}
            centerCoordinate={mapCenter}
            zoomLevel={16}
            showsUserLocation
            onPress={(lngLat) => setPinCoord(lngLat)}
          >
            {M && pinCoord ? (
              <M.PointAnnotation
                id="home-pin"
                coordinate={pinCoord}
                title={label || t('captain.homeLocation.title')}
              >
                <View style={{
                  width: 40, height: 40, borderRadius: 20,
                  backgroundColor: colors.ember, borderWidth: 3, borderColor: colors.white,
                  alignItems: 'center', justifyContent: 'center',
                  ...shadow.raised,
                }}>
                  <Icon name="home" size={20} color={colors.white} />
                </View>
              </M.PointAnnotation>
            ) : null}
          </MapShell>

          {/* Instruction overlay */}
          <View style={{
            position: 'absolute', top: spacing.base, left: spacing.base, right: spacing.base,
            backgroundColor: 'rgba(15, 23, 42, 0.82)', borderRadius: radius.md,
            paddingHorizontal: spacing.base, paddingVertical: spacing.sm,
          }}>
            <AppText variant="caption" color={colors.white} align="center">
              {t('captain.homeLocation.mapInstruction')}
            </AppText>
          </View>
        </View>

        {/* Bottom panel */}
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={{
            backgroundColor: colors.surface,
            paddingHorizontal: spacing.base, paddingTop: spacing.base, paddingBottom: spacing.xl,
            borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl,
            gap: spacing.md, ...shadow.raised,
          }}>
            {pinCoord ? (
              <AppText variant="caption" color={colors.muted}>
                📍 {pinCoord[1].toFixed(5)}, {pinCoord[0].toFixed(5)}
                {'  ·  '}{t('captain.homeLocation.pinHint')}
              </AppText>
            ) : (
              <AppText variant="caption" color={colors.warning}>
                {t('captain.homeLocation.mapNoPin')}
              </AppText>
            )}
            <View style={{ gap: 6 }}>
              <AppText variant="label" color={colors.ink2}>
                {t('captain.homeLocation.addressFieldLabel')}
              </AppText>
              <TextInput
                value={label}
                onChangeText={setLabel}
                placeholder={t('captain.homeLocation.addressPlaceholder')}
                placeholderTextColor={colors.muted}
                style={{
                  borderWidth: 1, borderColor: colors.line, borderRadius: radius.md,
                  paddingHorizontal: spacing.base, paddingVertical: spacing.md,
                  fontSize: 15, color: colors.ink, backgroundColor: colors.canvas,
                }}
                maxLength={200}
              />
            </View>
            <Button
              title={t('captain.homeLocation.save')}
              icon="home"
              busy={saving}
              disabled={!pinCoord}
              onPress={save}
            />
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  }

  // ── Info view ─────────────────────────────────────────────────────────────
  return (
    <Screen scroll>
      <ScreenHeader title={t('captain.homeLocation.title')} onBack={() => router.back()} />
      <AppText variant="body" color={colors.ink2}>
        {t('captain.homeLocation.intro')}
      </AppText>

      {home ? (
        <Card padding={spacing.lg} style={{ marginTop: spacing.lg }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
            <View style={{
              width: 48, height: 48, borderRadius: radius.md,
              backgroundColor: colors.emberSoft, alignItems: 'center', justifyContent: 'center',
            }}>
              <Icon name="home" size={24} color={colors.ember} />
            </View>
            <View style={{ flex: 1 }}>
              <AppText variant="overline" color={colors.muted}>{t('captain.homeLocation.addressLabel')}</AppText>
              <AppText variant="title" numberOfLines={2}>{home.label}</AppText>
            </View>
          </View>
          <AppText variant="caption" color={colors.muted} style={{ marginTop: spacing.md }}>
            {home.lat.toFixed(5)}, {home.lng.toFixed(5)}
          </AppText>

          <View style={{
            marginTop: spacing.base, padding: spacing.md, borderRadius: radius.md,
            backgroundColor: isLocked ? colors.saffronSoft : colors.successSoft,
          }}>
            <AppText variant="overline" color={isLocked ? '#9A6711' : '#166534'}>
              {isLocked ? t('captain.homeLocation.locked') : t('captain.homeLocation.editable')}
            </AppText>
            <AppText variant="caption" color={isLocked ? '#9A6711' : '#166534'} style={{ marginTop: 3 }}>
              {isLocked
                ? t('captain.homeLocation.lockedUntil', { date: new Date(home.lockedUntil).toLocaleDateString(i18n.language) })
                : t('captain.homeLocation.lockedDone')}
              {inCorrectionWindow ? t('captain.homeLocation.correctionPossible') : ''}
            </AppText>
          </View>

          {canEdit ? (
            <Button
              title={inCorrectionWindow ? t('captain.homeLocation.correct') : t('captain.homeLocation.edit')}
              variant="secondary"
              icon="map"
              onPress={startEditing}
              style={{ marginTop: spacing.base }}
            />
          ) : null}

        </Card>
      ) : null}
    </Screen>
  );
}
