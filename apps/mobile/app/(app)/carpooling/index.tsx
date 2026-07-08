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
import { useTranslation } from 'react-i18next';
import {
  AppText,
  Button,
  Card,
  Icon,
  PressableScale,
  Screen,
  ScreenHeader,
  SelectField,
} from '@/components/ui';
import { colors, radius, shadow, spacing } from '@/theme';
import { useAuth } from '@/lib/auth';
import { MAURITANIA_CITIES } from '@/lib/cities';
import {
  cancelCarpoolingTrip,
  listCarpoolingTrips,
  listMyCarpoolingTrips,
  revealTripContact,
  updateCarpoolingSeats,
  type CarpoolingTrip,
} from '@/lib/carpooling';

type TfagMode = 'passenger' | 'driver';

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

export default function CarpoolingScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const user = useAuth((s) => s.user);
  const isCaptain = user?.role === 'captain';
  const [mode, setMode] = useState<TfagMode>(isCaptain ? 'driver' : 'passenger');

  return (
    <>
      <Screen scroll>
        <ScreenHeader title={t('carpooling.title')} onBack={() => router.back()} />

        {isCaptain && (
          <View style={{
            flexDirection: 'row',
            backgroundColor: colors.sunken,
            borderRadius: radius.pill,
            padding: 4,
            gap: 4,
            marginBottom: spacing.lg,
          }}>
            <ToggleSegment
              label={t('carpooling.toggle.passenger')}
              icon="person"
              active={mode === 'passenger'}
              onPress={() => setMode('passenger')}
            />
            <ToggleSegment
              label={t('carpooling.toggle.driver')}
              icon="captain"
              active={mode === 'driver'}
              onPress={() => setMode('driver')}
            />
          </View>
        )}

        {mode === 'passenger' ? <PassengerView /> : <DriverView />}
      </Screen>

      {mode === 'driver' && isCaptain && (
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
          <AppText variant="bodyStrong" color={colors.onEmber}>{t('carpooling.publishFab')}</AppText>
        </Pressable>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  Toggle segment                                                     */
/* ------------------------------------------------------------------ */

function ToggleSegment({ label, icon, active, onPress }: {
  label: string; icon: 'person' | 'captain'; active: boolean; onPress: () => void;
}) {
  return (
    <PressableScale
      onPress={onPress}
      scaleTo={0.97}
      style={{
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: spacing.sm,
        paddingVertical: 10,
        borderRadius: radius.pill,
        backgroundColor: active ? colors.ember : 'transparent',
        ...(active ? shadow.ember : {}),
      }}
    >
      <Icon name={icon} size={17} color={active ? colors.onEmber : colors.muted} />
      <AppText variant="label" color={active ? colors.onEmber : colors.ink2}>{label}</AppText>
    </PressableScale>
  );
}

/* ------------------------------------------------------------------ */
/*  Passenger view — browse & filter trips from others                 */
/* ------------------------------------------------------------------ */

function PassengerView() {
  const { t } = useTranslation();
  const cityOptions = useMemo(
    () => MAURITANIA_CITIES.map((city) => ({ label: city, value: city })),
    [],
  );

  const [origin, setOrigin] = useState('');
  const [destination, setDestination] = useState('');
  const [filtersVisible, setFiltersVisible] = useState(false);
  const [loading, setLoading] = useState(false);
  const [trips, setTrips] = useState<CarpoolingTrip[]>([]);
  const [contactBusyId, setContactBusyId] = useState<string | null>(null);
  const [contact, setContact] = useState<ContactModalState>({
    visible: false,
    trip: null,
    driverName: '',
    driverPhone: '',
  });

  const hasFilters = !!(origin || destination);

  const loadTrips = useCallback(async () => {
    setLoading(true);
    try {
      const list = await listCarpoolingTrips({
        origin: origin || undefined,
        destination: destination || undefined,
      });
      setTrips(list);
    } catch (e: any) {
      const msg = e?.response?.data?.error?.message ?? t('carpooling.passenger.errLoad');
      Alert.alert(t('carpooling.errTitle'), msg);
    } finally {
      setLoading(false);
    }
  }, [origin, destination, t]);

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
      const msg = e?.response?.data?.error?.message ?? t('carpooling.passenger.errContact');
      Alert.alert(t('carpooling.errTitle'), msg);
    } finally {
      setContactBusyId(null);
    }
  }

  function clearFilters() {
    setOrigin('');
    setDestination('');
  }

  return (
    <>
      {/* Filter bar */}
      <View style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: spacing.md,
      }}>
        <AppText variant="h2">{t('carpooling.passenger.available')}</AppText>
        <Pressable
          onPress={() => setFiltersVisible((v) => !v)}
          hitSlop={10}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 6,
            backgroundColor: hasFilters ? colors.emberSoft : colors.surface,
            borderRadius: radius.pill,
            paddingHorizontal: 14,
            paddingVertical: 8,
          }}
        >
          <Icon name="tune" size={18} color={hasFilters ? colors.ember : colors.ink2} />
          {hasFilters && (
            <AppText variant="caption" color={colors.ember}>{t('carpooling.passenger.filters')}</AppText>
          )}
        </Pressable>
      </View>

      {filtersVisible && (
        <Card padding={spacing.base} style={{ marginBottom: spacing.md, gap: spacing.md }}>
          <SelectField
            label={t('carpooling.passenger.originLabel')}
            value={origin}
            onChange={(v) => { setOrigin(v); }}
            options={cityOptions}
            placeholder={t('carpooling.passenger.originPlaceholder')}
            modalTitle={t('carpooling.passenger.originLabel')}
            searchable
            searchPlaceholder={t('carpooling.passenger.searchCityPlaceholder')}
          />
          <SelectField
            label={t('carpooling.passenger.destLabel')}
            value={destination}
            onChange={(v) => { setDestination(v); }}
            options={cityOptions}
            placeholder={t('carpooling.passenger.destPlaceholder')}
            modalTitle={t('carpooling.passenger.destLabel')}
            searchable
            searchPlaceholder={t('carpooling.passenger.searchCityPlaceholder')}
          />
          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            <Button title={t('carpooling.passenger.searchBtn')} icon="search" size="md" onPress={loadTrips} />
            {hasFilters && (
              <Button title={t('carpooling.passenger.clearBtn')} variant="secondary" size="md" onPress={clearFilters} />
            )}
          </View>
        </Card>
      )}

      {/* Trip list */}
      <View style={{ gap: spacing.md, marginBottom: spacing.xxl }}>
        {trips.length === 0 ? (
          <Card padding={spacing.lg}>
            <AppText variant="body" color={colors.ink2}>{t('carpooling.passenger.empty')}</AppText>
          </Card>
        ) : (
          trips.map((trip) => (
            <Card key={trip.id} padding={spacing.base} style={{ gap: spacing.sm }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md }}>
                <View style={{ flex: 1 }}>
                  <AppText variant="title">{trip.originCity}{' → '}{trip.destinationCity}</AppText>
                  <AppText variant="caption" color={colors.ink2} style={{ marginTop: 4 }}>
                    {formatDateTime(trip.departureAt)}
                  </AppText>
                </View>
                {trip.isBoosted && (
                  <View style={{
                    alignSelf: 'flex-start',
                    backgroundColor: '#FEF3C7',
                    borderRadius: 999,
                    paddingHorizontal: 10,
                    paddingVertical: 4,
                  }}>
                    <AppText variant="caption" style={{ color: '#92400E' }}>⭐</AppText>
                  </View>
                )}
              </View>

              <AppText variant="body" color={colors.ink2}>
                {t('carpooling.passenger.seatsPrice', { avail: trip.availableSeats, total: trip.totalSeats, price: trip.pricePerSeatMru })}
              </AppText>
              <AppText variant="body" color={colors.ink2}>{t('carpooling.passenger.driverLabel', { name: trip.driverName })}</AppText>
              {trip.notes ? (
                <AppText variant="caption" color={colors.muted}>{trip.notes}</AppText>
              ) : null}

              <Button
                title={t('carpooling.passenger.reserveBtn')}
                iconRight="arrow"
                size="md"
                onPress={() => onReserve(trip)}
                busy={contactBusyId === trip.id}
              />
            </Card>
          ))
        )}
      </View>

      {/* Contact modal */}
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
            <AppText variant="h2">{t('carpooling.passenger.contact.title')}</AppText>
            <AppText variant="body" color={colors.ink2}>{contact.driverName}</AppText>
            <AppText variant="title" style={{ fontSize: 28 }}>{contact.driverPhone}</AppText>

            {contact.trip && (
              <View style={{ backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.base }}>
                <AppText variant="bodyStrong">{contact.trip.originCity}{' → '}{contact.trip.destinationCity}</AppText>
                <AppText variant="caption" color={colors.ink2}>
                  {t('carpooling.passenger.contact.tripMeta', { date: formatDateTime(contact.trip.departureAt), price: contact.trip.pricePerSeatMru })}
                </AppText>
              </View>
            )}

            <Button
              title={t('carpooling.passenger.contact.callBtn')}
              icon="phone"
              onPress={() => { void Linking.openURL(`tel:${contact.driverPhone}`); }}
            />
            <Button
              title={t('carpooling.passenger.contact.whatsappBtn')}
              icon="whatsapp"
              variant="secondary"
              onPress={() => {
                const wa = normalizePhoneForWa(contact.driverPhone);
                void Linking.openURL(`https://wa.me/${wa}`);
              }}
            />
            <Button
              title={t('carpooling.passenger.contact.closeBtn')}
              variant="ghost"
              onPress={() => setContact((s) => ({ ...s, visible: false }))}
            />
          </View>
        </View>
      </Modal>
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  Driver view — my trips + manage                                    */
/* ------------------------------------------------------------------ */

function DriverView() {
  const { t } = useTranslation();
  const [myTrips, setMyTrips] = useState<CarpoolingTrip[]>([]);
  const [loading, setLoading] = useState(false);

  const loadMyTrips = useCallback(async () => {
    setLoading(true);
    try {
      const list = await listMyCarpoolingTrips();
      setMyTrips(list);
    } catch {
      setMyTrips([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { loadMyTrips(); }, [loadMyTrips]));

  async function decrementSeat(trip: CarpoolingTrip) {
    if (!trip.availableSeats || trip.availableSeats <= 0) return;
    try {
      await updateCarpoolingSeats(trip.id, trip.availableSeats - 1);
      await loadMyTrips();
    } catch (e: any) {
      Alert.alert(t('carpooling.errTitle'), e?.response?.data?.error?.message ?? t('carpooling.driver.errUpdate'));
    }
  }

  async function cancelTrip(tripId: string) {
    try {
      await cancelCarpoolingTrip(tripId);
      await loadMyTrips();
    } catch (e: any) {
      Alert.alert(t('carpooling.errTitle'), e?.response?.data?.error?.message ?? t('carpooling.driver.errCancel'));
    }
  }

  return (
    <View style={{ gap: spacing.md, marginBottom: 100 }}>
      <AppText variant="h2">{t('carpooling.driver.myTrips')}</AppText>

      {myTrips.length === 0 ? (
        <Card padding={spacing.lg}>
          <AppText variant="body" color={colors.ink2}>{t('carpooling.driver.empty')}</AppText>
        </Card>
      ) : (
        myTrips.map((trip) => (
          <Card key={trip.id} padding={spacing.base} style={{ gap: spacing.sm }}>
            <AppText variant="title">{trip.originCity}{' → '}{trip.destinationCity}</AppText>
            <AppText variant="caption" color={colors.ink2}>
              {t('carpooling.driver.tripMeta', { date: formatDateTime(trip.departureAt), price: trip.pricePerSeatMru })}
            </AppText>
            <AppText variant="body" color={colors.ink2}>
              {t('carpooling.driver.seatsAndViews', { avail: trip.availableSeats, total: trip.totalSeats, views: trip.viewsCount ?? 0 })}
            </AppText>

            <View style={{ flexDirection: 'row', gap: spacing.sm }}>
              <Button
                title={t('carpooling.driver.decrementBtn')}
                size="sm"
                variant="secondary"
                onPress={() => decrementSeat(trip)}
                disabled={!trip.availableSeats || trip.availableSeats <= 0}
              />
              <Button
                title={t('carpooling.driver.cancelBtn')}
                size="sm"
                variant="danger"
                onPress={() => cancelTrip(trip.id)}
              />
            </View>
          </Card>
        ))
      )}
    </View>
  );
}
