/**
 * Bottom sheet that presents the top candidates returned by the
 * voice-to-location API for a single side (pickup or destination).
 *
 * Layout:
 *   ┌──────────────────────────────────┐
 *   │ Quel <pickup|destination> ?      │
 *   │ Vous avez dit : « ... »          │
 *   │                                  │
 *   │ ✓ Carrefour Oum Ghasser   🎯     │
 *   │   amenity · marketplace          │
 *   │   à 240 m de Lakbeida            │
 *   │                                  │
 *   │ ○ Mairie Dar Naim                │
 *   │   amenity · townhall             │
 *   └──────────────────────────────────┘
 *
 * The parent passes the side block from the API response. On selection,
 * we surface the chosen candidate so the parent can update its state +
 * fire /voice-to-location/confirm.
 */

import {
  FlatList,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { PlainText as Text, Sheet } from '@/components/ui';
import type { Candidate, SideBlock, Side } from '@/lib/voiceLocation';
import { colors, spacing, statusTone } from '@/theme';

interface Props {
  visible: boolean;
  side: Side | null;
  block: SideBlock | null;
  /** Pre-selected top candidate, highlighted with ✓. */
  preselectedPoiId?: number | null;
  onClose: () => void;
  onSelect: (c: Candidate) => void;
}

export function VoiceCandidateSheet({
  visible,
  side,
  block,
  preselectedPoiId,
  onClose,
  onSelect,
}: Props) {
  const { t } = useTranslation();
  const title = side === 'pickup'
    ? t('voiceCandidate.questionPickup')
    : side === 'destination'
      ? t('voiceCandidate.questionDestination')
      : '';
  const candidates = block?.candidates ?? [];
  const transcript = block?.extracted.raw_phrase ?? null;

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={title}
      // The transcript is what the user just said — it belongs in the header,
      // right next to the question it is answering, not floating above a list.
      subtitle={transcript ? t('voiceCandidate.youSaid', { text: transcript }) : undefined}
    >
      {candidates.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>
            {t('voiceCandidate.emptyBody')}
          </Text>
        </View>
      ) : (
        <FlatList
          data={candidates}
          keyExtractor={(c) => String(c.poi_id)}
          renderItem={({ item }) => (
            <CandidateRow
              candidate={item}
              preselected={item.poi_id === preselectedPoiId}
              onPress={() => onSelect(item)}
            />
          )}
          ItemSeparatorComponent={() => <View style={styles.sep} />}
          style={{ flexShrink: 1 }}
        />
      )}

      <Pressable style={styles.cancel} onPress={onClose}>
        <Text style={styles.cancelText}>{t('common.cancel')}</Text>
      </Pressable>
    </Sheet>
  );
}

// ---------------------------------------------------------------------------

function CandidateRow({
  candidate,
  preselected,
  onPress,
}: {
  candidate: Candidate;
  preselected: boolean;
  onPress: () => void;
}) {
  const { t } = useTranslation();
  const kind = candidate.osm_value
    ? `${candidate.osm_kind} · ${candidate.osm_value}`
    : candidate.osm_kind;

  const distanceLabel = candidate.distance_to_landmarks_m
    ? t('voiceCandidate.distanceToLandmark', { distance: formatMeters(candidate.distance_to_landmarks_m) })
    : null;

  const confColor =
    candidate.confidence === 'high' ? colors.ember
    : candidate.confidence === 'medium' ? statusTone.pending.fg
    : colors.faint;

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        pressed && { backgroundColor: colors.line },
      ]}
    >
      <View style={[styles.bullet, { backgroundColor: preselected ? colors.ember : colors.line }]}>
        <Text style={{ color: preselected ? '#fff' : colors.faint, fontWeight: '700' }}>
          {preselected ? '✓' : '○'}
        </Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.name} numberOfLines={1}>{candidate.name}</Text>
        <Text style={styles.meta}>
          {kind}
          {distanceLabel ? ` · ${distanceLabel}` : ''}
        </Text>
        {candidate.name_ar ? (
          <Text style={styles.arabic} numberOfLines={1}>{candidate.name_ar}</Text>
        ) : null}
      </View>
      <View style={[styles.confDot, { backgroundColor: confColor }]} />
    </Pressable>
  );
}

// ---------------------------------------------------------------------------

function formatMeters(m: number): string {
  if (m < 1000) return `${Math.round(m)} m`;
  return `${(m / 1000).toFixed(1)} km`;
}

// The scrim, surface, handle and header now come from <Sheet>, so every sheet
// in the app shares one set of values instead of six near-misses.
const styles = StyleSheet.create({
  empty: {
    paddingVertical: 32, paddingHorizontal: 16,
  },
  emptyText: {
    fontSize: 13, color: colors.ink2, textAlign: 'center',
  },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingVertical: 10, paddingHorizontal: 4,
  },
  bullet: {
    width: 28, height: 28, borderRadius: 14,
    alignItems: 'center', justifyContent: 'center',
  },
  name: {
    fontSize: 15, fontWeight: '600', color: colors.ink,
  },
  meta: {
    fontSize: 11, color: colors.ink2, marginTop: 2,
  },
  arabic: {
    fontSize: 12, color: colors.ink2, marginTop: 1,
    writingDirection: 'rtl',
  },
  confDot: {
    width: 8, height: 8, borderRadius: 4,
  },
  sep: {
    height: 1, backgroundColor: colors.line, marginStart: 40,
  },
  cancel: {
    marginTop: spacing.md, alignItems: 'center', paddingVertical: spacing.md,
  },
  cancelText: {
    color: colors.ink2, fontSize: 13, fontWeight: '600',
  },
});
