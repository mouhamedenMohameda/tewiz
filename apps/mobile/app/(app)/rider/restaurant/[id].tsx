import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Dimensions, Image, Linking, Modal, Pressable, ScrollView, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { LinearGradient } from 'expo-linear-gradient';
import {
  AppText, Button, FadeInView, Icon, PressableScale, Screen,
} from '@/components/ui';
import { colors, gradients, radius, shadow, spacing } from '@/theme';
import { fetchRestaurantById, type Restaurant } from '@/lib/restaurants';
import { resolveRestaurantCover } from '@/lib/restaurantPhotos';

export default function RestaurantDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { t } = useTranslation();
  const [restaurant, setRestaurant] = useState<Restaurant | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [imgFailed, setImgFailed] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuIndex, setMenuIndex] = useState(0);
  const screenW = Dimensions.get('window').width;

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
      else setError(e?.response?.data?.error?.message ?? t('rider.restaurants.loadDetailError'));
    } finally {
      setLoading(false);
    }
  }, [id, t]);

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
          <AppText variant="title">{t('rider.restaurants.notFound')}</AppText>
          <Pressable onPress={() => router.back()} hitSlop={8}>
            <AppText variant="bodyStrong" color={colors.ember}>{t('common.back')}</AppText>
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
          <AppText variant="title">{t('rider.restaurants.error')}</AppText>
          <AppText variant="body" color={colors.ink2} style={{ textAlign: 'center', maxWidth: 280 }}>
            {error}
          </AppText>
          <Pressable onPress={load} hitSlop={8}>
            <AppText variant="bodyStrong" color={colors.ember}>{t('common.retry')}</AppText>
          </Pressable>
        </View>
      </Screen>
    );
  }

  // Cover = deterministic fallback. The admin-uploaded photos are the menu /
  // table cards, shown on demand via the "voir la carte des plats" action.
  const cover = resolveRestaurantCover(restaurant);
  // The `photos` array is the source of truth; fall back to the legacy single
  // `photo` for rows created before multi-photo support.
  const menuPhotos = (restaurant.photos ?? []).length > 0
    ? restaurant.photos
    : (restaurant.photo ? [restaurant.photo] : []);
  const hasMenu = menuPhotos.length > 0;
  const phone = restaurant.phone?.trim() || null;
  const eta = restaurant.etaMin != null && restaurant.etaMax != null
    ? `${restaurant.etaMin}-${restaurant.etaMax} min`
    : null;

  // Build the params we'll forward to /new-ride. Two flows:
  //   - "ride": user is going TO this restaurant → restaurant is the dropoff,
  //     pickup auto-fills from GPS on the next screen.
  //   - "colis": user wants a delivery FROM this restaurant → restaurant is
  //     the pickup, dropoff auto-fills from GPS.
  // In both cases /new-ride lands pre-filled but waits for the user to
  // confirm — we never POST a ride from here.
  const goAsRide = () => {
    router.push({
      pathname: '/(app)/rider/new-ride',
      params: {
        dropoffLat: String(restaurant.lat),
        dropoffLng: String(restaurant.lng),
        dropoffLabel: restaurant.name,
        kind: 'self',
      },
    });
  };
  const goAsColis = () => {
    router.push({
      pathname: '/(app)/rider/new-ride',
      params: {
        pickupLat: String(restaurant.lat),
        pickupLng: String(restaurant.lng),
        pickupLabel: restaurant.name,
        kind: 'colis',
      },
    });
  };

  return (
    <Screen scroll padded={false} edges={['left', 'right']}>
      {/* Hero photo with overlaid back button */}
      <View style={{ position: 'relative', height: 280 }}>
        {imgFailed ? (
          <LinearGradient
            colors={gradients.sunrise}
            start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
            style={{ width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center' }}
          >
            <View style={{
              width: 96, height: 96, borderRadius: radius.xl,
              backgroundColor: 'rgba(255,255,255,0.22)',
              alignItems: 'center', justifyContent: 'center',
            }}>
              <Icon name="restaurant" size={44} color={colors.white} />
            </View>
          </LinearGradient>
        ) : (
          <Image
            source={{ uri: cover }}
            style={{ width: '100%', height: '100%' }}
            resizeMode="cover"
            onError={() => setImgFailed(true)}
          />
        )}
        <LinearGradient
          colors={['rgba(0,0,0,0.45)', 'rgba(0,0,0,0)', 'rgba(0,0,0,0.55)']}
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
        />
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
          accessibilityLabel={t('common.back')}
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
            {eta ? <InfoMetric icon="clock" label={t('rider.restaurants.etaLabel')} value={eta} /> : null}
            {restaurant.zone ? <InfoMetric icon="pin" label={t('rider.restaurants.zoneLabel')} value={restaurant.zone} /> : null}
          </FadeInView>
        ) : null}

        {restaurant.description ? (
          <FadeInView delay={140} style={{ marginTop: spacing.lg }}>
            <AppText variant="overline" color={colors.muted}>{t('rider.restaurants.about')}</AppText>
            <AppText variant="body" color={colors.ink2} style={{ marginTop: spacing.sm }}>
              {restaurant.description}
            </AppText>
          </FadeInView>
        ) : null}

        {restaurant.address ? (
          <FadeInView delay={200} style={{ marginTop: spacing.lg }}>
            <AppText variant="overline" color={colors.muted}>{t('rider.restaurants.address')}</AppText>
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

      {/* CTAs — primary actions */}
      <View style={{ paddingHorizontal: spacing.lg, marginTop: spacing.xl, marginBottom: spacing.huge, gap: spacing.sm }}>
        <FadeInView delay={260}>
          {/* Primary: take a ride to this restaurant. */}
          <PressableScale
            onPress={goAsRide}
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
            <Icon name="ride" size={22} color={colors.white} />
            <AppText variant="title" color={colors.white}>{t('rider.restaurants.goToRestaurant')}</AppText>
          </PressableScale>
        </FadeInView>

        <FadeInView delay={310}>
          {/* Secondary: send a parcel FROM this restaurant to current location. */}
          <PressableScale
            onPress={goAsColis}
            scaleTo={0.97}
            style={{
              backgroundColor: colors.surface,
              borderRadius: radius.lg,
              paddingVertical: 15,
              flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
              gap: spacing.sm,
              borderWidth: 1.5, borderColor: colors.line,
              ...shadow.card,
            }}
          >
            <Icon name="parcel" size={22} color={colors.ember} />
            <AppText variant="title" color={colors.ember}>{t('rider.restaurants.deliverFromHere')}</AppText>
          </PressableScale>
        </FadeInView>

        {phone ? (
          <FadeInView delay={340}>
            <PressableScale
              onPress={() => Linking.openURL(`tel:${phone}`)}
              scaleTo={0.97}
              style={{
                backgroundColor: colors.surface,
                borderRadius: radius.lg,
                paddingVertical: 15,
                flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
                gap: spacing.sm,
                borderWidth: 1.5, borderColor: colors.line,
                ...shadow.card,
              }}
            >
              <Icon name="phone" size={22} color={colors.ember} />
              <AppText variant="title" color={colors.ember}>{t('rider.restaurants.callRestaurant')}</AppText>
            </PressableScale>
          </FadeInView>
        ) : null}

        <FadeInView delay={360}>
          <Button
            variant="ghost"
            title={t('rider.restaurants.viewMenu')}
            icon="menu"
            onPress={() => {
              // When the admin has uploaded menu photos, show them full-screen.
              // Otherwise fall back to the "coming soon" notice.
              if (hasMenu) { setMenuIndex(0); setMenuOpen(true); }
              else Alert.alert(
                t('rider.restaurants.menuAlertTitle'),
                t('rider.restaurants.menuAlertBody', { name: restaurant.name }),
              );
            }}
            style={{ marginTop: spacing.xs }}
          />
        </FadeInView>
      </View>

      {/* Full-screen menu (carte des plats) viewer — pinch-to-zoom on iOS. */}
      <Modal
        visible={menuOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setMenuOpen(false)}
      >
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.94)' }}>
          {/* Horizontal pager — one page per photo, each pinch-to-zoom on iOS. */}
          <ScrollView
            horizontal
            pagingEnabled
            style={{ flex: 1 }}
            showsHorizontalScrollIndicator={false}
            onMomentumScrollEnd={(e) =>
              setMenuIndex(Math.round(e.nativeEvent.contentOffset.x / screenW))
            }
          >
            {menuPhotos.map((uri, i) => (
              <ScrollView
                key={`${uri}-${i}`}
                style={{ width: screenW }}
                contentContainerStyle={{ flexGrow: 1, alignItems: 'center', justifyContent: 'center' }}
                maximumZoomScale={4}
                minimumZoomScale={1}
                centerContent
                showsVerticalScrollIndicator={false}
                showsHorizontalScrollIndicator={false}
              >
                <Image
                  source={{ uri }}
                  style={{ width: screenW, height: '100%' }}
                  resizeMode="contain"
                />
              </ScrollView>
            ))}
          </ScrollView>
          <View style={{
            position: 'absolute', top: spacing.xxl + spacing.sm + 4, left: 0, right: 0,
            alignItems: 'center',
          }}>
            <AppText variant="bodyStrong" color={colors.white}>
              {menuPhotos.length > 1
                ? `${t('rider.restaurants.menuAlertTitle')} · ${menuIndex + 1}/${menuPhotos.length}`
                : t('rider.restaurants.menuAlertTitle')}
            </AppText>
          </View>
          <Pressable
            onPress={() => setMenuOpen(false)}
            hitSlop={10}
            style={{
              position: 'absolute', top: spacing.xxl + spacing.sm, right: spacing.lg,
              width: 44, height: 44, borderRadius: radius.md,
              backgroundColor: 'rgba(255,255,255,0.92)',
              alignItems: 'center', justifyContent: 'center',
              ...shadow.card,
            }}
            accessibilityLabel={t('common.close', { defaultValue: 'Fermer' })}
          >
            <Icon name="close" size={22} color={colors.ink} />
          </Pressable>
        </View>
      </Modal>
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
