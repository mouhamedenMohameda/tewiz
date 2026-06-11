import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator, Alert, Modal, Pressable, Text, TextInput, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Circle, Marker } from 'react-native-maps';
import { api } from '@/lib/api';

export type RoadReason =
  | 'sand' | 'flood' | 'construction'
  | 'police_checkpoint' | 'accident' | 'protest' | 'other';

interface RoadReport {
  id: string;
  reporterRole: string;
  location: { lat: number; lng: number };
  radiusM: number;
  reason: RoadReason;
  note: string | null;
  reportedAt: string;
  expiresAt: string;
  confirmations: number;
  dismissals: number;
  status: string;
}

const REASON_META: Record<RoadReason, { label: string; emoji: string; color: string }> = {
  sand:              { label: 'Sable',             emoji: '🏜️', color: '#ca8a04' },
  flood:             { label: 'Inondation',         emoji: '🌊', color: '#0891b2' },
  construction:      { label: 'Travaux',            emoji: '🚧', color: '#f59e0b' },
  police_checkpoint: { label: 'Contrôle police',    emoji: '👮', color: '#1e40af' },
  accident:          { label: 'Accident',           emoji: '💥', color: '#dc2626' },
  protest:           { label: 'Manifestation',      emoji: '✊', color: '#7c3aed' },
  other:             { label: 'Autre',              emoji: '⚠️', color: '#475569' },
};

/**
 * Shared hook: fetches active road reports every 60 s. Used by both the
 * captain heatmap and the rider new-ride map so reports stay fresh while
 * the screen is open.
 */
export function useRoadReports() {
  const [reports, setReports] = useState<RoadReport[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const r = await api.get<RoadReport[]>('/road-reports');
      setReports(r.data);
    } catch {
      // Network blip — keep last good list.
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const id = setInterval(refresh, 60_000);
    return () => clearInterval(id);
  }, [refresh]);

  return { reports, loading, refresh };
}

/**
 * Map overlay: a circle for each active report's affected zone + a small
 * marker for its centre. Must be rendered as a direct child of <MapView>.
 */
export function RoadReportMarkers({
  reports, onPress,
}: {
  reports: RoadReport[];
  onPress?: (r: RoadReport) => void;
}) {
  return (
    <>
      {reports.map((r) => {
        const m = REASON_META[r.reason];
        return (
          <Circle
            key={`zone-${r.id}`}
            center={{ latitude: r.location.lat, longitude: r.location.lng }}
            radius={r.radiusM}
            fillColor={`${m.color}33`}      // ~20% alpha
            strokeColor={m.color}
            strokeWidth={1.5}
          />
        );
      })}
      {reports.map((r) => {
        const m = REASON_META[r.reason];
        return (
          <Marker
            key={`pin-${r.id}`}
            coordinate={{ latitude: r.location.lat, longitude: r.location.lng }}
            title={`${m.emoji} ${m.label}`}
            description={r.note ?? `Signalé · ${r.confirmations}✓ ${r.dismissals}✗`}
            pinColor={m.color}
            onPress={onPress ? () => onPress(r) : undefined}
          />
        );
      })}
    </>
  );
}

/**
 * Floating bottom-right button + declaration sheet. Self-contained: the
 * caller just mounts it inside the screen and passes the current GPS
 * coordinates (or pickup point) to use as the report location.
 *
 * `onCreated` is called after a successful submission so the parent can
 * refresh its overlay.
 */
export function RoadReportButton({
  at, onCreated, bottom = 84,
}: {
  at: { lat: number; lng: number } | null;
  onCreated?: () => void;
  bottom?: number;
}) {
  const [sheetOpen, setSheetOpen] = useState(false);

  return (
    <>
      <View
        pointerEvents="box-none"
        style={{
          position: 'absolute', right: 14, bottom,
        }}
      >
        <Pressable
          disabled={!at}
          onPress={() => setSheetOpen(true)}
          style={({ pressed }) => ({
            backgroundColor: pressed ? '#c2410c' : '#ea580c',
            opacity: at ? 1 : 0.5,
            paddingHorizontal: 14, paddingVertical: 10, borderRadius: 999,
            flexDirection: 'row', alignItems: 'center', gap: 6,
            shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 6, shadowOffset: { width: 0, height: 3 },
          })}
        >
          <Text style={{ color: '#fff', fontSize: 13, fontWeight: '700' }}>
            ⚠️ Signaler
          </Text>
        </Pressable>
      </View>

      <ReportSheet
        visible={sheetOpen}
        at={at}
        onClose={() => setSheetOpen(false)}
        onCreated={() => { setSheetOpen(false); onCreated?.(); }}
      />
    </>
  );
}

function ReportSheet({
  visible, at, onClose, onCreated,
}: {
  visible: boolean;
  at: { lat: number; lng: number } | null;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [reason, setReason] = useState<RoadReason | null>(null);
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => { if (!visible) { setReason(null); setNote(''); } }, [visible]);

  async function submit() {
    if (!at || !reason) {
      Alert.alert('Incomplet', 'Choisissez une raison et assurez-vous que la position est connue.');
      return;
    }
    setSubmitting(true);
    try {
      await api.post('/road-reports', {
        lat: at.lat,
        lng: at.lng,
        reason,
        ...(note.trim() ? { note: note.trim() } : {}),
      });
      onCreated();
    } catch (e: any) {
      const err = e.response?.data?.error;
      Alert.alert('Impossible', err?.issues?.[0]?.message ?? err?.message ?? 'Échec.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={{
        flex: 1, backgroundColor: 'rgba(15, 23, 42, 0.6)',
        justifyContent: 'flex-end',
      }}>
        <SafeAreaView edges={['bottom']} style={{ backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24 }}>
          <View style={{ padding: 20, gap: 14 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={{ fontSize: 18, fontWeight: '700', color: '#0f172a' }}>
                Signaler une zone
              </Text>
              <Pressable onPress={onClose}>
                <Text style={{ color: '#64748b', fontSize: 18 }}>✕</Text>
              </Pressable>
            </View>
            <Text style={{ fontSize: 12, color: '#64748b' }}>
              Le signalement est visible par tous pendant 6h. Les autres usagers
              peuvent confirmer ou démentir.
            </Text>

            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {(Object.keys(REASON_META) as RoadReason[]).map((r) => {
                const m = REASON_META[r];
                const active = reason === r;
                return (
                  <Pressable
                    key={r}
                    onPress={() => setReason(r)}
                    style={({ pressed }) => ({
                      flexDirection: 'row', alignItems: 'center', gap: 6,
                      paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999,
                      backgroundColor: active ? m.color : (pressed ? '#e2e8f0' : '#f1f5f9'),
                    })}
                  >
                    <Text style={{ fontSize: 14 }}>{m.emoji}</Text>
                    <Text style={{
                      fontSize: 13, fontWeight: '600',
                      color: active ? '#fff' : '#0f172a',
                    }}>
                      {m.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <TextInput
              value={note}
              onChangeText={setNote}
              placeholder="Détail (optionnel) — ex: route fermée 100m"
              placeholderTextColor="#94a3b8"
              multiline
              maxLength={500}
              style={{
                borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 10,
                paddingHorizontal: 12, paddingVertical: 10, fontSize: 14,
                color: '#0f172a', backgroundColor: '#f8fafc',
                minHeight: 60, textAlignVertical: 'top',
              }}
            />

            <Pressable
              disabled={submitting || !reason}
              onPress={submit}
              style={({ pressed }) => ({
                backgroundColor: pressed ? '#c2410c' : '#ea580c',
                opacity: submitting || !reason ? 0.5 : 1,
                paddingVertical: 16, borderRadius: 12,
                flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
              })}
            >
              {submitting && <ActivityIndicator color="#fff" />}
              <Text style={{ color: '#fff', fontSize: 16, fontWeight: '700' }}>
                Envoyer le signalement
              </Text>
            </Pressable>
          </View>
        </SafeAreaView>
      </View>
    </Modal>
  );
}
