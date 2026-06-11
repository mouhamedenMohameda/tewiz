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
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { Candidate, SideBlock, Side } from '@/lib/voiceLocation';

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
  const sideLabel = side === 'pickup' ? 'départ' : side === 'destination' ? 'destination' : '';
  const candidates = block?.candidates ?? [];
  const transcript = block?.extracted.raw_phrase ?? null;

  return (
    <Modal
      transparent
      visible={visible}
      animationType="slide"
      onRequestClose={onClose}
    >
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={styles.sheet}>
        <View style={styles.handle} />
        <View style={styles.header}>
          <Text style={styles.title}>Quel {sideLabel} ?</Text>
          {transcript ? (
            <Text style={styles.subtitle} numberOfLines={2}>
              Vous avez dit : « {transcript} »
            </Text>
          ) : null}
        </View>

        {candidates.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyText}>
              Aucun lieu correspondant n'a été trouvé. Touchez la carte ou
              tapez le nom du lieu.
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
            style={{ maxHeight: 420 }}
          />
        )}

        <Pressable style={styles.cancel} onPress={onClose}>
          <Text style={styles.cancelText}>Annuler</Text>
        </Pressable>
      </View>
    </Modal>
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
  const kind = candidate.osm_value
    ? `${candidate.osm_kind} · ${candidate.osm_value}`
    : candidate.osm_kind;

  const distanceLabel = candidate.distance_to_landmarks_m
    ? `à ${formatMeters(candidate.distance_to_landmarks_m)} du repère`
    : null;

  const confColor =
    candidate.confidence === 'high' ? '#10a35e'
    : candidate.confidence === 'medium' ? '#f59e0b'
    : '#94a3b8';

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        pressed && { backgroundColor: '#f1f5f9' },
      ]}
    >
      <View style={[styles.bullet, { backgroundColor: preselected ? '#10a35e' : '#e2e8f0' }]}>
        <Text style={{ color: preselected ? '#fff' : '#94a3b8', fontWeight: '700' }}>
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

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(15,23,42,0.5)',
  },
  sheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: 8,
    paddingBottom: 24,
    paddingHorizontal: 16,
  },
  handle: {
    alignSelf: 'center',
    width: 36, height: 4, borderRadius: 2,
    backgroundColor: '#cbd5e1',
    marginBottom: 12,
  },
  header: {
    paddingBottom: 12, gap: 4,
  },
  title: {
    fontSize: 18, fontWeight: '700', color: '#0f172a',
  },
  subtitle: {
    fontSize: 12, color: '#64748b', fontStyle: 'italic',
  },
  empty: {
    paddingVertical: 32, paddingHorizontal: 16,
  },
  emptyText: {
    fontSize: 13, color: '#64748b', textAlign: 'center',
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
    fontSize: 15, fontWeight: '600', color: '#0f172a',
  },
  meta: {
    fontSize: 11, color: '#64748b', marginTop: 2,
  },
  arabic: {
    fontSize: 12, color: '#475569', marginTop: 1,
    writingDirection: 'rtl',
  },
  confDot: {
    width: 8, height: 8, borderRadius: 4,
  },
  sep: {
    height: 1, backgroundColor: '#f1f5f9', marginLeft: 40,
  },
  cancel: {
    marginTop: 12, alignItems: 'center', paddingVertical: 12,
  },
  cancelText: {
    color: '#64748b', fontSize: 14, fontWeight: '600',
  },
});
