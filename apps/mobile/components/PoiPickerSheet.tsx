/**
 * PoiPickerSheet — picks one POI from the voiceloc corpus.
 *
 * Two ways in, deliberately in this order:
 *
 *  - CHIPS, drawn from the popular POIs of the scenario's assigned moughataa.
 *    Not "most used in the dataset so far": chips built from the corpus feed it
 *    back into itself and concentrate everything on the same handful of places
 *    the zone axis exists to spread out. Zone-scoped chips make the convenient
 *    tap also the diversifying one.
 *  - SEARCH across the whole corpus, for anywhere the chips don't cover.
 *
 * Every row shows the POI's kind and Arabic name alongside the French label,
 * because Nouakchott has several distinct places sharing a name and the label
 * alone is not enough to tell them apart.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { AppText, Icon, Sheet, TextField } from '@/components/ui';
import { searchPois, zonePois, placeLabel, type PoiOption } from '@/lib/voiceDataset';
import { colors, radius, spacing } from '@/theme';

// Short enough that the list feels like it tracks typing, long enough that a
// full word does not fire a request per keystroke.
const SEARCH_DEBOUNCE_MS = 180;
const MIN_QUERY_LENGTH = 2;

export interface PoiPickerSheetProps {
  visible: boolean;
  title: string;
  /** Moughataa code from the assigned scenario — scopes the chip shortlist. */
  zone: string;
  onSelect: (poi: PoiOption) => void;
  onClose: () => void;
}

export function PoiPickerSheet({ visible, title, zone, onSelect, onClose }: PoiPickerSheetProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [chips, setChips] = useState<PoiOption[]>([]);
  const [results, setResults] = useState<PoiOption[]>([]);
  const [loading, setLoading] = useState(false);

  // Guards against a slow early request overwriting a fast later one — the
  // classic out-of-order-response bug in debounced search.
  const requestSeq = useRef(0);

  // Reset on each open: a picker that reopens showing the previous search is
  // confusing when the two endpoints are picked back to back.
  useEffect(() => {
    if (!visible) return;
    setQuery('');
    setResults([]);
    zonePois(zone).then(setChips).catch(() => setChips([]));
  }, [visible, zone]);

  useEffect(() => {
    const q = query.trim();
    if (q.length < MIN_QUERY_LENGTH) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const seq = ++requestSeq.current;
    const timer = setTimeout(() => {
      searchPois(q, zone)
        .then((r) => {
          if (seq === requestSeq.current) setResults(r);
        })
        .catch(() => {
          if (seq === requestSeq.current) setResults([]);
        })
        .finally(() => {
          if (seq === requestSeq.current) setLoading(false);
        });
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query, zone]);

  const pick = useCallback((poi: PoiOption) => {
    onSelect(poi);
    onClose();
  }, [onSelect, onClose]);

  const searching = query.trim().length >= MIN_QUERY_LENGTH;

  return (
    <Sheet visible={visible} onClose={onClose} title={title}>
      <TextField
        icon="search"
        placeholder={t('rider.dataset.searchPlaceholder')}
        value={query}
        onChangeText={setQuery}
        autoCorrect={false}
        autoCapitalize="none"
      />

      {/* Chips stay up by default AND come back when a search returns nothing —
          which is exactly the moment the tester needs a fallback rather than an
          empty list. */}
      {(!searching || (!loading && results.length === 0)) && chips.length > 0 ? (
        <View style={{ marginTop: spacing.base }}>
          <AppText variant="overline" color={colors.muted}>
            {t('rider.dataset.zoneChips', { zone: t(`rider.dataset.zones.${zone}`) })}
          </AppText>
          <View style={{
            flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm,
          }}>
            {chips.map((poi) => (
              <Pressable
                key={poi.id}
                onPress={() => pick(poi)}
                style={{
                  paddingVertical: spacing.sm, paddingHorizontal: spacing.base,
                  borderRadius: radius.pill,
                  backgroundColor: colors.surfaceAlt,
                  borderWidth: 1, borderColor: colors.line,
                }}
              >
                <AppText variant="caption">{placeLabel(poi)}</AppText>
              </Pressable>
            ))}
          </View>
        </View>
      ) : null}

      <ScrollView
        style={{ marginTop: spacing.base, maxHeight: 320 }}
        keyboardShouldPersistTaps="handled"
      >
        {loading ? (
          <ActivityIndicator color={colors.ember} style={{ marginTop: spacing.lg }} />
        ) : null}

        {!loading && searching && results.length === 0 ? (
          <AppText variant="caption" color={colors.muted} align="center" style={{ marginTop: spacing.lg }}>
            {t('rider.dataset.noResults')}
          </AppText>
        ) : null}

        {results.map((poi) => (
          <Pressable
            key={poi.id}
            onPress={() => pick(poi)}
            style={({ pressed }) => ({
              flexDirection: 'row', alignItems: 'center', gap: spacing.md,
              paddingVertical: spacing.base,
              borderBottomWidth: 1, borderBottomColor: colors.line,
              opacity: pressed ? 0.6 : 1,
            })}
          >
            <Icon name="pin" size={18} color={colors.muted} />
            <View style={{ flex: 1 }}>
              <AppText variant="body" numberOfLines={1}>{placeLabel(poi)}</AppText>
              {/* Secondary line carries the OTHER script, so a tester can match
                  what they said against either spelling. */}
              <AppText variant="caption" color={colors.muted} numberOfLines={1}>
                {[poi.kind, placeLabel(poi) === poi.label ? poi.nameAr : poi.label]
                  .filter(Boolean).join(' · ')}
              </AppText>
            </View>
          </Pressable>
        ))}
      </ScrollView>
    </Sheet>
  );
}
