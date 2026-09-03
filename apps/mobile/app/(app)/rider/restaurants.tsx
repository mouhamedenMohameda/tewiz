import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { LinearGradient } from 'expo-linear-gradient';
import {
  AppText, FadeInView, Icon, PressableScale, Screen, ScreenHeader, TextField,
} from '@/components/ui';
import { colors, gradients, radius, shadow, spacing } from '@/theme';
import { CUISINE_CATEGORIES, fetchRestaurants, type Restaurant } from '@/lib/restaurants';
import { cuisineCounts, filterRestaurants } from '@/lib/restaurantFilter';
import { resolveRestaurantCover } from '@/lib/restaurantPhotos';
import { wrapRow } from '@/components/ui';
import { useThemeRepaint } from '@/theme/ThemeProvider';

type CuisineKey = (typeof CUISINE_CATEGORIES)[number]['key'];

export default function RestaurantsScreen() {
  useThemeRepaint();
  const router = useRouter();
  const { t } = useTranslation();
  const [query, setQuery] = useState('');

  const [cuisine, setCuisine] = useState<CuisineKey>('all');
  const [items, setItems] = useState<Restaurant[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The mobile app has no shared React-Query layer; we use a plain fetch and
  // re-pull on focus / pull-to-refresh, matching the rest of /rider/*.
  const load = useCallback(async () => {
    setError(null);
    try {
      const data = await fetchRestaurants();
      setItems(data);
    } catch (e: any) {
      setError(e?.response?.data?.error?.message ?? t('rider.restaurants.loadError'));
      setItems([]);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  // Filtering happens client-side so chip + search are instant. Search and
  // cuisine are also accepted by the API for the rare case of paging through
  // a very large dataset — not relevant yet. The pure logic lives in
  // `@/lib/restaurantFilter` so it stays unit-tested and identical whether the
  // list renders through a ScrollView or a FlatList.
  //
  // Chip counts only count entries matching the current search, so the numbers
  // reflect what'll show after a tap.
  const counts = useMemo(() => cuisineCounts(items, query), [items, query]);

  const filtered = useMemo(() => filterRestaurants(items, cuisine, query), [items, cuisine, query]);

  // Loading / error / empty all share the FlatList's empty slot: the header
  // (hero + search + chips) stays mounted above so the user can still search
  // while the first page loads.
  const listEmpty = items === null
    ? <LoadingList />
    : error
      ? <ErrorState message={error} onRetry={load} />
      : <EmptyState onReset={() => { setQuery(''); setCuisine('all'); }} />;

  // A FlatList (not ScrollView + map) so only the visible + windowed rows —
  // and therefore only their photos — mount. Opening the screen no longer
  // fires ~100 image requests at once.
  return (
    <Screen padded={false}>
      {/* Fixed top bar: back button + search + chips stay visible when keyboard opens */}
      <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.xxl }}>
        <ScreenHeader title={t('rider.restaurants.title')} subtitle={t('rider.restaurants.subtitle')} onBack={() => router.back()} />
        <TextField
          icon="search"
          placeholder={t('rider.restaurants.searchPlaceholder')}
          value={query}
          onChangeText={setQuery}
          autoCorrect={false}
          autoCapitalize="none"
        />
      </View>

      <View style={{ marginTop: spacing.base }}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: spacing.lg, gap: spacing.sm }}
        >
          {CUISINE_CATEGORIES.map((c) => {
            const count = counts[c.key] ?? 0;
            return (
              <CategoryChip
                key={c.key}
                label={t(`rider.restaurants.cuisine.${c.key}`, c.label)}
                icon={c.icon}
                count={count}
                disabled={count === 0 && c.key !== 'all'}
                active={cuisine === c.key}
                onPress={() => setCuisine(c.key)}
              />
            );
          })}
        </ScrollView>
      </View>

      <FlatList
        style={{ flex: 1 }}
        data={filtered}
        keyExtractor={(r) => r.id}
        renderItem={({ item, index }) => (
          <FadeInView delay={Math.min(index * 25, 150)}>
            <RestaurantCard
              restaurant={item}
              onPress={() => router.push(`/(app)/rider/restaurant/${item.id}`)}
            />
          </FadeInView>
        )}
        ListHeaderComponent={
          <RestaurantsListHeader
            total={items?.length ?? null}
            visibleCount={filtered.length}
            loading={items === null}
          />
        }
        ListEmptyComponent={listEmpty}
        ItemSeparatorComponent={CardSeparator}
        contentContainerStyle={{
          paddingHorizontal: spacing.lg,
          paddingTop: spacing.base,
          paddingBottom: spacing.huge,
        }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        initialNumToRender={6}
        maxToRenderPerBatch={8}
        windowSize={7}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.ember}
            colors={[colors.ember]}
          />
        }
      />
    </Screen>
  );
}

/* ------------------------------------------------------------------ */

const CardSeparator = () => <View style={{ height: spacing.lg }} />;

/**
 * The list header — hero, search box and cuisine chips. Kept at module scope
 * (not an inline closure) so its element type is stable across renders and the
 * search TextField never loses focus while the user is typing.
 */
function RestaurantsListHeader({
  total, visibleCount, loading,
}: {
  total: number | null;
  visibleCount: number;
  loading: boolean;
}) {
  const { t } = useTranslation();
  return (
    <>
      <FadeInView>
        <HeroBanner count={total} />
      </FadeInView>

      <View style={{
        flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between',
        marginTop: spacing.xl, marginBottom: spacing.md,
      }}>
        <AppText variant="overline" color={colors.muted}>
          {loading ? t('rider.restaurants.loading') : t('rider.restaurants.resultCount', { count: visibleCount })}
        </AppText>
        <AppText variant="caption" color={colors.muted}>{t('rider.restaurants.sortedBy')}</AppText>
      </View>
    </>
  );
}

/* ------------------------------------------------------------------ */

function HeroBanner({ count }: { count: number | null }) {
  const { t } = useTranslation();
  return (
    <LinearGradient
      colors={gradients.sunrise}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={{ borderRadius: radius.xxl, padding: spacing.xl, ...shadow.ember }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
        <View style={{
          width: 40, height: 40, borderRadius: radius.md,
          backgroundColor: 'rgba(255,255,255,0.22)',
          alignItems: 'center', justifyContent: 'center',
        }}>
          <Icon name="restaurant" size={22} color={colors.white} />
        </View>
        <AppText variant="overline" color={colors.onEspresso}>{t('rider.restaurants.heroOverline')}</AppText>
      </View>
      <AppText variant="h1" color={colors.white} style={{ marginTop: spacing.md, maxWidth: 260 }}>
        {t('rider.restaurants.heroTitle')}
      </AppText>
      <AppText variant="body" color={colors.onEspresso} style={{ marginTop: spacing.xs, maxWidth: 280 }}>
        {count === null
          ? t('rider.restaurants.heroLoading')
          : t('rider.restaurants.heroCount', { count })}
      </AppText>
    </LinearGradient>
  );
}

function CategoryChip({
  label, icon, count, active, disabled, onPress,
}: {
  label: string;
  icon: string;
  count: number;
  active: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  // Disabled chips stay visible (you should still see "Pizza" exists in the
  // catalog) but they look dim and non-clickable, so the user understands
  // there's nothing matching that filter right now.
  const fg = disabled ? colors.faint : active ? colors.white : colors.ink;
  const bg = disabled ? colors.surfaceAlt : active ? colors.ember : colors.surface;
  return (
    <Pressable onPress={disabled ? undefined : onPress} hitSlop={6} disabled={disabled}>
      <View style={{
        flexDirection: 'row', alignItems: 'center', gap: 6,
        paddingHorizontal: spacing.base, paddingVertical: 10,
        borderRadius: radius.pill,
        backgroundColor: bg,
        borderWidth: 1,
        borderColor: disabled ? colors.line : active ? colors.ember : colors.line,
        opacity: disabled ? 0.55 : 1,
        ...(active && !disabled ? shadow.ember : disabled ? {} : shadow.card),
      }}>
        <AppText variant="caption" color={fg}>{icon}</AppText>
        <AppText variant="label" color={fg}>{label}</AppText>
        <View style={{
          minWidth: 18, paddingHorizontal: 5, paddingVertical: 1,
          borderRadius: radius.sm,
          backgroundColor: active && !disabled ? 'rgba(255,255,255,0.25)' : colors.surfaceAlt,
        }}>
          <AppText
            variant="caption"
            color={active && !disabled ? colors.white : disabled ? colors.faint : colors.muted}
            style={{ textAlign: 'center' }}
          >
            {count}
          </AppText>
        </View>
      </View>
    </Pressable>
  );
}

function RestaurantCard({ restaurant, onPress }: { restaurant: Restaurant; onPress: () => void }) {
  // Every card shows a deterministic Unsplash cover keyed on cuisine — the
  // admin-uploaded photo is the menu card, not a storefront cover.
  const photo = resolveRestaurantCover(restaurant);
  // If the photo URL 404s (Unsplash sometimes prunes IDs) we drop into a
  // branded gradient placeholder rather than show an empty box.
  const [imgFailed, setImgFailed] = useState(false);
  const eta = restaurant.etaMin != null && restaurant.etaMax != null
    ? `${restaurant.etaMin}-${restaurant.etaMax} min`
    : null;
  const subtitleParts = [restaurant.zone, eta].filter(Boolean);

  return (
    <PressableScale
      onPress={onPress}
      scaleTo={0.98}
      style={{
        borderRadius: radius.xl,
        backgroundColor: colors.surface,
        overflow: 'hidden',
        ...shadow.card,
      }}
    >
      <View style={{ position: 'relative', height: 180, backgroundColor: colors.surfaceAlt }}>
        {imgFailed ? (
          <LinearGradient
            colors={gradients.sunrise}
            start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
            style={{ width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center' }}
          >
            <View style={{
              width: 64, height: 64, borderRadius: radius.lg,
              backgroundColor: 'rgba(255,255,255,0.22)',
              alignItems: 'center', justifyContent: 'center',
            }}>
              <Icon name="restaurant" size={32} color={colors.white} />
            </View>
          </LinearGradient>
        ) : (
          <Image
            source={{ uri: photo }}
            style={{ width: '100%', height: '100%' }}
            contentFit="cover"
            cachePolicy="memory-disk"
            transition={200}
            onError={() => setImgFailed(true)}
          />
        )}
        <LinearGradient
          colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.55)']}
          style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 90 }}
        />

        {restaurant.rating != null ? (
          <View style={{
            position: 'absolute', top: spacing.md, left: spacing.md,
            backgroundColor: 'rgba(255,255,255,0.92)',
            paddingHorizontal: 10, paddingVertical: 5, borderRadius: radius.pill,
            flexDirection: 'row', alignItems: 'center', gap: 4,
          }}>
            <Icon name="star" size={13} color={colors.warning} />
            <AppText variant="label" color={colors.ink}>{restaurant.rating.toFixed(1)}</AppText>
          </View>
        ) : null}
        {restaurant.priceLevel ? (
          <View style={{
            position: 'absolute', top: spacing.md, right: spacing.md,
            backgroundColor: 'rgba(0,0,0,0.55)',
            paddingHorizontal: 10, paddingVertical: 5, borderRadius: radius.pill,
          }}>
            <AppText variant="label" color={colors.white}>{restaurant.priceLevel}</AppText>
          </View>
        ) : null}

        <View style={{ position: 'absolute', left: spacing.base, right: spacing.base, bottom: spacing.md }}>
          <AppText variant="h2" color={colors.white} numberOfLines={1}>
            {restaurant.name}
          </AppText>
          {subtitleParts.length > 0 ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 }}>
              <Icon name="pin" size={13} color="rgba(255,255,255,0.85)" />
              <AppText variant="caption" color="rgba(255,255,255,0.85)" numberOfLines={1}>
                {subtitleParts.join(' · ')}
              </AppText>
            </View>
          ) : null}
        </View>
      </View>

      {restaurant.tags.length > 0 ? (
        <View style={{ padding: spacing.base, flexDirection: wrapRow, flexWrap: 'wrap', gap: 6 }}>
          {restaurant.tags.slice(0, 3).map((tag) => (
            <View
              key={tag}
              style={{
                backgroundColor: colors.surfaceAlt,
                paddingHorizontal: 9, paddingVertical: 3, borderRadius: radius.pill,
              }}
            >
              <AppText variant="caption" color={colors.ink2}>{tag}</AppText>
            </View>
          ))}
        </View>
      ) : null}
    </PressableScale>
  );
}

function LoadingList() {
  return (
    <View style={{ alignItems: 'center', paddingVertical: spacing.huge }}>
      <ActivityIndicator color={colors.ember} />
    </View>
  );
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  const { t } = useTranslation();
  return (
    <View style={{ alignItems: 'center', paddingVertical: spacing.huge, gap: spacing.md }}>
      <View style={{
        width: 64, height: 64, borderRadius: radius.lg,
        backgroundColor: colors.dangerSoft,
        alignItems: 'center', justifyContent: 'center',
      }}>
        <Icon name="alert" size={30} color={colors.danger} />
      </View>
      <AppText variant="title">{t('rider.restaurants.errorTitle')}</AppText>
      <AppText variant="body" color={colors.ink2} style={{ textAlign: 'center', maxWidth: 280 }}>
        {message}
      </AppText>
      <Pressable onPress={onRetry} hitSlop={8}>
        <AppText variant="bodyStrong" color={colors.ember}>{t('common.retry')}</AppText>
      </Pressable>
    </View>
  );
}

function EmptyState({ onReset }: { onReset: () => void }) {
  const { t } = useTranslation();
  return (
    <View style={{
      alignItems: 'center', paddingVertical: spacing.huge, gap: spacing.md,
    }}>
      <View style={{
        width: 64, height: 64, borderRadius: radius.lg,
        backgroundColor: colors.emberSoft,
        alignItems: 'center', justifyContent: 'center',
      }}>
        <Icon name="search" size={30} color={colors.ember} />
      </View>
      <AppText variant="title">{t('rider.restaurants.emptyTitle')}</AppText>
      <AppText variant="body" color={colors.ink2} style={{ textAlign: 'center', maxWidth: 280 }}>
        {t('rider.restaurants.emptyBody')}
      </AppText>
      <Pressable onPress={onReset} hitSlop={8}>
        <AppText variant="bodyStrong" color={colors.ember}>{t('rider.restaurants.resetFilters')}</AppText>
      </Pressable>
    </View>
  );
}
