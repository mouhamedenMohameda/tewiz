import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import {
  AppText, FadeInView, Icon, PressableScale, Screen, ScreenHeader, TextField,
} from '@/components/ui';
import { colors, gradients, radius, shadow, spacing } from '@/theme';
import { CUISINE_CATEGORIES, fetchRestaurants, type Restaurant } from '@/lib/restaurants';
import { resolveRestaurantPhoto } from '@/lib/restaurantPhotos';

type CuisineKey = (typeof CUISINE_CATEGORIES)[number]['key'];

export default function RestaurantsScreen() {
  const router = useRouter();
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
      setError(e?.response?.data?.error?.message ?? 'Impossible de charger les restaurants.');
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
  // a very large dataset — not relevant yet.
  // Chip counts — only counts entries matching the current search, so the
  // numbers actually reflect what'll show after a tap. Calculated once and
  // reused for both the chip badges and the visible list.
  const matchesSearch = useCallback((r: Restaurant) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    const hay = `${r.name} ${r.nameFr ?? ''} ${r.nameAr ?? ''} ${r.zone ?? ''} ${r.tags.join(' ')}`.toLowerCase();
    return hay.includes(q);
  }, [query]);

  const counts = useMemo(() => {
    const m: Record<string, number> = { all: 0 };
    for (const r of items ?? []) {
      if (!matchesSearch(r)) continue;
      m['all'] = (m['all'] ?? 0) + 1;
      if (r.cuisine) m[r.cuisine] = (m[r.cuisine] ?? 0) + 1;
    }
    return m;
  }, [items, matchesSearch]);

  const filtered = useMemo(() => {
    if (!items) return [];
    return items.filter((r) => {
      if (cuisine !== 'all' && r.cuisine !== cuisine) return false;
      return matchesSearch(r);
    });
  }, [items, cuisine, matchesSearch]);

  return (
    <Screen scroll onRefresh={onRefresh} refreshing={refreshing}>
      <ScreenHeader
        title="Restaurants"
        subtitle="Nouakchott"
        onBack={() => router.back()}
      />

      <FadeInView>
        <HeroBanner count={items?.length ?? null} />
      </FadeInView>

      <FadeInView delay={60} style={{ marginTop: spacing.lg }}>
        <TextField
          icon="search"
          placeholder="Rechercher un restaurant, un plat…"
          value={query}
          onChangeText={setQuery}
          autoCorrect={false}
          autoCapitalize="none"
        />
      </FadeInView>

      <FadeInView delay={120} style={{ marginTop: spacing.base, marginHorizontal: -spacing.lg }}>
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
                label={c.label}
                icon={c.icon}
                count={count}
                disabled={count === 0 && c.key !== 'all'}
                active={cuisine === c.key}
                onPress={() => setCuisine(c.key)}
              />
            );
          })}
        </ScrollView>
      </FadeInView>

      <View style={{
        flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between',
        marginTop: spacing.xl, marginBottom: spacing.md,
      }}>
        <AppText variant="overline" color={colors.muted}>
          {items === null
            ? 'Chargement…'
            : `${filtered.length} ${filtered.length > 1 ? 'adresses' : 'adresse'}`}
        </AppText>
        <AppText variant="caption" color={colors.muted}>Triés par popularité</AppText>
      </View>

      {items === null ? (
        <LoadingList />
      ) : error ? (
        <ErrorState message={error} onRetry={load} />
      ) : filtered.length === 0 ? (
        <EmptyState onReset={() => { setQuery(''); setCuisine('all'); }} />
      ) : (
        <View style={{ gap: spacing.lg }}>
          {filtered.map((r, i) => (
            <FadeInView key={r.id} delay={Math.min(60 + i * 30, 400)}>
              <RestaurantCard
                restaurant={r}
                onPress={() => router.push(`/(app)/rider/restaurant/${r.id}`)}
              />
            </FadeInView>
          ))}
        </View>
      )}
    </Screen>
  );
}

/* ------------------------------------------------------------------ */

function HeroBanner({ count }: { count: number | null }) {
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
        <AppText variant="overline" color="#FFF1DD">À table</AppText>
      </View>
      <AppText variant="h1" color={colors.white} style={{ marginTop: spacing.md, maxWidth: 260 }}>
        Les meilleures tables de Nouakchott
      </AppText>
      <AppText variant="body" color="#FFF1DD" style={{ marginTop: spacing.xs, maxWidth: 280 }}>
        {count === null
          ? 'On charge la sélection…'
          : `${count} restaurants triés sur le volet — bientôt avec leurs cartes.`}
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
          borderRadius: 9,
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
  // Every card now shows a photo: curated when present, deterministic Unsplash
  // fallback otherwise. Keeps the list visually consistent — no blank tiles.
  const photo = resolveRestaurantPhoto(restaurant);
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
        <Image source={{ uri: photo }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
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
        <View style={{ padding: spacing.base, flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
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
  return (
    <View style={{ alignItems: 'center', paddingVertical: spacing.huge, gap: spacing.md }}>
      <View style={{
        width: 64, height: 64, borderRadius: radius.lg,
        backgroundColor: colors.dangerSoft,
        alignItems: 'center', justifyContent: 'center',
      }}>
        <Icon name="alert" size={30} color={colors.danger} />
      </View>
      <AppText variant="title">Une erreur est survenue</AppText>
      <AppText variant="body" color={colors.ink2} style={{ textAlign: 'center', maxWidth: 280 }}>
        {message}
      </AppText>
      <Pressable onPress={onRetry} hitSlop={8}>
        <AppText variant="bodyStrong" color={colors.ember}>Réessayer</AppText>
      </Pressable>
    </View>
  );
}

function EmptyState({ onReset }: { onReset: () => void }) {
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
      <AppText variant="title">Aucune adresse trouvée</AppText>
      <AppText variant="body" color={colors.ink2} style={{ textAlign: 'center', maxWidth: 280 }}>
        Essayez un autre mot-clé ou changez de catégorie.
      </AppText>
      <Pressable onPress={onReset} hitSlop={8}>
        <AppText variant="bodyStrong" color={colors.ember}>Réinitialiser les filtres</AppText>
      </Pressable>
    </View>
  );
}
