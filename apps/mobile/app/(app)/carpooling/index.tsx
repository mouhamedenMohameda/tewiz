import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Platform,
  Pressable,
  TextInput,
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
  Sheet,
} from '@/components/ui';
import { colors, fonts, radius, schemed, shadow, spacing, statusTone } from '@/theme';
import { currentLanguage, isRTL } from '@/lib/i18n';
import { useAuth } from '@/lib/auth';
import { MAURITANIA_CITIES } from '@/lib/cities';
import {
  acceptCarpoolingBooking,
  cancelCarpoolingBooking,
  cancelCarpoolingTrip,
  completeCarpoolingBooking,
  declineCarpoolingBooking,
  listCarpoolingTrips,
  listDriverCarpoolingBookings,
  listMyCarpoolingBookings,
  listMyCarpoolingTrips,
  noShowCarpoolingBooking,
  rateCarpoolingBooking,
  requestCarpoolingBooking,
  type CarpoolingBooking,
  type CarpoolingBookingStatus,
  type CarpoolingTrip,
} from '@/lib/carpooling';

type ErvdniMode = 'passenger' | 'driver';

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

function openCall(phone: string) {
  void Linking.openURL(`tel:${phone}`);
}

function openWhatsapp(phone: string) {
  void Linking.openURL(`https://wa.me/${normalizePhoneForWa(phone)}`);
}

// schemed(): a bare object literal here would freeze whichever
// palette was active when this module was first imported, and then
// never follow the user into dark mode.
const STATUS_TINT = schemed(() => ({
  requested: { bg: colors.saffronSoft, fg: colors.warning },
  accepted: { bg: statusTone.done.bg, fg: colors.success },
  completed: { bg: statusTone.done.bg, fg: colors.success },
  declined: { bg: colors.dangerSoft, fg: colors.danger },
  cancelled: { bg: colors.sunken, fg: colors.muted },
  no_show: { bg: colors.dangerSoft, fg: colors.danger },
  expired: { bg: colors.sunken, fg: colors.muted },
}));

function StatusBadge({ status }: { status: CarpoolingBookingStatus }) {
  const { t } = useTranslation();
  const tint = STATUS_TINT[status];
  return (
    <View style={{
      alignSelf: 'flex-start',
      backgroundColor: tint.bg,
      borderRadius: radius.pill,
      paddingHorizontal: 10,
      paddingVertical: 3,
    }}>
      <AppText variant="caption" style={{ color: tint.fg }}>
        {t(`carpooling.booking.status.${status}`)}
      </AppText>
    </View>
  );
}

function RatingBadge({ avg, count }: { avg?: number; count?: number }) {
  if (!count || count <= 0) return null;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
      <Icon name="star" size={14} color={colors.warning} />
      <AppText variant="caption" color={colors.ink2}>{(avg ?? 0).toFixed(1)} ({count})</AppText>
    </View>
  );
}

function RatingModal({ visible, name, busy, onSubmit, onClose }: {
  visible: boolean;
  name: string;
  busy: boolean;
  onSubmit: (stars: number, comment: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [stars, setStars] = useState(5);
  const [comment, setComment] = useState('');

  useEffect(() => {
    if (visible) { setStars(5); setComment(''); }
  }, [visible]);

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={t('carpooling.rate.title')}
      subtitle={t('carpooling.rate.prompt', { name })}
      dismissible={!busy}
      contentStyle={{ gap: spacing.base }}
    >
      <View style={{ flexDirection: 'row', gap: spacing.sm, justifyContent: 'center', paddingVertical: spacing.sm }}>
        {[1, 2, 3, 4, 5].map((n) => (
          <PressableScale key={n} onPress={() => setStars(n)} hitSlop={6} scaleTo={0.85} haptic>
            <Icon name="star" size={38} color={n <= stars ? colors.warning : colors.sunken} />
          </PressableScale>
        ))}
      </View>
      <TextInput
        value={comment}
        onChangeText={setComment}
        placeholder={t('carpooling.rate.commentPlaceholder')}
        placeholderTextColor={colors.muted}
        multiline
        style={{
          borderWidth: 1,
          borderColor: colors.sunken,
          borderRadius: radius.md,
          paddingHorizontal: spacing.base,
          paddingVertical: spacing.md,
          minHeight: 64,
          textAlignVertical: 'top',
          color: colors.ink,
          fontFamily: isRTL(currentLanguage()) ? fonts.arabic.regular : undefined,
        }}
      />
      <Button title={t('carpooling.rate.submitBtn')} icon="check" busy={busy} onPress={() => onSubmit(stars, comment)} />
      <Button title={t('carpooling.rate.cancelBtn')} variant="ghost" onPress={onClose} />
    </Sheet>
  );
}

export default function CarpoolingScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const user = useAuth((s) => s.user);
  const isCaptain = user?.role === 'captain';
  // Everyone lands on the passenger (booking) view — booking is open to all.
  // Only a registered captain sees the 'Captain' tab to publish & manage.
  const [mode, setMode] = useState<ErvdniMode>('passenger');

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
            borderRadius: radius.pill,
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
/*  Passenger view — browse trips, request a seat, track my bookings   */
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
  const [trips, setTrips] = useState<CarpoolingTrip[]>([]);
  const [bookings, setBookings] = useState<CarpoolingBooking[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rateFor, setRateFor] = useState<CarpoolingBooking | null>(null);
  const [rating, setRating] = useState(false);

  const hasFilters = !!(origin || destination);

  // Trip ids where I already have a live request/booking.
  const activeTripIds = useMemo(
    () => new Set(
      bookings
        .filter((b) => b.status === 'requested' || b.status === 'accepted')
        .map((b) => b.tripId),
    ),
    [bookings],
  );

  const activeBookings = useMemo(
    () => bookings.filter((b) => b.status === 'requested' || b.status === 'accepted'),
    [bookings],
  );

  const toRate = useMemo(
    () => bookings.filter((b) => b.status === 'completed' && !b.ratedByMe),
    [bookings],
  );

  const loadAll = useCallback(async () => {
    try {
      const [tripList, myBookings] = await Promise.all([
        listCarpoolingTrips({ origin: origin || undefined, destination: destination || undefined }),
        listMyCarpoolingBookings().catch(() => [] as CarpoolingBooking[]),
      ]);
      setTrips(tripList);
      setBookings(myBookings);
    } catch (e: any) {
      const msg = e?.response?.data?.error?.message ?? t('carpooling.passenger.errLoad');
      Alert.alert(t('carpooling.errTitle'), msg);
    }
  }, [origin, destination, t]);

  useFocusEffect(useCallback(() => { loadAll(); }, [loadAll]));

  async function onRequest(trip: CarpoolingTrip) {
    setBusyId(trip.id);
    try {
      await requestCarpoolingBooking(trip.id, 1);
      Alert.alert(t('carpooling.passenger.requestSentTitle'), t('carpooling.passenger.requestSentBody'));
      await loadAll();
    } catch (e: any) {
      const msg = e?.response?.data?.error?.message ?? t('carpooling.passenger.errRequest');
      Alert.alert(t('carpooling.errTitle'), msg);
    } finally {
      setBusyId(null);
    }
  }

  async function onCancelBooking(bookingId: string) {
    setBusyId(bookingId);
    try {
      await cancelCarpoolingBooking(bookingId);
      await loadAll();
    } catch (e: any) {
      Alert.alert(t('carpooling.errTitle'), e?.response?.data?.error?.message ?? t('carpooling.errGeneric'));
    } finally {
      setBusyId(null);
    }
  }

  async function submitRating(stars: number, comment: string) {
    if (!rateFor) return;
    setRating(true);
    try {
      await rateCarpoolingBooking(rateFor.id, stars, comment);
      setRateFor(null);
      Alert.alert(t('carpooling.rate.successTitle'), t('carpooling.rate.successBody'));
      await loadAll();
    } catch (e: any) {
      Alert.alert(t('carpooling.errTitle'), e?.response?.data?.error?.message ?? t('carpooling.rate.errRate'));
    } finally {
      setRating(false);
    }
  }

  function clearFilters() {
    setOrigin('');
    setDestination('');
  }

  return (
    <>
      {/* To rate */}
      {toRate.length > 0 && (
        <View style={{ marginBottom: spacing.lg, gap: spacing.md }}>
          <AppText variant="h2">{t('carpooling.rate.toRateTitle')}</AppText>
          {toRate.map((b) => (
            <Card key={b.id} padding={spacing.base} style={{ gap: spacing.sm }}>
              <AppText variant="title">{b.originCity}{' → '}{b.destinationCity}</AppText>
              <AppText variant="body" color={colors.ink2}>
                {t('carpooling.booking.driverLabel', { name: b.driverName })}
              </AppText>
              <Button
                title={t('carpooling.rate.rateDriverBtn')}
                icon="star"
                size="sm"
                onPress={() => setRateFor(b)}
              />
            </Card>
          ))}
        </View>
      )}

      {/* My requests */}
      {activeBookings.length > 0 && (
        <View style={{ marginBottom: spacing.lg, gap: spacing.md }}>
          <AppText variant="h2">{t('carpooling.passenger.myBookings')}</AppText>
          {activeBookings.map((b) => (
            <PassengerBookingCard
              key={b.id}
              booking={b}
              busy={busyId === b.id}
              onCancel={() => onCancelBooking(b.id)}
            />
          ))}
        </View>
      )}

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
            <Button title={t('carpooling.passenger.searchBtn')} icon="search" size="md" onPress={loadAll} />
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
          trips.map((trip) => {
            const alreadyRequested = activeTripIds.has(trip.id);
            return (
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
                      backgroundColor: statusTone.pending.bg,
                      borderRadius: radius.pill,
                      paddingHorizontal: 10,
                      paddingVertical: 4,
                    }}>
                      <AppText variant="caption" style={{ color: statusTone.pending.fg }}>⭐</AppText>
                    </View>
                  )}
                </View>

                <AppText variant="body" color={colors.ink2}>
                  {t('carpooling.passenger.seatsPrice', { avail: trip.availableSeats, total: trip.totalSeats, price: trip.pricePerSeatMru })}
                </AppText>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm }}>
                  <AppText variant="body" color={colors.ink2}>{t('carpooling.passenger.driverLabel', { name: trip.driverName })}</AppText>
                  <RatingBadge avg={trip.driverRatingAvg} count={trip.driverRatingCount} />
                </View>
                {trip.notes ? (
                  <AppText variant="caption" color={colors.muted}>{trip.notes}</AppText>
                ) : null}

                {alreadyRequested ? (
                  <View style={{
                    flexDirection: 'row', alignItems: 'center', gap: 6,
                    backgroundColor: colors.saffronSoft, borderRadius: radius.md,
                    paddingHorizontal: 12, paddingVertical: 10,
                  }}>
                    <Icon name="clock" size={16} color={colors.warning} />
                    <AppText variant="caption" color={colors.warning}>
                      {t('carpooling.passenger.alreadyRequested')}
                    </AppText>
                  </View>
                ) : (
                  <Button
                    title={t('carpooling.passenger.requestBtn')}
                    iconRight="arrow"
                    size="md"
                    onPress={() => onRequest(trip)}
                    busy={busyId === trip.id}
                  />
                )}
              </Card>
            );
          })
        )}
      </View>

      <RatingModal
        visible={rateFor !== null}
        name={rateFor?.driverName ?? ''}
        busy={rating}
        onSubmit={submitRating}
        onClose={() => setRateFor(null)}
      />
    </>
  );
}

function PassengerBookingCard({ booking, busy, onCancel }: {
  booking: CarpoolingBooking; busy: boolean; onCancel: () => void;
}) {
  const { t } = useTranslation();
  const accepted = booking.status === 'accepted';
  return (
    <Card padding={spacing.base} style={{ gap: spacing.sm }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <AppText variant="title">{booking.originCity}{' → '}{booking.destinationCity}</AppText>
        <StatusBadge status={booking.status} />
      </View>
      <AppText variant="caption" color={colors.ink2}>
        {t('carpooling.booking.metaLine', { date: formatDateTime(booking.departureAt), price: booking.pricePerSeatMru })}
      </AppText>
      <AppText variant="body" color={colors.ink2}>
        {t('carpooling.booking.driverLabel', { name: booking.driverName })}
      </AppText>

      {accepted && booking.otpCode && (
        <View style={{
          backgroundColor: statusTone.done.bg, borderRadius: radius.md, padding: spacing.base, gap: 4,
        }}>
          <AppText variant="caption" color={colors.success}>{t('carpooling.booking.otpTitle')}</AppText>
          <AppText variant="title" style={{ fontSize: 32, letterSpacing: 6, color: colors.success }}>
            {booking.otpCode}
          </AppText>
          <AppText variant="caption" color={colors.ink2}>{t('carpooling.booking.otpHint')}</AppText>
        </View>
      )}

      {accepted && booking.driverPhone && (
        <View style={{ flexDirection: 'row', gap: spacing.sm }}>
          <Button title={t('carpooling.booking.callBtn')} icon="phone" size="sm" onPress={() => openCall(booking.driverPhone!)} />
          <Button title={t('carpooling.booking.whatsappBtn')} icon="whatsapp" variant="secondary" size="sm" onPress={() => openWhatsapp(booking.driverPhone!)} />
        </View>
      )}

      <Button
        title={t('carpooling.booking.cancelBtn')}
        variant="ghost"
        size="sm"
        onPress={onCancel}
        busy={busy}
      />
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/*  Driver view — incoming requests + my trips                         */
/* ------------------------------------------------------------------ */

function DriverView() {
  const { t } = useTranslation();
  const [myTrips, setMyTrips] = useState<CarpoolingTrip[]>([]);
  const [bookings, setBookings] = useState<CarpoolingBooking[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [completeFor, setCompleteFor] = useState<CarpoolingBooking | null>(null);
  const [otp, setOtp] = useState('');
  const [completing, setCompleting] = useState(false);
  const [rateFor, setRateFor] = useState<CarpoolingBooking | null>(null);
  const [rating, setRating] = useState(false);

  const pending = useMemo(() => bookings.filter((b) => b.status === 'requested'), [bookings]);
  const ongoing = useMemo(() => bookings.filter((b) => b.status === 'accepted'), [bookings]);
  const toRate = useMemo(
    () => bookings.filter((b) => b.status === 'completed' && !b.ratedByMe),
    [bookings],
  );

  const loadAll = useCallback(async () => {
    try {
      const [trips, driverBookings] = await Promise.all([
        listMyCarpoolingTrips(),
        listDriverCarpoolingBookings().catch(() => [] as CarpoolingBooking[]),
      ]);
      setMyTrips(trips);
      setBookings(driverBookings);
    } catch {
      setMyTrips([]);
    }
  }, []);

  useFocusEffect(useCallback(() => { loadAll(); }, [loadAll]));

  async function run(bookingId: string, fn: () => Promise<unknown>) {
    setBusyId(bookingId);
    try {
      await fn();
      await loadAll();
    } catch (e: any) {
      Alert.alert(t('carpooling.errTitle'), e?.response?.data?.error?.message ?? t('carpooling.errGeneric'));
    } finally {
      setBusyId(null);
    }
  }

  async function submitComplete() {
    if (!completeFor) return;
    setCompleting(true);
    try {
      await completeCarpoolingBooking(completeFor.id, otp.trim());
      setCompleteFor(null);
      setOtp('');
      Alert.alert(t('carpooling.complete.successTitle'), t('carpooling.complete.successBody'));
      await loadAll();
    } catch (e: any) {
      Alert.alert(t('carpooling.errTitle'), e?.response?.data?.error?.message ?? t('carpooling.complete.errInvalid'));
    } finally {
      setCompleting(false);
    }
  }

  async function cancelTrip(tripId: string) {
    try {
      await cancelCarpoolingTrip(tripId);
      await loadAll();
    } catch (e: any) {
      Alert.alert(t('carpooling.errTitle'), e?.response?.data?.error?.message ?? t('carpooling.driver.errCancel'));
    }
  }

  async function submitRating(stars: number, comment: string) {
    if (!rateFor) return;
    setRating(true);
    try {
      await rateCarpoolingBooking(rateFor.id, stars, comment);
      setRateFor(null);
      Alert.alert(t('carpooling.rate.successTitle'), t('carpooling.rate.successBody'));
      await loadAll();
    } catch (e: any) {
      Alert.alert(t('carpooling.errTitle'), e?.response?.data?.error?.message ?? t('carpooling.rate.errRate'));
    } finally {
      setRating(false);
    }
  }

  return (
    <View style={{ gap: spacing.lg, marginBottom: 100 }}>
      {/* Incoming requests */}
      <View style={{ gap: spacing.md }}>
        <AppText variant="h2">{t('carpooling.driver.requests')}</AppText>
        {pending.length === 0 && ongoing.length === 0 ? (
          <Card padding={spacing.lg}>
            <AppText variant="body" color={colors.ink2}>{t('carpooling.driver.noRequests')}</AppText>
          </Card>
        ) : (
          <>
            {pending.map((b) => (
              <Card key={b.id} padding={spacing.base} style={{ gap: spacing.sm }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <AppText variant="title">{b.originCity}{' → '}{b.destinationCity}</AppText>
                  <StatusBadge status={b.status} />
                </View>
                <AppText variant="caption" color={colors.ink2}>
                  {t('carpooling.booking.metaLine', { date: formatDateTime(b.departureAt), price: b.pricePerSeatMru })}
                </AppText>
                <AppText variant="body" color={colors.ink2}>
                  {t('carpooling.booking.passengerLabel', { name: b.passengerName })}
                </AppText>
                <AppText variant="caption" color={colors.muted}>
                  {t('carpooling.driver.seatsReq', { seats: b.seats })}
                </AppText>
                <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                  <Button
                    title={t('carpooling.driver.acceptBtn')}
                    icon="check"
                    size="sm"
                    onPress={() => run(b.id, () => acceptCarpoolingBooking(b.id))}
                    busy={busyId === b.id}
                  />
                  <Button
                    title={t('carpooling.driver.declineBtn')}
                    variant="danger"
                    size="sm"
                    onPress={() => run(b.id, () => declineCarpoolingBooking(b.id))}
                    disabled={busyId === b.id}
                  />
                </View>
              </Card>
            ))}

            {ongoing.map((b) => (
              <Card key={b.id} padding={spacing.base} style={{ gap: spacing.sm }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <AppText variant="title">{b.originCity}{' → '}{b.destinationCity}</AppText>
                  <StatusBadge status={b.status} />
                </View>
                <AppText variant="body" color={colors.ink2}>
                  {t('carpooling.booking.passengerLabel', { name: b.passengerName })}
                </AppText>
                {b.passengerPhone && (
                  <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                    <Button title={t('carpooling.booking.callBtn')} icon="phone" size="sm" onPress={() => openCall(b.passengerPhone!)} />
                    <Button title={t('carpooling.booking.whatsappBtn')} icon="whatsapp" variant="secondary" size="sm" onPress={() => openWhatsapp(b.passengerPhone!)} />
                  </View>
                )}
                <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                  <Button
                    title={t('carpooling.driver.completeBtn')}
                    icon="check"
                    size="sm"
                    onPress={() => { setCompleteFor(b); setOtp(''); }}
                    disabled={busyId === b.id}
                  />
                  <Button
                    title={t('carpooling.driver.noShowBtn')}
                    variant="secondary"
                    size="sm"
                    onPress={() => run(b.id, () => noShowCarpoolingBooking(b.id))}
                    disabled={busyId === b.id}
                  />
                </View>
                <Button
                  title={t('carpooling.booking.cancelBtn')}
                  variant="ghost"
                  size="sm"
                  onPress={() => run(b.id, () => cancelCarpoolingBooking(b.id))}
                  disabled={busyId === b.id}
                />
              </Card>
            ))}
          </>
        )}
      </View>

      {/* To rate */}
      {toRate.length > 0 && (
        <View style={{ gap: spacing.md }}>
          <AppText variant="h2">{t('carpooling.rate.toRateTitle')}</AppText>
          {toRate.map((b) => (
            <Card key={b.id} padding={spacing.base} style={{ gap: spacing.sm }}>
              <AppText variant="title">{b.originCity}{' → '}{b.destinationCity}</AppText>
              <AppText variant="body" color={colors.ink2}>
                {t('carpooling.booking.passengerLabel', { name: b.passengerName })}
              </AppText>
              <Button
                title={t('carpooling.rate.ratePassengerBtn')}
                icon="star"
                size="sm"
                onPress={() => setRateFor(b)}
              />
            </Card>
          ))}
        </View>
      )}

      {/* My trips */}
      <View style={{ gap: spacing.md }}>
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
                {t('carpooling.driver.seatsLeft', { avail: trip.availableSeats, total: trip.totalSeats })}
              </AppText>
              <Button
                title={t('carpooling.driver.cancelBtn')}
                size="sm"
                variant="danger"
                onPress={() => cancelTrip(trip.id)}
              />
            </Card>
          ))
        )}
      </View>

      {/* Complete (OTP) */}
      <Sheet
        visible={completeFor !== null}
        onClose={() => { setCompleteFor(null); setOtp(''); }}
        title={t('carpooling.complete.title')}
        subtitle={t('carpooling.complete.hint')}
        dismissible={!completing}
        contentStyle={{ gap: spacing.base }}
      >
        <TextInput
          value={otp}
          onChangeText={setOtp}
          keyboardType="number-pad"
          maxLength={6}
          placeholder={t('carpooling.complete.placeholder')}
          placeholderTextColor={colors.muted}
          style={{
            borderWidth: 1,
            borderColor: colors.sunken,
            borderRadius: radius.md,
            paddingHorizontal: spacing.base,
            paddingVertical: spacing.md,
            fontSize: 26,
            // Arabic placeholder is cursive: letterSpacing breaks its
            // shaping, so only space out the typed digits.
            letterSpacing: isRTL(currentLanguage()) && !otp ? 0 : 4,
            textAlign: 'center',
            color: colors.ink,
            fontFamily: isRTL(currentLanguage()) ? fonts.arabic.regular : undefined,
          }}
        />
        <Button
          title={t('carpooling.complete.confirmBtn')}
          icon="check"
          onPress={submitComplete}
          busy={completing}
          disabled={otp.trim().length < 3}
        />
        <Button
          title={t('carpooling.complete.cancelBtn')}
          variant="ghost"
          onPress={() => { setCompleteFor(null); setOtp(''); }}
        />
      </Sheet>

      <RatingModal
        visible={rateFor !== null}
        name={rateFor?.passengerName ?? ''}
        busy={rating}
        onSubmit={submitRating}
        onClose={() => setRateFor(null)}
      />
    </View>
  );
}
