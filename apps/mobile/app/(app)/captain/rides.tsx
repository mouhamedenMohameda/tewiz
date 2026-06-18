import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator, Alert, Linking, Pressable, TextInput, View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { api } from '@/lib/api';
import { formatMru } from '@/lib/format';
import { usePolling } from '@/lib/usePolling';
import {
  AppText, Button, Card, Icon, PressableScale, Screen, ScreenHeader, type IconName,
} from '@/components/ui';
import { colors, radius, spacing } from '@/theme';

// Note: the new-ride alert (modal + ringing) is handled globally by
// <CaptainRideWatcher /> mounted in the captain layout, so this screen
// is purely a "browse inbox + drive the current ride" view.

type RideStatus =
  | 'pending_passenger_confirm' | 'searching'
  | 'accepted' | 'arrived' | 'in_progress'
  | 'completed' | 'cancelled_by_rider' | 'cancelled_by_captain'
  | 'cancelled_by_system' | 'no_show';

type RideType = 'passenger' | 'colis';

interface InboxItem {
  id: string;
  rideType: RideType;
  isForOther: boolean;
  pickup: { lat: number; lng: number; label: string | null };
  dropoff: { lat: number; lng: number; label: string | null };
  fareEstimateMru: number | null;
  distanceM: number | null;
  distanceToPickupM: number;
  isFavorite: boolean;
  homewardProgressM: number | null;
  requestedAt: string;
}

interface Ride {
  id: string;
  rideType: RideType;
  status: RideStatus;
  passengerName: string | null;
  passengerPhone: string | null;
  // The person to call at pickup (booker, or the third party for a "course pour
  // quelqu'un d'autre"). Attached by the API once the captain is assigned.
  rider?: { id: string; fullName: string | null; phone: string | null } | null;
  isForOther: boolean;
  pickup: { lat: number; lng: number; label: string | null };
  dropoff: { lat: number; lng: number; label: string | null };
  fareEstimateMru: number | null;
  fareFinalMru: number | null;
  commissionMru: number | null;
  paymentMethod: 'cash' | 'wallet';
}

export default function RidesScreen() {
  const router = useRouter();
  const [current, setCurrent] = useState<Ride | null>(null);
  const [inbox, setInbox] = useState<InboxItem[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const curRes = await api.get<Ride>('/captain/rides/current', {
        validateStatus: (s) => s === 200 || s === 204,
      });
      if (curRes.status === 204) {
        setCurrent(null);
        try {
          const inb = await api.get<InboxItem[]>('/captain/rides/inbox');
          setInbox(inb.data);
        } catch (e: any) {
          if (e.response?.status === 400) {
            setInbox([]); // captain has no known location yet
          } else {
            throw e;
          }
        }
      } else {
        setCurrent(curRes.data);
        setInbox([]);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Auto-refresh while the screen is focused:
  // - waiting for a ride: poll every 5 s so new requests pop in quickly
  // - on a ride: poll every 8 s for status changes (rider cancels, etc.)
  usePolling(load, current ? 8_000 : 5_000);

  return (
    <Screen scroll onRefresh={load} refreshing={loading}>
      <ScreenHeader title="Courses" onBack={() => router.back()} />
      {current ? (
        <CurrentRideCard ride={current} onChanged={load} />
      ) : (
        <InboxList items={inbox} onAccepted={load} />
      )}
    </Screen>
  );
}

function InboxList({ items, onAccepted }: { items: InboxItem[]; onAccepted: () => void }) {
  const [accepting, setAccepting] = useState<string | null>(null);

  async function accept(id: string) {
    setAccepting(id);
    try {
      await api.post(`/captain/rides/${id}/accept`);
      onAccepted();
    } catch (e: any) {
      Alert.alert('Impossible', e.response?.data?.error?.message ?? 'Échec.');
    } finally {
      setAccepting(null);
    }
  }

  return (
    <View>
      <AppText variant="h1">Courses proches</AppText>
      <AppText variant="caption" color={colors.ink2} style={{ marginTop: spacing.xs }}>
        Vous devez être en ligne avec votre position partagée.
      </AppText>

      {items.length === 0 ? (
        <Card elevation="none" background={colors.surfaceAlt} padding={spacing.xxl}
          style={{ marginTop: spacing.lg, alignItems: 'center', gap: spacing.sm }}>
          <Icon name="clock" size={30} color={colors.muted} />
          <AppText variant="body" color={colors.muted}>Aucune course pour le moment.</AppText>
        </Card>
      ) : items.map((it) => {
        const accent = it.isFavorite ? colors.sun : (it.rideType === 'colis' ? colors.espresso : colors.ember);
        const isColis = it.rideType === 'colis';
        return (
          <Card key={it.id} padding={0} style={{ marginTop: spacing.md, overflow: 'hidden' }}>
            <View style={{ flexDirection: 'row' }}>
              <View style={{ width: 5, backgroundColor: accent }} />
              <View style={{ flex: 1, padding: spacing.base }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    <Chip icon={isColis ? 'parcel' : 'ride'} label={isColis ? 'Colis' : 'Passager'}
                      bg={isColis ? colors.espresso : colors.emberSoft}
                      fg={isColis ? colors.saffron : colors.ember} />
                    {it.isFavorite ? <Chip icon="star" label="Favori" bg={colors.saffronSoft} fg={colors.warning} /> : null}
                    {it.homewardProgressM && it.homewardProgressM > 0
                      ? <Chip icon="home" label="Rapproche" bg={colors.successSoft} fg={colors.success} /> : null}
                  </View>
                  <AppText variant="caption" color={colors.muted}>
                    {(it.distanceToPickupM / 1000).toFixed(1)} km
                  </AppText>
                </View>

                <Route pickup={it.pickup.label} dropoff={it.dropoff.label} style={{ marginTop: spacing.md }} />

                <View style={{ marginTop: spacing.base, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <AppText variant="h2">
                    {it.fareEstimateMru ? formatMru(it.fareEstimateMru) : '—'}
                  </AppText>
                  <Button
                    title="Accepter"
                    size="md"
                    fullWidth={false}
                    icon="checkSmall"
                    busy={accepting === it.id}
                    onPress={() => accept(it.id)}
                  />
                </View>
              </View>
            </View>
          </Card>
        );
      })}
    </View>
  );
}

function CurrentRideCard({ ride, onChanged }: { ride: Ride; onChanged: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [code, setCode] = useState('');

  async function action(label: string, fn: () => Promise<void>) {
    setBusy(label);
    try { await fn(); await onChanged(); }
    catch (e: any) {
      Alert.alert('Impossible', e.response?.data?.error?.message ?? 'Échec.');
    } finally { setBusy(null); }
  }

  function arrive() {
    return action('arrive', async () => {
      await api.post(`/captain/rides/${ride.id}/arrive`);
    });
  }

  function start() {
    if (!/^\d{4}$/.test(code)) {
      Alert.alert('Code requis', 'Demandez au passager le code à 4 chiffres.');
      return Promise.resolve();
    }
    return action('start', async () => {
      await api.post(`/captain/rides/${ride.id}/start`, { code });
      setCode('');
    });
  }

  async function complete() {
    const body: any = {};
    if (ride.rideType === 'colis') {
      if (!/^\d{4}$/.test(code)) {
        Alert.alert('Code livraison', 'Demandez au destinataire le code reçu par SMS.');
        return;
      }
      body.dropOtp = code;
    }
    // Optional GPS-based actual distance/duration could be added later.
    return action('complete', async () => {
      await api.post(`/captain/rides/${ride.id}/complete`, body);
      setCode('');
    });
  }

  async function cancel() {
    Alert.alert(
      'Annuler la course ?',
      'Cela impacte votre score.',
      [
        { text: 'Non', style: 'cancel' },
        {
          text: 'Annuler', style: 'destructive',
          onPress: () => action('cancel', async () => {
            await api.post(`/captain/rides/${ride.id}/cancel`, { reason: 'captain_cancel' });
          }),
        },
      ],
    );
  }

  const stepLabel: Partial<Record<RideStatus, string>> = {
    accepted: 'Acceptée — en route vers le client',
    arrived: 'Arrivé sur place',
    in_progress: 'Course en cours',
  };

  return (
    <View>
      <Card background={colors.espresso} elevation="raised" padding={spacing.xl}>
        <AppText variant="overline" color={colors.saffron}>
          {stepLabel[ride.status] ?? ride.status}
        </AppText>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.sm }}>
          <Icon name={ride.rideType === 'colis' ? 'parcel' : 'person'} size={24} color={colors.onEspresso} />
          <AppText variant="h1" color={colors.onEspresso}>
            {ride.rideType === 'colis' ? 'Colis' : (ride.rider?.fullName ?? ride.passengerName ?? 'Passager')}
          </AppText>
        </View>

        {(() => {
          const contactPhone = ride.rider?.phone ?? ride.passengerPhone;
          if (!contactPhone) return null;
          return (
            <View style={{ marginTop: spacing.md, flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
              <AppText variant="body" color={colors.onEspressoMuted} style={{ flex: 1 }}>
                {contactPhone}{ride.isForOther ? ' · pour un tiers' : ''}
              </AppText>
              <PressableScale
                onPress={() => Linking.openURL(`tel:${contactPhone}`)}
                style={{
                  backgroundColor: colors.ember, paddingHorizontal: 16, paddingVertical: 9,
                  borderRadius: radius.pill, flexDirection: 'row', alignItems: 'center', gap: 6,
                }}
              >
                <Icon name="phone" size={16} color={colors.onEmber} />
                <AppText variant="label" color={colors.onEmber}>Appeler</AppText>
              </PressableScale>
            </View>
          );
        })()}

        <Route
          pickup={ride.pickup.label}
          dropoff={ride.dropoff.label}
          onDark
          style={{ marginTop: spacing.lg }}
        />

        <View style={{ marginTop: spacing.lg, flexDirection: 'row', justifyContent: 'space-between' }}>
          <View>
            <AppText variant="caption" color={colors.onEspressoMuted}>Tarif estimé</AppText>
            <AppText variant="h2" color={colors.onEspresso} style={{ marginTop: 2 }}>
              {ride.fareEstimateMru ? formatMru(ride.fareEstimateMru) : '—'}
            </AppText>
          </View>
          <View>
            <AppText variant="caption" color={colors.onEspressoMuted}>Paiement</AppText>
            <AppText variant="h2" color={colors.onEspresso} style={{ marginTop: 2 }}>
              {ride.paymentMethod === 'cash' ? 'Espèces' : 'Wallet'}
            </AppText>
          </View>
        </View>
      </Card>

      {/* Step controls */}
      {ride.status === 'accepted' ? (
        <Button title="Je suis arrivé" icon="pin" onPress={arrive} busy={busy === 'arrive'}
          style={{ marginTop: spacing.base }} />
      ) : null}

      {ride.status === 'arrived' ? (
        <CodeBox
          title={ride.rideType === 'colis' ? 'Code expéditeur (4 chiffres)' : 'Code passager (4 chiffres)'}
          subtitle={ride.rideType === 'colis'
            ? 'Demandez le code à l\'expéditeur du colis avant de démarrer.'
            : 'Demandez le code anti-arnaque au passager avant de démarrer.'}
          code={code}
          onChange={setCode}
          actionLabel={ride.rideType === 'colis' ? 'Démarrer la livraison' : 'Démarrer la course'}
          onAction={start}
          busy={busy === 'start'}
        />
      ) : null}

      {ride.status === 'in_progress' && ride.rideType === 'passenger' ? (
        <Button title="Terminer la course" icon="check" onPress={complete} busy={busy === 'complete'}
          style={{ marginTop: spacing.base }} />
      ) : null}

      {ride.status === 'in_progress' && ride.rideType === 'colis' ? (
        <CodeBox
          title="Code livraison (4 chiffres)"
          subtitle="Demandez au destinataire le code reçu par SMS."
          code={code}
          onChange={setCode}
          actionLabel="Confirmer la livraison"
          onAction={complete}
          busy={busy === 'complete'}
        />
      ) : null}

      <Button
        title="Annuler la course"
        variant="danger"
        onPress={cancel}
        style={{ marginTop: spacing.md }}
      />
    </View>
  );
}

/* ------------------------------------------------------------------ */

function Chip({ icon, label, bg, fg }: { icon: IconName; label: string; bg: string; fg: string }) {
  return (
    <View style={{
      flexDirection: 'row', alignItems: 'center', gap: 4,
      backgroundColor: bg, paddingHorizontal: 9, paddingVertical: 4, borderRadius: radius.pill,
    }}>
      <Icon name={icon} size={13} color={fg} />
      <AppText variant="overline" color={fg} style={{ letterSpacing: 0.4 }}>{label}</AppText>
    </View>
  );
}

function Route({
  pickup, dropoff, onDark, style,
}: {
  pickup: string | null; dropoff: string | null; onDark?: boolean; style?: any;
}) {
  const muted = onDark ? colors.onEspressoMuted : colors.muted;
  const strong = onDark ? colors.onEspresso : colors.ink;
  return (
    <View style={[{ flexDirection: 'row' }, style]}>
      {/* connector */}
      <View style={{ alignItems: 'center', marginRight: spacing.md, paddingTop: 4 }}>
        <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: colors.ember }} />
        <View style={{ width: 2, flex: 1, minHeight: 18, backgroundColor: onDark ? colors.espressoAlt : colors.line, marginVertical: 3 }} />
        <View style={{ width: 10, height: 10, borderRadius: 3, backgroundColor: colors.sun }} />
      </View>
      <View style={{ flex: 1 }}>
        <AppText variant="caption" color={muted}>De</AppText>
        <AppText variant="bodyStrong" color={strong} numberOfLines={1}>{pickup ?? 'Point de prise en charge'}</AppText>
        <AppText variant="caption" color={muted} style={{ marginTop: spacing.sm }}>Vers</AppText>
        <AppText variant="bodyStrong" color={strong} numberOfLines={1}>{dropoff ?? 'Destination'}</AppText>
      </View>
    </View>
  );
}

function CodeBox({
  title, subtitle, code, onChange, actionLabel, onAction, busy,
}: {
  title: string; subtitle: string;
  code: string; onChange: (v: string) => void;
  actionLabel: string; onAction: () => void; busy?: boolean;
}) {
  return (
    <Card padding={spacing.base} style={{ marginTop: spacing.base }}>
      <AppText variant="bodyStrong">{title}</AppText>
      <AppText variant="caption" color={colors.ink2} style={{ marginTop: 2 }}>{subtitle}</AppText>
      <TextInput
        value={code}
        onChangeText={(t) => onChange(t.replace(/\D/g, '').slice(0, 4))}
        keyboardType="number-pad"
        maxLength={4}
        placeholder="····"
        placeholderTextColor={colors.faint}
        style={{
          marginTop: spacing.md, borderWidth: 1.5, borderColor: colors.line, borderRadius: radius.md,
          paddingVertical: 16, fontSize: 26, color: colors.ink, backgroundColor: colors.sunken,
          textAlign: 'center', letterSpacing: 14, fontFamily: 'Sora_700Bold',
        }}
      />
      <Button title={actionLabel} onPress={onAction} busy={busy} style={{ marginTop: spacing.md }} />
    </Card>
  );
}
