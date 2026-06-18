import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, View } from 'react-native';
import { useRouter } from 'expo-router';
import { api } from '@/lib/api';
import { formatMru } from '@/lib/format';
import { AppText, Button, Card, Icon, Screen, ScreenHeader } from '@/components/ui';
import { colors, radius, spacing } from '@/theme';

type RecurringStatus = 'proposed' | 'active' | 'paused' | 'cancelled' | 'expired';

interface Recurring {
  id: string;
  riderId: string;
  captainId: string | null;
  pickup: { lat: number; lng: number; label: string | null };
  dropoff: { lat: number; lng: number; label: string | null };
  daysOfWeek: number; // bitmap, bit 0 = Mon
  timeOfDay: string;  // HH:MM:SS
  timezone: string;
  lockedFareMru: number;
  status: RecurringStatus;
  validFrom: string;
  validUntil: string | null;
}

const DAY_LABELS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];

function decodeDays(bitmap: number): string {
  return DAY_LABELS.filter((_, i) => bitmap & (1 << i)).join(', ');
}

export default function RecurringScreen() {
  const router = useRouter();
  const [items, setItems] = useState<Recurring[]>([]);
  const [loading, setLoading] = useState(true);
  const [accepting, setAccepting] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await api.get<Recurring[]>('/captain/recurring-rides');
      setItems(r.data);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function accept(id: string) {
    setAccepting(id);
    try {
      await api.post(`/captain/recurring-rides/${id}/accept`);
      await load();
      Alert.alert('Engagement accepté', 'Vous êtes locked-in sur ce trajet.');
    } catch (e: any) {
      Alert.alert('Impossible', e.response?.data?.error?.message ?? 'Échec.');
    } finally {
      setAccepting(null);
    }
  }

  const proposed = items.filter((i) => i.status === 'proposed');
  const mine = items.filter((i) => i.status === 'active');

  return (
    <Screen scroll onRefresh={load} refreshing={loading}>
      <ScreenHeader title="Courses récurrentes" onBack={() => router.back()} />
      <AppText variant="body" color={colors.ink2}>
        Des passagers proposent des trajets réguliers. Acceptez-en un et le tarif est verrouillé.
      </AppText>

      <Section title="Mes engagements">
        {mine.length === 0 ? (
          <Empty text="Aucun trajet récurrent actif." />
        ) : mine.map((it) => (
          <Row key={it.id} item={it}>
            <View style={{
              flexDirection: 'row', alignItems: 'center', gap: 4,
              backgroundColor: colors.successSoft, paddingHorizontal: 10, paddingVertical: 5, borderRadius: radius.pill,
            }}>
              <Icon name="checkSmall" size={13} color={colors.success} />
              <AppText variant="overline" color={colors.success}>Locké</AppText>
            </View>
          </Row>
        ))}
      </Section>

      <Section title="Propositions">
        {loading && proposed.length === 0 ? (
          <View style={{ marginTop: spacing.md, alignItems: 'center' }}><ActivityIndicator color={colors.ember} /></View>
        ) : proposed.length === 0 ? (
          <Empty text="Aucune proposition pour le moment." />
        ) : proposed.map((it) => (
          <Row key={it.id} item={it}>
            <Button
              title="Accepter"
              size="sm"
              fullWidth={false}
              busy={accepting === it.id}
              onPress={() => accept(it.id)}
            />
          </Row>
        ))}
      </Section>
    </Screen>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={{ marginTop: spacing.xxl }}>
      <AppText variant="overline" color={colors.muted} style={{ marginBottom: spacing.xs }}>{title}</AppText>
      {children}
    </View>
  );
}

function Empty({ text }: { text: string }) {
  return <AppText variant="body" color={colors.muted} style={{ marginTop: spacing.sm }}>{text}</AppText>;
}

function Row({ item, children }: { item: Recurring; children: React.ReactNode }) {
  return (
    <Card padding={spacing.base} style={{ marginTop: spacing.md }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 }}>
          <Icon name="calendar" size={16} color={colors.ember} />
          <AppText variant="bodyStrong" numberOfLines={1}>
            {decodeDays(item.daysOfWeek)} · {item.timeOfDay.slice(0, 5)}
          </AppText>
        </View>
        {children}
      </View>

      <View style={{ marginTop: spacing.md }}>
        <AppText variant="caption" color={colors.muted}>De</AppText>
        <AppText variant="body" color={colors.ink} numberOfLines={1}>
          {item.pickup.label ?? `${item.pickup.lat.toFixed(4)}, ${item.pickup.lng.toFixed(4)}`}
        </AppText>
        <AppText variant="caption" color={colors.muted} style={{ marginTop: spacing.sm }}>Vers</AppText>
        <AppText variant="body" color={colors.ink} numberOfLines={1}>
          {item.dropoff.label ?? `${item.dropoff.lat.toFixed(4)}, ${item.dropoff.lng.toFixed(4)}`}
        </AppText>
      </View>

      <View style={{
        marginTop: spacing.md, paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.line,
        flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
      }}>
        <AppText variant="caption" color={colors.ink2}>Tarif verrouillé</AppText>
        <AppText variant="title">{formatMru(item.lockedFareMru)}</AppText>
      </View>
    </Card>
  );
}
