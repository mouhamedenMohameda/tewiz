import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Image, Pressable, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import {
  AppText, Button, FadeInView, Icon, PressableScale, Screen,
} from '@/components/ui';
import { colors, gradients, radius, shadow, spacing } from '@/theme';
import { fetchRestaurantById, type Restaurant } from '@/lib/restaurants';

export default function RestaurantDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [restaurant, setRestaurant] = useState<Restaurant | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const r = await fetchRestaurantById(id);
      setRestaurant(r);
    } catch (e: any) {
      const status = e?.response?.status;
      if (status === 404) setError('not_found');
      else setError(e?.response?.data?.error?.message ?? 'Impossible de charger ce restaurant.');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return (
      <Screen>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={colors.ember} />
        </View>
      </Screen>
    );
  }

  if (error === 'not_found' || !restaurant) {
    return (
      <Screen>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md }}>
          <Icon name="alert" size={48} color={colors.muted} />
          <AppText variant="title">Restaurant introuvable</AppText>
          <Pressable onPress={() => router.back()} hitSlop={8}>
            <AppText variant="bodyStrong" color={colors.ember}>Retour</AppText>
          </Pressable>
        </View>
      </Screen>
    );
  }

  if (error) {
    return (
      <Screen>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md }}>
          <Icon name="alert" size={48} color={colors.danger} />
          <AppText variant="title">Erreur</AppText>
          <AppText variant="body" color={colors.ink2} style={{ textAlign: 'center', maxWidth: 280 }}>
            {error}
          </AppText>
          <Pressable onPress={load} hitSlop={8}>
            <AppText variant="bodyStrong" color={colors.ember}>Réessayer</AppText>
          </Pressable>
        </View>
      </Screen>
    );
  }

  const hasPhoto = !!restaurant.photo;
  const eta = restaurant.etaMin != null && restaurant.etaMax != null
    ? `${restaurant.etaMin}-${restaurant.etaMax} min`
    : null;

  return (
    <Screen scroll padded={false} edges={['left', 'right']}>
      {/* Hero photo (or branded gradient placeholder) with overlaid back button */}
      <View style={{ position: 'relative', height: 280 }}>
        {hasPhoto ? (
          <Image source={{ uri: restaurant.photo! }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
        ) : (
          <LinearGradient
            colors={gradients.sunrise}
            start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
            style={{ width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center' }}
          >
            <View style={{
              width: 96, height: 96, borderRadius: radius.xl,
              backgroundColor: 'rgba(255,255,255,0.25)',
              alignItems: 'center', justifyContent: 'center',
            }}>
              <AppText variant="hero" color={colors.white}>
                {(restaurant.name.trim().charAt(0) || '?').toUpperCase()}
              </AppText>
            </View>
          </LinearGradient>
        )}
        {hasPhoto ? (
          <LinearGradient
            colors={['rgba(0,0,0,0.45)', 'rgba(0,0,0,0)', 'rgba(0,0,0,0.55)']}
            style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
          />
        ) : null}
        <Pressable
          onPress={() => router.back()}
          hitSlop={10}
          style={{
            position: 'absolute', top: spacing.xxl + spacing.sm, left: spacing.lg,
            width: 44, height: 44, borderRadius: radius.md,
            backgroundColor: 'rgba(255,255,255,0.92)',
            alignItems: 'center', justifyContent: 'center',
            ...shadow.card,
          }}
          accessibilityLabel="Retour"
        >
          <Icon name="chevronBack" size={22} color={colors.ink} />
        </Pressable>

        {(restaurant.rating != null || restaurant.priceLevel) ? (
          <View style={{
            position: 'absolute', bottom: spacing.lg, left: spacing.lg, right: spacing.lg,
            flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
          }}>
            {restaurant.rating != null ? (
              <View style={{
                flexDirection: 'row', alignItems: 'center', gap: 4,
                backgroundColor: 'rgba(255,255,255,0.95)',
                paddingHorizontal: 10, paddingVertical: 5, borderRadius: radius.pill,
              }}>
                <Icon name="star" size={13} color={colors.warning} />
                <AppText variant="label" color={colors.ink}>{restaurant.rating.toFixed(1)}</AppText>
              </View>
            ) : null}
            {restaurant.priceLevel ? (
              <View style={{
                backgroundColor: 'rgba(0,0,0,0.55)',
                paddingHorizontal: 10, paddingVertical: 5, borderRadius: radius.pill,
              }}>
                <AppText variant="label" color={colors.white}>{restaurant.priceLevel}</AppText>
              </View>
            ) : null}
          </View>
        ) : null}
      </View>

      {/* Floating info card overlapping the hero */}
      <View style={{
        marginTop: -spacing.xxl,
        marginHorizontal: spacing.lg,
        backgroundColor: colors.surface,
        borderRadius: radius.xxl,
        padding: spacing.xl,
        ...shadow.raised,
      }}>
        <FadeInView>
          {restaurant.zone ? (
            <AppText variant="overline" color={colors.ember}>{restaurant.zone}</AppText>
          ) : null}
          <AppText variant="display" style={{ marginTop: restaurant.zone ? 4 : 0 }} numberOfLines={2}>
            {restaurant.name}
          </AppText>

          {restaurant.tags.length > 0 ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: spacing.md }}>
              {restaurant.tags.map((tag) => (
                <View
                  key={tag}
                  style={{
                    backgroundColor: colors.emberSoft,
                    paddingHorizontal: 10, paddingVertical: 5, borderRadius: radius.pill,
                  }}
                >
                  <AppText variant="caption" color={colors.ember}>{tag}</AppText>
                </View>
              ))}
            </View>
          ) : null}
        </FadeInView>

        {(eta || restaurant.zone) ? (
          <FadeInView delay={80} style={{
            flexDirection: 'row', gap: spacing.md, marginTop: spacing.lg,
            paddingTop: spacing.lg, borderTopWidth: 1, borderTopColor: colors.line,
          }}>
            {eta ? <InfoMetric icon="clock" label="Délai" value={eta} /> : null}
            {restaurant.zone ? <InfoMetric icon="pin" label="Quartier" value={restaurant.zone} /> : null}
          </FadeInView>
        ) : null}

        {restaurant.description ? (
          <FadeInView delay={140} style={{ marginTop: spacing.lg }}>
            <AppText variant="overline" color={colors.muted}>À propos</AppText>
            <AppText variant="body" color={colors.ink2} style={{ marginTop: spacing.sm }}>
              {restaurant.description}
            </AppText>
          </FadeInView>
        ) : null}

        {restaurant.address ? (
          <FadeInView delay={200} style={{ marginTop: spacing.lg }}>
            <AppText variant="overline" color={colors.muted}>Adresse</AppText>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.sm }}>
              <View style={{
                width: 36, height: 36, borderRadius: radius.sm,
                backgroundColor: colors.surfaceAlt,
                alignItems: 'center', justifyContent: 'center',
              }}>
                <Icon name="pin" size={18} color={colors.ember} />
              </View>
              <AppText variant="bodyStrong" style={{ flex: 1 }}>{restaurant.address}</AppText>
            </View>
          </FadeInView>
        ) : null}
      </View>

      {/* CTA — Voir la carte (menu) */}
      <View style={{ paddingHorizontal: spacing.lg, marginTop: spacing.xl, marginBottom: spacing.huge }}>
        <FadeInView delay={260}>
          <PressableScale
            onPress={() => Alert.alert(
              'Carte du restaurant',
              `La carte des plats de ${restaurant.name} sera disponible très bientôt. Restez connecté !`,
            )}
            scaleTo={0.97}
            style={{
              backgroundColor: colors.ember,
              borderRadius: radius.lg,
              paddingVertical: 16,
              flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
              gap: spacing.sm,
              ...shadow.ember,
            }}
          >
            <Icon name="menu" size={22} color={colors.white} />
            <AppText variant="title" color={colors.white}>Voir la carte des plats</AppText>
          </PressableScale>

          <Button
            variant="ghost"
            title="Commander une course jusqu'ici"
            icon="ride"
            onPress={() => router.push('/(app)/rider/voice-ride')}
            style={{ marginTop: spacing.sm }}
          />
        </FadeInView>
      </View>
    </Screen>
  );
}

function InfoMetric({ icon, label, value }: { icon: 'clock' | 'pin'; label: string; value: string }) {
  return (
    <View style={{ flex: 1, gap: 4 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
        <Icon name={icon} size={14} color={colors.muted} />
        <AppText variant="caption" color={colors.muted}>{label}</AppText>
      </View>
      <AppText variant="bodyStrong" numberOfLines={1}>{value}</AppText>
    </View>
  );
}
