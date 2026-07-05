import { useCallback, useMemo, useState } from 'react';
import { Alert, Pressable, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import {
  AppText,
  Button,
  Card,
  DateField,
  Screen,
  ScreenHeader,
  SelectField,
  TextField,
} from '@/components/ui';
import { colors, radius, spacing } from '@/theme';
import { useAuth } from '@/lib/auth';
import { MAURITANIA_CITIES } from '@/lib/cities';
import {
  cancelCarpoolingTrip,
  listMyCarpoolingTrips,
  publishCarpoolingTrip,
  updateCarpoolingSeats,
  type CarpoolingTrip,
} from '@/lib/carpooling';

const PUBLICATION_FEE_MRU = 100;
const BOOST_FEE_MRU = 200;

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function CarpoolingPublishScreen() {
  const router = useRouter();
  const user = useAuth((s) => s.user);

  const cityOptions = useMemo(
    () => MAURITANIA_CITIES.map((city) => ({ label: city, value: city })),
    [],
  );

  const [origin, setOrigin] = useState('');
  const [destination, setDestination] = useState('');
  const [dateIso, setDateIso] = useState('');
  const [timeValue, setTimeValue] = useState('08:00');
  const [totalSeats, setTotalSeats] = useState(3);
  const [pricePerSeat, setPricePerSeat] = useState('1500');
  const [driverPhone, setDriverPhone] = useState(user?.phone ?? '');
  const [notes, setNotes] = useState('');
  const [boost, setBoost] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [myTrips, setMyTrips] = useState<CarpoolingTrip[]>([]);
  const [loadingTrips, setLoadingTrips] = useState(false);

  const feeMru = boost ? PUBLICATION_FEE_MRU + BOOST_FEE_MRU : PUBLICATION_FEE_MRU;

  const loadMyTrips = useCallback(async () => {
    if (user?.role !== 'captain') return;
    setLoadingTrips(true);
    try {
      const list = await listMyCarpoolingTrips();
      setMyTrips(list);
    } catch {
      setMyTrips([]);
    } finally {
      setLoadingTrips(false);
    }
  }, [user?.role]);

  useFocusEffect(useCallback(() => { loadMyTrips(); }, [loadMyTrips]));

  function parseDepartureAt(): string | null {
    if (!dateIso) return null;
    if (!/^\d{2}:\d{2}$/.test(timeValue)) return null;
    const d = new Date(`${dateIso}T${timeValue}:00`);
    if (Number.isNaN(d.getTime())) return null;
    return d.toISOString();
  }

  async function onPublish() {
    if (user?.role !== 'captain') {
      Alert.alert('Acces refuse', 'Seuls les chauffeurs peuvent publier un trajet.');
      return;
    }
    if (!origin || !destination) {
      Alert.alert('Champs obligatoires', 'Veuillez choisir la ville de depart et la destination.');
      return;
    }
    if (origin === destination) {
      Alert.alert('Trajet invalide', 'Le depart et la destination doivent etre differents.');
      return;
    }
    const departureAt = parseDepartureAt();
    if (!departureAt) {
      Alert.alert('Date/heure invalide', 'Veuillez saisir une date et une heure valides.');
      return;
    }
    const price = parseInt(pricePerSeat, 10);
    if (!Number.isInteger(price) || price <= 0) {
      Alert.alert('Prix invalide', 'Le prix par place doit etre superieur a 0.');
      return;
    }

    setPublishing(true);
    try {
      await publishCarpoolingTrip({
        origin_city: origin,
        destination_city: destination,
        departure_at: departureAt,
        total_seats: totalSeats,
        price_per_seat_mru: price,
        driver_phone: driverPhone.trim() || undefined,
        notes: notes.trim() || undefined,
        boost,
      });
      Alert.alert('Succes', 'Trajet publie !');
      setNotes('');
      setBoost(false);
      setDateIso('');
      await loadMyTrips();
      router.replace('/(app)/carpooling');
    } catch (e: any) {
      if (e?.response?.status === 402) {
        Alert.alert(
          'Solde insuffisant',
          'Votre wallet ne contient pas assez de solde pour publier ce trajet.',
          [
            { text: 'Fermer', style: 'cancel' },
            { text: 'Recharger mon wallet', onPress: () => router.push('/(app)/captain/wallet') },
          ],
        );
      } else {
        const msg = e?.response?.data?.error?.message ?? 'Publication impossible';
        Alert.alert('Erreur', msg);
      }
    } finally {
      setPublishing(false);
    }
  }

  async function decrementSeat(trip: CarpoolingTrip) {
    if (!trip.availableSeats || trip.availableSeats <= 0) return;
    try {
      await updateCarpoolingSeats(trip.id, trip.availableSeats - 1);
      await loadMyTrips();
    } catch (e: any) {
      Alert.alert('Erreur', e?.response?.data?.error?.message ?? 'Mise a jour impossible');
    }
  }

  async function cancelTrip(tripId: string) {
    try {
      await cancelCarpoolingTrip(tripId);
      await loadMyTrips();
    } catch (e: any) {
      Alert.alert('Erreur', e?.response?.data?.error?.message ?? 'Annulation impossible');
    }
  }

  return (
    <Screen scroll onRefresh={loadMyTrips} refreshing={loadingTrips}>
      <ScreenHeader title="Publier un trajet" onBack={() => router.back()} />

      {user?.role !== 'captain' ? (
        <Card padding={spacing.lg}>
          <AppText variant="body" color={colors.ink2}>
            Cette fonctionnalite est reservee aux chauffeurs.
          </AppText>
        </Card>
      ) : (
        <View style={{ gap: spacing.md }}>
          <Card padding={spacing.base} style={{ gap: spacing.md }}>
            <SelectField
              label="Ville de depart"
              value={origin}
              onChange={setOrigin}
              options={cityOptions}
              placeholder="Choisir"
              modalTitle="Ville de depart"
              searchable
              searchPlaceholder="Rechercher une ville"
            />
            <SelectField
              label="Ville d'arrivee"
              value={destination}
              onChange={setDestination}
              options={cityOptions}
              placeholder="Choisir"
              modalTitle="Ville d'arrivee"
              searchable
              searchPlaceholder="Rechercher une ville"
            />
            <DateField
              label="Date de depart"
              value={dateIso}
              onChange={setDateIso}
              placeholder="Choisir une date"
              modalTitle="Date de depart"
              cancelLabel="Annuler"
              confirmLabel="Valider"
            />
            <TextField
              label="Heure de depart (HH:MM)"
              value={timeValue}
              onChangeText={setTimeValue}
              placeholder="08:00"
              icon="clock"
              autoCapitalize="none"
            />

            <View>
              <AppText variant="label" color={colors.ink2} style={{ marginBottom: spacing.sm }}>
                Nombre de places
              </AppText>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                <Pressable
                  onPress={() => setTotalSeats((s) => Math.max(1, s - 1))}
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: radius.md,
                    backgroundColor: colors.surface,
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderWidth: 1,
                    borderColor: colors.line,
                  }}
                >
                  <AppText variant="title">-</AppText>
                </Pressable>
                <View style={{ paddingHorizontal: spacing.md }}>
                  <AppText variant="h2">{totalSeats}</AppText>
                </View>
                <Pressable
                  onPress={() => setTotalSeats((s) => Math.min(8, s + 1))}
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: radius.md,
                    backgroundColor: colors.surface,
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderWidth: 1,
                    borderColor: colors.line,
                  }}
                >
                  <AppText variant="title">+</AppText>
                </Pressable>
              </View>
            </View>

            <TextField
              label="Prix par place (MRU)"
              value={pricePerSeat}
              onChangeText={setPricePerSeat}
              keyboardType="number-pad"
              icon="cash"
            />
            <TextField
              label="Telephone"
              value={driverPhone}
              onChangeText={setDriverPhone}
              keyboardType="phone-pad"
              icon="phone"
            />
            <TextField
              label="Notes (optionnel)"
              value={notes}
              onChangeText={setNotes}
              placeholder="Bagages, heure limite, point de rdv..."
              icon="document"
            />

            <Pressable
              onPress={() => setBoost((v) => !v)}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                borderWidth: 1,
                borderColor: boost ? '#F59E0B' : colors.line,
                borderRadius: radius.md,
                padding: spacing.base,
                backgroundColor: boost ? '#FFFBEB' : colors.surface,
              }}
            >
              <View style={{ flex: 1, paddingRight: spacing.md }}>
                <AppText variant="bodyStrong">Mettre en avant (+{BOOST_FEE_MRU} MRU)</AppText>
                <AppText variant="caption" color={colors.ink2}>
                  Le trajet apparait en premier pendant 24h.
                </AppText>
              </View>
              <View style={{
                width: 24,
                height: 24,
                borderRadius: 12,
                borderWidth: 2,
                borderColor: boost ? '#D97706' : colors.lineStrong,
                backgroundColor: boost ? '#F59E0B' : 'transparent',
              }} />
            </Pressable>

            <View style={{ borderRadius: radius.md, backgroundColor: '#F0F9FF', padding: spacing.base }}>
              <AppText variant="bodyStrong">Frais de publication: {feeMru} MRU</AppText>
            </View>

            <Button title="Payer et publier" icon="wallet" onPress={onPublish} busy={publishing} />
          </Card>

          <Card padding={spacing.base} style={{ gap: spacing.sm, marginBottom: spacing.xxl }}>
            <AppText variant="h2">Mes trajets</AppText>
            {myTrips.length === 0 ? (
              <AppText variant="body" color={colors.ink2}>Aucune publication pour le moment.</AppText>
            ) : (
              myTrips.map((trip) => (
                <View
                  key={trip.id}
                  style={{
                    borderWidth: 1,
                    borderColor: colors.line,
                    borderRadius: radius.md,
                    padding: spacing.base,
                    gap: spacing.sm,
                  }}
                >
                  <AppText variant="bodyStrong">{trip.originCity}{' -> '}{trip.destinationCity}</AppText>
                  <AppText variant="caption" color={colors.ink2}>
                    {formatDateTime(trip.departureAt)} - {trip.pricePerSeatMru} MRU/place
                  </AppText>
                  <AppText variant="caption" color={colors.ink2}>
                    {trip.availableSeats}/{trip.totalSeats} place(s) - {trip.viewsCount ?? 0} personnes ont vu votre numero
                  </AppText>
                  <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                    <Button
                      title="-1 place"
                      size="sm"
                      variant="secondary"
                      onPress={() => decrementSeat(trip)}
                      disabled={!trip.availableSeats || trip.availableSeats <= 0}
                    />
                    <Button
                      title="Annuler"
                      size="sm"
                      variant="danger"
                      onPress={() => cancelTrip(trip.id)}
                    />
                  </View>
                </View>
              ))
            )}
          </Card>
        </View>
      )}
    </Screen>
  );
}
