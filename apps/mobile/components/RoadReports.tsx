import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator, Alert, Modal, Pressable, Text, TextInput, View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getMapbox } from '@/lib/mapbox';
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

const REASON_META: Record<RoadReason, { emoji: string; color: string }> = {
  sand:              { emoji: '🏜️', color: '#ca8a04' },
  flood:             { emoji: '🌊', color: '#0891b2' },
  construction:      { emoji: '🚧', color: '#f59e0b' },
  police_checkpoint: { emoji: '👮', color: '#1e40af' },
  accident:          { emoji: '💥', color: '#dc2626' },
  protest:           { emoji: '✊', color: '#7c3aed' },
  other:             { emoji: '⚠️', color: '#475569' },
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

/** ~64-sided polygon approximating a circle of `radiusM` metres around `[lng,lat]`. */
function circlePolygon(lng: number, lat: number, radiusM: number, sides = 48): GeoJSON.Position[] {
  const coords: GeoJSON.Position[] = [];
  const earth = 6378137;
  const latRad = (lat * Math.PI) / 180;
  for (let i = 0; i <= sides; i++) {
    const theta = (i * 2 * Math.PI) / sides;
    const dx = (radiusM * Math.cos(theta)) / (earth * Math.cos(latRad));
    const dy = (radiusM * Math.sin(theta)) / earth;
    coords.push([lng + (dx * 180) / Math.PI, lat + (dy * 180) / Math.PI]);
  }
  return coords;
}

/**
 * Map overlay: a circle for each active report's affected zone + a small
 * marker for its centre. Must be rendered as a direct child of <MapShell>.
 */
export function RoadReportMarkers({
  reports, onPress,
}: {
  reports: RoadReport[];
  onPress?: (r: RoadReport) => void;
}) {
  const M = getMapbox();
  if (!M) return null;

  const { t } = useTranslation();

  // Build one FeatureCollection for the zones so a single layer renders all
  // overlays (cheaper than one source per report).
  const zonesGeoJson = useMemo<GeoJSON.FeatureCollection>(() => ({
    type: 'FeatureCollection',
    features: reports.map((r) => ({
      type: 'Feature',
      id: r.id,
      properties: { color: REASON_META[r.reason].color },
      geometry: {
        type: 'Polygon',
        coordinates: [circlePolygon(r.location.lng, r.location.lat, r.radiusM)],
      },
    })),
  }), [reports]);

  return (
    <>
      <M.ShapeSource id="road-report-zones" shape={zonesGeoJson}>
        <M.FillLayer
          id="road-report-zone-fill"
          style={{
            fillColor: ['get', 'color'],
            fillOpacity: 0.2,
          }}
        />
        <M.LineLayer
          id="road-report-zone-outline"
          style={{
            lineColor: ['get', 'color'],
            lineWidth: 1.5,
          }}
        />
      </M.ShapeSource>
      {reports.map((r) => {
        const m = REASON_META[r.reason];
        const label = `${m.emoji} ${t(`roadReports.reasons.${r.reason}` as const)}`;
        return (
          <M.PointAnnotation
            key={`pin-${r.id}`}
            id={`pin-${r.id}`}
            coordinate={[r.location.lng, r.location.lat]}
            title={label}
            onSelected={onPress ? () => onPress(r) : undefined}
          >
            <View style={{
              width: 28, height: 28, borderRadius: 14,
              backgroundColor: m.color, borderWidth: 2, borderColor: '#fff',
              alignItems: 'center', justifyContent: 'center',
            }}>
              <Text style={{ fontSize: 14 }}>{m.emoji}</Text>
            </View>
          </M.PointAnnotation>
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
  const { t } = useTranslation();
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
            {t('roadReports.reportBtn')}
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
  const { t } = useTranslation();
  const [reason, setReason] = useState<RoadReason | null>(null);
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => { if (!visible) { setReason(null); setNote(''); } }, [visible]);

  async function submit() {
    if (!at || !reason) {
      Alert.alert(t('common.incomplete'), t('roadReports.incompleteBody'));
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
      Alert.alert(t('common.impossible'), err?.issues?.[0]?.message ?? err?.message ?? t('errors.generic'));
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
                {t('roadReports.sheetTitle')}
              </Text>
              <Pressable onPress={onClose}>
                <Text style={{ color: '#64748b', fontSize: 18 }}>✕</Text>
              </Pressable>
            </View>
            <Text style={{ fontSize: 12, color: '#64748b' }}>
              {t('roadReports.sheetHint')}
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
                      {t(`roadReports.reasons.${r}` as const)}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <TextInput
              value={note}
              onChangeText={setNote}
              placeholder={t('roadReports.notePlaceholder')}
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
                {t('roadReports.submit')}
              </Text>
            </Pressable>
          </View>
        </SafeAreaView>
      </View>
    </Modal>
  );
}
