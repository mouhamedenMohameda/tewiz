import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Button, PlainText as Text, PressableScale, Sheet } from '@/components/ui';
import { colors, fonts, radius, spacing, statusTone } from '@/theme';
import { currentLanguage, isRTL } from '@/lib/i18n';
import { getMapbox } from '@/lib/mapbox';
import { api } from '@/lib/api';
import { useApiQuery } from '@/lib/useApiQuery';
import { wrapRow } from '@/components/ui';

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
  sand:              { emoji: '🏜️', color: colors.warning },
  flood:             { emoji: '🌊', color: colors.water },
  construction:      { emoji: '🚧', color: statusTone.pending.fg },
  police_checkpoint: { emoji: '👮', color: statusTone.active.fg },
  accident:          { emoji: '💥', color: colors.danger },
  protest:           { emoji: '✊', color: statusTone.accent.fg },
  other:             { emoji: '⚠️', color: colors.ink2 },
};

/**
 * Shared hook: fetches active road reports every 60 s. Used by both the
 * captain heatmap and the rider new-ride map so reports stay fresh while
 * the screen is open.
 */
export function useRoadReports() {
  // Shared `['road-reports']` cache: the captain heatmap and the rider new-ride
  // map both call this hook, so when both are alive they de-duplicate to one
  // request. React Query keeps the last good list on a failed refetch (same as
  // the old silent-catch), and polling now pauses off-focus (battery).
  const { data: reports = [], isLoading: loading, refetch } = useApiQuery<RoadReport[]>(
    ['road-reports'],
    '/road-reports',
    { pollMs: 60_000, staleMs: 60_000 },
  );
  const refresh = useCallback(() => refetch().then(() => {}), [refetch]);
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
              backgroundColor: m.color, borderWidth: 2, borderColor: colors.white,
              alignItems: 'center', justifyContent: 'center',
            }}>
              <Text style={{ fontSize: 13 }}>{m.emoji}</Text>
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
            backgroundColor: pressed ? colors.emberDeep : colors.ember,
            opacity: at ? 1 : 0.5,
            paddingHorizontal: 14, paddingVertical: 10, borderRadius: radius.pill,
            flexDirection: 'row', alignItems: 'center', gap: 6,
            shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 6, shadowOffset: { width: 0, height: 3 },
          })}
        >
          <Text style={{ color: colors.white, fontSize: 13, fontWeight: '700' }}>
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
  const ar = isRTL(currentLanguage());
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
    <Sheet
      visible={visible}
      onClose={onClose}
      title={t('roadReports.sheetTitle')}
      subtitle={t('roadReports.sheetHint')}
      dismissible={!submitting}
      contentStyle={{ gap: spacing.md }}
    >
      {/* The hand-rolled ✕ is gone: the sheet already offers three ways out
          (drag it down, tap outside, Android back), all of them bigger targets
          than a 18pt glyph in a corner. */}
      <View style={{ flexDirection: wrapRow, flexWrap: 'wrap', gap: spacing.sm }}>
        {(Object.keys(REASON_META) as RoadReason[]).map((r) => {
          const m = REASON_META[r];
          const active = reason === r;
          return (
            <PressableScale
              key={r}
              onPress={() => setReason(r)}
              scaleTo={0.96}
              style={{
                flexDirection: 'row', alignItems: 'center', gap: 6,
                paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
                borderRadius: radius.pill,
                backgroundColor: active ? m.color : colors.line,
              }}
            >
              <Text style={{ fontSize: 13 }}>{m.emoji}</Text>
              <Text style={{
                fontSize: 13, fontWeight: '600',
                color: active ? colors.white : colors.ink,
              }}>
                {t(`roadReports.reasons.${r}` as const)}
              </Text>
            </PressableScale>
          );
        })}
      </View>

      <TextInput
        value={note}
        onChangeText={setNote}
        placeholder={t('roadReports.notePlaceholder')}
        placeholderTextColor={colors.faint}
        multiline
        maxLength={500}
        style={{
          borderWidth: 1, borderColor: colors.lineStrong, borderRadius: radius.sm,
          paddingHorizontal: spacing.md, paddingVertical: spacing.sm, fontSize: 13,
          color: colors.ink, backgroundColor: colors.canvas,
          minHeight: 60, textAlignVertical: 'top',
          fontFamily: ar ? fonts.arabic.regular : undefined,
        }}
      />

      <Button
        title={t('roadReports.submit')}
        busy={submitting}
        disabled={submitting || !reason}
        onPress={submit}
      />
    </Sheet>
  );
}
