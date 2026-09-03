import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, View } from 'react-native';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { LinearGradient } from 'expo-linear-gradient';
import {
  AppText, FadeInView, Icon, PressableScale, Screen,
} from '@/components/ui';
import { colors, gradients, radius, shadow, spacing } from '@/theme';
import { formatMru } from '@/lib/format';
import { fetchRestaurantById, type MenuItem, type Restaurant } from '@/lib/restaurants';
import { resolveRestaurantCover } from '@/lib/restaurantPhotos';
import { wrapRow } from '@/components/ui';
import { useThemeRepaint } from '@/theme/ThemeProvider';

export default function RestaurantDetailScreen() {
  useThemeRepaint();
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { t, i18n } = useTranslation();
  const [restaurant, setRestaurant] = useState<Restaurant | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [imgFailed, setImgFailed] = useState(false);

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

  // Cover = deterministic Unsplash fallback keyed on cuisine (photos were
  // dropped from the collection flow — the menu is now structured data).
  const cover = resolveRestaurantCover(restaurant);
  // Structured menu (dish + price). The API returns lines sorted by
  // sort_order; group them by category, categories keeping their
  // first-appearance order. Uncategorized lines render without a header.
  const isArabic = i18n.language.startsWith('ar');
  const dishName = (m: MenuItem) => (isArabic ? m.nameAr : (m.nameFr ?? m.nameAr));
  const menuSections: Array<{ category: string; items: MenuItem[] }> = [];
  for (const item of restaurant.menu ?? []) {
    const category = item.category?.trim() ?? '';
    const section = menuSections.find((s) => s.category === category);
    if (section) section.items.push(item);
    else menuSections.push({ category, items: [item] });
  }
  // A restaurant can list several numbers; the array is the source of truth,
  // with the legacy single `phone` as a fallback for older rows.
  const phones = ((restaurant.phones ?? []).length > 0
    ? restaurant.phones
    : (restaurant.phone ? [restaurant.phone] : []))
    .map((p) => p.trim())
    .filter(Boolean);
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
            contentFit="cover"
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
            <View style={{ flexDirection: wrapRow, flexWrap: 'wrap', gap: 6, marginTop: spacing.md }}>
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
          <FadeInView delay={30} style={{
            flexDirection: 'row', gap: spacing.md, marginTop: spacing.lg,
            paddingTop: spacing.lg, borderTopWidth: 1, borderTopColor: colors.line,
          }}>
            {eta ? <InfoMetric icon="clock" label={t('rider.restaurants.etaLabel')} value={eta} /> : null}
            {restaurant.zone ? <InfoMetric icon="pin" label={t('rider.restaurants.zoneLabel')} value={restaurant.zone} /> : null}
          </FadeInView>
        ) : null}

        {restaurant.description ? (
          <FadeInView delay={60} style={{ marginTop: spacing.lg }}>
            <AppText variant="overline" color={colors.muted}>{t('rider.restaurants.about')}</AppText>
            <AppText variant="body" color={colors.ink2} style={{ marginTop: spacing.sm }}>
              {restaurant.description}
            </AppText>
          </FadeInView>
        ) : null}

        {phones.length > 0 ? (
          <FadeInView delay={80} style={{ marginTop: spacing.lg }}>
            <AppText variant="overline" color={colors.muted}>{t('rider.restaurants.phoneLabel')}</AppText>
            <View style={{ gap: spacing.sm, marginTop: spacing.sm }}>
              {phones.map((num, i) => (
                <PressableScale
                  key={`${num}-${i}`}
                  onPress={() => Linking.openURL(`tel:${num}`)}
                  scaleTo={0.98}
                  style={{
                    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
                    backgroundColor: colors.surfaceAlt,
                    borderRadius: radius.md,
                    paddingVertical: 10, paddingHorizontal: spacing.md,
                  }}
                >
                  <View style={{
                    width: 36, height: 36, borderRadius: radius.sm,
                    backgroundColor: colors.emberSoft,
                    alignItems: 'center', justifyContent: 'center',
                  }}>
                    <Icon name="phone" size={18} color={colors.ember} />
                  </View>
                  <AppText variant="bodyStrong" style={{ flex: 1 }}>{num}</AppText>
                  <View style={{
                    backgroundColor: colors.ember,
                    paddingHorizontal: 14, paddingVertical: 7, borderRadius: radius.pill,
                  }}>
                    <AppText variant="label" color={colors.white}>{t('rider.restaurants.call')}</AppText>
                  </View>
                </PressableScale>
              ))}
            </View>
          </FadeInView>
        ) : null}

        {restaurant.address ? (
          <FadeInView delay={100} style={{ marginTop: spacing.lg }}>
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

      {/* Structured menu — dishes grouped by category, with prices. */}
      {menuSections.length > 0 ? (
        <FadeInView delay={120} style={{
          marginHorizontal: spacing.lg,
          marginTop: spacing.md,
          backgroundColor: colors.surface,
          borderRadius: radius.xxl,
          padding: spacing.xl,
          ...shadow.card,
        }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
            <View style={{
              width: 36, height: 36, borderRadius: radius.sm,
              backgroundColor: colors.emberSoft,
              alignItems: 'center', justifyContent: 'center',
            }}>
              <Icon name="menu" size={18} color={colors.ember} />
            </View>
            <AppText variant="title">{t('rider.restaurants.menuTitle')}</AppText>
          </View>

          {menuSections.map(({ category, items }) => (
            <View key={category || '__uncategorized__'} style={{ marginTop: spacing.lg }}>
              {category ? (
                <AppText variant="overline" color={colors.ember}>{category}</AppText>
              ) : null}
              <View style={{ marginTop: category ? spacing.xs : 0 }}>
                {items.map((item, i) => (
                  <View
                    key={item.id}
                    style={{
                      flexDirection: 'row', alignItems: 'center', gap: spacing.md,
                      paddingVertical: 10,
                      borderBottomWidth: i === items.length - 1 ? 0 : 1,
                      borderBottomColor: colors.line,
                    }}
                  >
                    <AppText variant="body" style={{ flex: 1 }}>{dishName(item)}</AppText>
                    <AppText variant="bodyStrong" color={colors.ember}>
                      {formatMru(item.priceMru)}
                    </AppText>
                  </View>
                ))}
              </View>
            </View>
          ))}
        </FadeInView>
      ) : null}

      {/* CTAs — primary actions */}
      <View style={{ paddingHorizontal: spacing.lg, marginTop: spacing.xl, marginBottom: spacing.huge, gap: spacing.sm }}>
        <FadeInView delay={140}>
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

        <FadeInView delay={160}>
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
