import { useCallback, useMemo, useState } from 'react';
import {
  Alert,
  Modal,
  Platform,
  Pressable,
  View,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import * as Linking from 'expo-linking';
import {
  AppText,
  Button,
  Card,
  DateField,
  Screen,
  ScreenHeader,
  SelectField,
} from '@/components/ui';
import { colors, radius, shadow, spacing } from '@/theme';
import { MAURITANIA_CITIES } from '@/lib/cities';
import {
  listCarpoolingTrips,
  revealTripContact,
  type CarpoolingTrip,
} from '@/lib/carpooling';

interface ContactModalState {
  visible: boolean;
  trip: CarpoolingTrip | null;
  driverName: string;
  driverPhone: string;
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('fr-FR', {
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function normalizePhoneForWa(phone: string): string {
  const raw = phone.replace(/\D/g, '');
  if (raw.startsWith('222')) return raw;
  return `222${raw}`;
}

export default function CarpoolingListScreen() {
  const router = useRouter();
  const cityOptions = useMemo(
    () => MAURITANIA_CITIES.map((city) => ({ label: city, value: city })),
    [],
  );

  const [origin, setOrigin] = useState('');
  const [destination, setDestination] = useState('');
  const [dateIso, setDateIso] = useState('');
  const [loading, setLoading] = useState(false);
  const [trips, setTrips] = useState<CarpoolingTrip[]>([]);
  const [contactBusyId, setContactBusyId] = useState<string | null>(null);
  const [contact, setContact] = useState<ContactModalState>({
    visible: false,
    trip: null,
    driverName: '',
    driverPhone: '',
  });

  const loadTrips = useCallback(async () => {
    setLoading(true);
    try {
      const list = await listCarpoolingTrips({
        origin: origin || undefined,
        destination: destination || undefined,
        date: dateIso || undefined,
      });
      setTrips(list);
    } catch (e: any) {
      const msg = e?.response?.data?.error?.message ?? 'Impossible de charger les trajets';
      Alert.alert('Erreur', msg);
    } finally {
      setLoading(false);
    }
  }, [origin, destination, dateIso]);

  useFocusEffect(useCallback(() => { loadTrips(); }, [loadTrips]));

  async function onReserve(trip: CarpoolingTrip) {
    setContactBusyId(trip.id);
    try {
      const reveal = await revealTripContact(trip.id);
      setContact({
        visible: true,
        trip,
        driverName: reveal.driverName,
        driverPhone: reveal.driverPhone,
      });
    } catch (e: any) {
      const msg = e?.response?.data?.error?.message ?? 'Impossible de recuperer le numero';
      Alert.alert('Erreur', msg);
    } finally {
      setContactBusyId(null);
    }
  }

  return (
    <>
      <Screen scroll onRefresh={loadTrips} refreshing={loading}>
        <ScreenHeader title="Covoiturage" onBack={() => router.back()} />

        <Card padding={spacing.base} style={{ marginBottom: spacing.md }}>
          <View style={{ gap: spacing.md }}>
            <SelectField
              label="Ville de depart"
              value={origin}
              onChange={setOrigin}
              options={cityOptions}
              placeholder="Toutes"
              modalTitle="Choisir la ville de depart"
              searchable
              searchPlaceholder="Rechercher une ville"
            />
            <SelectField
              label="Ville d'arrivee"
              value={destination}
              onChange={setDestination}
              options={cityOptions}
              placeholder="Toutes"
              modalTitle="Choisir la ville d'arrivee"
              searchable
              searchPlaceholder="Rechercher une ville"
            />
            <DateField
              label="Date"
              value={dateIso}
              onChange={setDateIso}
              placeholder="Toute date"
              modalTitle="Choisir la date"
              cancelLabel="Annuler"
              confirmLabel="Valider"
            />
            <View style={{ flexDirection: 'row', gap: spacing.sm }}>
              <Button title="Rechercher" icon="search" size="md" onPress={loadTrips} />
              {dateIso || origin || destination ? (
                <Button
                  title="Vider"
                  variant="secondary"
                  size="md"
                  onPress={() => {
                    setOrigin('');
                    setDestination('');
                    setDateIso('');
                  }}
                />
              ) : null}
            </View>
          </View>
        </Card>

        <View style={{ gap: spacing.md, marginBottom: spacing.xxl }}>
          {trips.length === 0 ? (
            <Card padding={spacing.lg}>
              <AppText variant="body" color={colors.ink2}>Aucun trajet trouve.</AppText>
            </Card>
          ) : (
            trips.map((trip) => (
              <Card key={trip.id} padding={spacing.base} style={{ gap: spacing.sm }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md }}>
                  <View style={{ flex: 1 }}>
                    <AppText variant="title">{trip.originCity}{' -> '}{trip.destinationCity}</AppText>
                    <AppText variant="caption" color={colors.ink2} style={{ marginTop: 4 }}>
                      {formatDateTime(trip.departureAt)}
                    </AppText>
                  </View>
                  {trip.isBoosted ? (
                    <View style={{
                      alignSelf: 'flex-start',
                      backgroundColor: '#FEF3C7',
                      borderRadius: 999,
                      paddingHorizontal: 10,
                      paddingVertical: 4,
                    }}>
                      <AppText variant="caption" style={{ color: '#92400E' }}>En vedette</AppText>
                    </View>
                  ) : null}
                </View>

                <AppText variant="body" color={colors.ink2}>
                  Places: {trip.availableSeats}/{trip.totalSeats} - {trip.pricePerSeatMru} MRU/place
                </AppText>
                <AppText variant="body" color={colors.ink2}>Conducteur: {trip.driverName}</AppText>
                {trip.notes ? (
                  <AppText variant="caption" color={colors.muted}>{trip.notes}</AppText>
                ) : null}

                <Button
                  title="Reserver ->"
                  iconRight="arrow"
                  size="md"
                  onPress={() => onReserve(trip)}
                  busy={contactBusyId === trip.id}
                />
              </Card>
            ))
          )}
        </View>
      </Screen>

      <Pressable
        onPress={() => router.push('/(app)/carpooling/publish')}
        style={{
          position: 'absolute',
          right: spacing.lg,
          bottom: Platform.select({ ios: 36, android: 24, default: 24 }),
          backgroundColor: colors.ember,
          borderRadius: 999,
          paddingHorizontal: spacing.lg,
          paddingVertical: spacing.base,
          ...shadow.ember,
        }}
      >
        <AppText variant="bodyStrong" color={colors.onEmber}>+ Publier un trajet</AppText>
      </Pressable>

      <Modal
        visible={contact.visible}
        transparent
        animationType="fade"
        onRequestClose={() => setContact((s) => ({ ...s, visible: false }))}
      >
        <View style={{ flex: 1, backgroundColor: 'rgba(15,23,42,0.55)', justifyContent: 'center', padding: spacing.lg }}>
          <View style={{
            backgroundColor: colors.canvas,
            borderRadius: radius.xl,
            padding: spacing.lg,
            gap: spacing.base,
          }}>
            <AppText variant="h2">Contacter le conducteur</AppText>
            <AppText variant="body" color={colors.ink2}>{contact.driverName}</AppText>
            <AppText variant="title" style={{ fontSize: 28 }}>{contact.driverPhone}</AppText>

            {contact.trip ? (
              <View style={{ backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.base }}>
                <AppText variant="bodyStrong">{contact.trip.originCity}{' -> '}{contact.trip.destinationCity}</AppText>
                <AppText variant="caption" color={colors.ink2}>
                  {formatDateTime(contact.trip.departureAt)} - {contact.trip.pricePerSeatMru} MRU/place
                </AppText>
              </View>
            ) : null}

            <Button
              title="Appeler"
              icon="phone"
              onPress={() => {
                void Linking.openURL(`tel:${contact.driverPhone}`);
              }}
            />
            <Button
              title="WhatsApp"
              icon="whatsapp"
              variant="secondary"
              onPress={() => {
                const wa = normalizePhoneForWa(contact.driverPhone);
                void Linking.openURL(`https://wa.me/${wa}`);
              }}
            />
            <Button
              title="Fermer"
              variant="ghost"
              onPress={() => setContact((s) => ({ ...s, visible: false }))}
            />
          </View>
        </View>
      </Modal>
    </>
  );
}
