import crypto from 'node:crypto';
import type pg from 'pg';
import { pool, withTx } from '../../db/pool.js';
import { HttpError } from '../../middleware/error.js';
import { env } from '../../config/env.js';
import { estimateFareMru, commissionMru, openFareMru, privateDriverFareMru, privateDriverFinalFareMru, type OpenTariff } from './pricing.js';
import type { FarePricingMode } from './pricing.js';
import { getPricingSettings } from '../admin/app-settings.service.js';
import { distanceMeters, eligibleCaptainsForRide } from './dispatch.service.js';
import { computeDistanceM, lastTrailPoint, readLiveMeter } from './meter.service.js';
import { debitWallet, getBalance } from '../wallet/wallet.service.js';
import { sms } from '../auth/sms.js';
import {
  notifyCaptainsNewRide,
  notifyRiderCaptainArrived,
  notifyRiderCaptainCancelled,
  notifyRiderRideAccepted,
} from '../push/expo-push.js';
import { applyBonusOnCompletion } from './commission-bonus.service.js';
import { resolveFreeDayOnCompletion } from './free-days.service.js';
import { notifyCaptainBonusEarned, notifyCaptainFreeDays } from '../notifications/notifications.service.js';
import type { RideStatus, RideType, PaymentMethod, RideSource } from '@tewiz/shared-types';
import { clearLiveLocation } from '../captain/live-location.js';
import { haversineM } from '../../lib/geo.js';
import { findPartnerByUserId } from '../partners/partners.service.js';
import { applyPartnerAttributionOnCompletion } from '../partners/attribution.service.js';
import { ridesRequested, rideAcceptRejected, recordMatch } from '../../lib/metrics.js';

// Normalize MR phones (same logic as auth/phone.ts but inline for the service).
function normalizeMrPhone(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 8 && /^[234]/.test(digits)) return `+222${digits}`;
  if (digits.length === 11 && digits.startsWith('222')) return `+${digits}`;
  return raw.startsWith('+') ? raw : `+${digits}`;
}

const GENERIC_LOCATION_LABELS = new Set([
  'point sur la carte',
  'ma position',
  'pin on map',
  'my location',
  'نقطة على الخريطة',
  'موقعي',
]);

function sanitizeLocationLabel(label: string | null | undefined): string | null {
  if (!label) return null;
  const trimmed = label.trim();
  if (!trimmed) return null;
  if (GENERIC_LOCATION_LABELS.has(trimmed.toLowerCase())) return null;
  return trimmed;
}

// ────────────────────────────────────────────────────────────────────────────
// Public types

export type { RideSource } from '@tewiz/shared-types';

export interface CreateRideInput {
  bookerId: string;
  pickup: { lat: number; lng: number; label?: string };
  /** Required for fixed-fare rides; must be undefined when isOpen=true. */
  dropoff?: { lat: number; lng: number; label?: string };
  /** Course ouverte — no destination, metered fare from GPS trail. */
  isOpen?: boolean;
  rideType?: RideType;
  paymentMethod?: PaymentMethod;
  // For "course pour quelqu'un d'autre"
  passengerName?: string;
  passengerPhone?: string;
  // For colis (when rideType='colis')
  recipientName?: string;
  recipientPhone?: string;
  packageDescription?: string;
  // Admin-only: skip the SMS "course pour quelqu'un d'autre" confirmation step.
  // When a passenger calls the operator, they have already consented — the ride
  // can go straight to "searching" without a return SMS.
  skipPassengerConfirm?: boolean;
  // Where the ride came from. Defaults to 'app' (rider self-served from the
  // mobile app). Set to 'operator' when an admin books on behalf of a
  // passenger who called by phone — this picks a dedicated commission rate.
  source?: RideSource;
  // Inter-city pricing mode. Solo keeps the full vehicle fare; shared divides
  // the same inter-city fare per seat.
  pricingMode?: FarePricingMode;
  sharedSeats?: number;
  privateDriverDurationH?: number;
  vehiclePlate?: string;
  vehicleDescription?: string;
}

interface RideRow {
  id: string;
  booker_id: string;
  passenger_user_id: string | null;
  passenger_name: string | null;
  passenger_phone: string | null;
  is_for_other: boolean;
  passenger_confirmed_at: Date | null;
  captain_id: string | null;
  ride_type: RideType;
  source: RideSource;
  origin_partner_id: string | null;
  pricing_mode: FarePricingMode;
  shared_seats: number | null;
  status: RideStatus;
  pickup_lat: number;
  pickup_lng: number;
  pickup_label: string | null;
  // Nullable for open rides (no upfront destination, filled in at completion).
  dropoff_lat: number | null;
  dropoff_lng: number | null;
  dropoff_label: string | null;
  fare_estimate_mru: string | null;
  fare_final_mru: string | null;
  commission_rate_bps: number;
  commission_mru: string | null;
  payment_method: PaymentMethod;
  distance_m: number | null;
  duration_s: number | null;
  verification_code: string | null;
  requested_at: Date;
  accepted_at: Date | null;
  arrived_at: Date | null;
  started_at: Date | null;
  completed_at: Date | null;
  cancelled_at: Date | null;
  cancel_reason: string | null;
  last_captain_cancel_reason: string | null;
  last_captain_cancel_at: Date | null;
  is_open: boolean;
  open_base_fare_mru: number | null;
  open_per_km_mru: number | null;
  open_per_minute_mru: number | null;
  open_min_fare_mru: number | null;
}

// ────────────────────────────────────────────────────────────────────────────
// Helpers

const RIDE_COLUMNS = `
  id, booker_id, passenger_user_id, passenger_name, passenger_phone,
  is_for_other, passenger_confirmed_at, captain_id, ride_type, source,
  origin_partner_id,
  pricing_mode, shared_seats, status,
  ST_Y(pickup_location::geometry)  AS pickup_lat,
  ST_X(pickup_location::geometry)  AS pickup_lng,
  pickup_label,
  ST_Y(dropoff_location::geometry) AS dropoff_lat,
  ST_X(dropoff_location::geometry) AS dropoff_lng,
  dropoff_label,
  fare_estimate_mru, fare_final_mru,
  commission_rate_bps, commission_mru,
  payment_method, distance_m, duration_s, verification_code,
  requested_at, accepted_at, arrived_at, started_at, completed_at,
  cancelled_at, cancel_reason,
  last_captain_cancel_reason, last_captain_cancel_at,
  is_open, open_base_fare_mru, open_per_km_mru,
  open_per_minute_mru, open_min_fare_mru
`;

function shape(r: RideRow, opts: { revealCode: boolean } = { revealCode: false }) {
  return {
    id: r.id,
    bookerId: r.booker_id,
    passengerUserId: r.passenger_user_id,
    passengerName: r.passenger_name,
    passengerPhone: r.passenger_phone,
    isForOther: r.is_for_other,
    passengerConfirmedAt: r.passenger_confirmed_at,
    captainId: r.captain_id,
    rideType: r.ride_type,
    source: r.source,
    originPartnerId: r.origin_partner_id,
    pricingMode: r.pricing_mode,
    sharedSeats: r.shared_seats,
    status: r.status,
    pickup: { lat: r.pickup_lat, lng: r.pickup_lng, label: r.pickup_label },
    // Open rides start with dropoff=null; once completed the captain's last
    // GPS point is written back so the shape stays consistent.
    dropoff: r.dropoff_lat == null || r.dropoff_lng == null
      ? null
      : { lat: r.dropoff_lat, lng: r.dropoff_lng, label: r.dropoff_label },
    fareEstimateMru: r.fare_estimate_mru === null ? null : Number(r.fare_estimate_mru),
    fareFinalMru: r.fare_final_mru === null ? null : Number(r.fare_final_mru),
    commissionRateBps: r.commission_rate_bps,
    commissionMru: r.commission_mru === null ? null : Number(r.commission_mru),
    paymentMethod: r.payment_method,
    distanceM: r.distance_m,
    durationS: r.duration_s,
    requestedAt: r.requested_at,
    acceptedAt: r.accepted_at,
    arrivedAt: r.arrived_at,
    startedAt: r.started_at,
    completedAt: r.completed_at,
    cancelledAt: r.cancelled_at,
    cancelReason: r.cancel_reason,
    // Why the LAST assigned captain dropped this ride, if one did. Survives the
    // reset back to 'searching' so the rider can be told and support can
    // reconstruct what happened from the ride alone.
    lastCancelReason: r.last_captain_cancel_reason ?? null,
    lastCancelAt: r.last_captain_cancel_at ?? null,
    isOpen: r.is_open,
    openTariff: r.is_open && r.open_base_fare_mru != null
      ? {
          baseFareMru: r.open_base_fare_mru,
          perKmMru: r.open_per_km_mru!,
          perMinuteMru: r.open_per_minute_mru!,
          minFareMru: r.open_min_fare_mru!,
        }
      : null,
  };
}

/**
 * Tack the live meter (distance/duration/fare so far) onto an in_progress
 * open ride. No-op for closed rides or rides that haven't started.
 */
async function enrichWithLiveMeter<T extends {
  id: string;
  isOpen: boolean;
  status: RideStatus;
  startedAt: Date | null;
  openTariff: OpenTariff | null;
}>(ride: T): Promise<T & {
  liveMeter: { distanceM: number; durationS: number; fareMru: number } | null;
}> {
  if (!ride.isOpen || !ride.startedAt || !ride.openTariff || ride.status !== 'in_progress') {
    return { ...ride, liveMeter: null };
  }
  try {
    const liveMeter = await readLiveMeter({
      rideId: ride.id,
      startedAt: ride.startedAt,
      tariff: ride.openTariff,
    });
    return { ...ride, liveMeter };
  } catch (e: any) {
    // Never fail the ride/current payload because of optional meter telemetry.
    // This keeps captain state transitions usable even if meter storage is
    // temporarily unavailable (e.g. migration drift in one environment).
    console.warn('[rides] live meter unavailable', {
      rideId: ride.id,
      error: e?.message ?? String(e),
    });
    return { ...ride, liveMeter: null };
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Broadcast

/**
 * Fire-and-forget push to every captain eligible for a ride.
 *
 * MUST be called AFTER the transaction that created or revived the ride has
 * committed, never from inside the `withTx` callback.
 *
 * Why that matters, concretely: this runs on a pool connection of its own, so a
 * ride still inside an uncommitted transaction is invisible to it. Every query
 * in eligibleCaptainsForRide starts with `WITH r AS (SELECT … FROM rides WHERE
 * id = $1)` and then CROSS JOINs it — an empty `r` yields zero rows, so the
 * function returns an empty list and NOBODY is notified. Nothing throws, nothing
 * is logged: the ride simply never reaches a captain's phone, and only the ones
 * polling their inbox ever see it.
 *
 * It was a race, so it only bit some of the time. The tell that surfaced it was
 * tewiz_dispatch_geo_fallback_total{reason="no_pickup"} on a ride that certainly
 * had a pickup point — the row was not visible yet.
 *
 * Failures are swallowed on purpose: a missed push must never turn into a failed
 * ride creation. The captain still finds the ride by polling.
 */
async function broadcastNewRide(
  ride: { id: string; ride_type: RideType; fare_estimate_mru: string | number | null },
  context: string,
): Promise<void> {
  try {
    const captainIds = await eligibleCaptainsForRide(ride.id);
    if (captainIds.length === 0) return;
    await notifyCaptainsNewRide(captainIds, {
      id: ride.id,
      rideType: ride.ride_type,
      // numeric column comes back as string from pg; widen to number for the DTO.
      fareEstimateMru: ride.fare_estimate_mru == null ? null : Number(ride.fare_estimate_mru),
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(`[rides] ${context} failed`, err);
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Create

export async function createRide(input: CreateRideInput) {
  const rideType: RideType = input.rideType ?? 'passenger';
  const isOpen = !!input.isOpen;
  const settings = await getPricingSettings();
  let source: RideSource = input.source ?? 'app';
  const requestedPricingMode: FarePricingMode = input.pricingMode ?? 'solo';

  // Partner attribution (migration 0041). When the BOOKER account belongs to
  // an active restaurant/member partner, the ride is theirs regardless of
  // which client they used — the server stamps source + origin_partner_id so
  // the commission share can never be lost to a client-side omission.
  let originPartnerId: string | null = null;
  let originPartnerType: 'restaurant' | 'individual' | null = null;
  if (source === 'app') {
    const partner = await findPartnerByUserId(input.bookerId);
    if (partner && partner.status === 'active'
        && (partner.type === 'restaurant' || partner.type === 'individual')) {
      originPartnerId = partner.id;
      originPartnerType = partner.type;
      source = partner.type === 'restaurant' ? 'restaurant' : 'partner';
    }
  }

  // How many rides may this account hold open at once?
  //
  // Checked here, before any pricing work and before the transaction, so a
  // refusal costs one cheap COUNT. Three tiers, keyed on `source` — which the
  // SERVER sets (from the route and the partner lookup above) and no client can
  // supply, so the exemption cannot be spoofed:
  //
  //   operator  — the call centre. Every phone ride is booked under the same
  //               admin account, so any cap at all would stop the operator on
  //               their third call. Exempt.
  //   partner   — a restaurant or agency dispatching several cars at once. This
  //               is the case that got the original limit removed; giving them
  //               their own allowance is what lets the limit come back.
  //   otherwise — an ordinary rider.
  const activeRideCap = source === 'operator'
    ? 0
    : originPartnerId
      ? settings.maxActiveRidesPerPartner
      : settings.maxActiveRidesPerBooker;
  if (activeRideCap > 0) {
    const { rows: activeRows } = await pool.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n
         FROM rides
        WHERE booker_id = $1
          AND status IN ('searching','accepted','arrived','in_progress','pending_passenger_confirm')`,
      [input.bookerId],
    );
    const activeRides = Number(activeRows[0]?.n ?? 0);
    if (activeRides >= activeRideCap) {
      throw new HttpError(
        429,
        'too_many_active_rides',
        `Vous avez déjà ${activeRides} course(s) en cours. Terminez-en une avant d'en commander une autre.`,
        { activeRides, maxActiveRides: activeRideCap },
      );
    }
  }

  if (isOpen) {
    if (!settings.allowOpenRides) {
      throw new HttpError(403, 'open_rides_disabled',
        'Les courses ouvertes sont désactivées');
    }
    if (rideType !== 'passenger') {
      throw new HttpError(400, 'open_only_passenger',
        'Open rides are only supported for passenger rides');
    }
    if (input.dropoff) {
      throw new HttpError(400, 'open_has_dropoff',
        'Open rides must not carry a dropoff (the captain decides when to stop)');
    }
  } else if (rideType === 'private_driver') {
    if (!settings.privateDriverEnabled) {
      throw new HttpError(403, 'private_driver_disabled',
        'Le service Captain Privé est désactivé');
    }
    if (!input.privateDriverDurationH ||
        ![3, 6, 12, 24].includes(input.privateDriverDurationH)) {
      throw new HttpError(400, 'invalid_duration',
        'Durée invalide — choisissez 3h, 6h, 12h ou journée');
    }
    if (input.dropoff) {
      throw new HttpError(400, 'private_driver_no_dropoff',
        'Captain Privé: pas de destination fixe');
    }
  } else if (rideType === 'convoyage') {
    if (!settings.convoyageEnabled) {
      throw new HttpError(403, 'convoyage_disabled',
        'Le service Convoyage est désactivé');
    }
    if (!input.dropoff) {
      throw new HttpError(400, 'convoyage_missing_dropoff',
        'Le convoyage nécessite une destination (point B)');
    }
    if (!input.vehiclePlate) {
      throw new HttpError(400, 'convoyage_missing_plate',
        'Le convoyage nécessite le numéro de plaque du véhicule');
    }
  } else if (rideType === 'car_rental') {
    if (!settings.carRentalEnabled) {
      throw new HttpError(403, 'car_rental_disabled',
        'Le service Location de Voiture est désactivé');
    }
  } else if (rideType === 'roadside_assistance') {
    if (!settings.roadsideAssistanceEnabled) {
      throw new HttpError(403, 'roadside_assistance_disabled',
        'Le service Assistance Routière est désactivé');
    }
  } else if (rideType === 'light_moving') {
    if (!settings.lightMovingEnabled) {
      throw new HttpError(403, 'light_moving_disabled',
        'Le service Déménagement Léger est désactivé');
    }
    if (!input.dropoff) {
      throw new HttpError(400, 'light_moving_missing_dropoff',
        'Le déménagement nécessite une destination (point B)');
    }
  } else if (rideType === 'intercity_freight') {
    if (!settings.intercityFreightEnabled) {
      throw new HttpError(403, 'intercity_freight_disabled',
        'Le service Fret Intercité est désactivé');
    }
    if (!input.dropoff) {
      throw new HttpError(400, 'intercity_freight_missing_dropoff',
        'Le fret intercité nécessite une destination (point B)');
    }
  } else if (rideType === 'equipment_rental') {
    if (!settings.equipmentRentalEnabled) {
      throw new HttpError(403, 'equipment_rental_disabled',
        'Le service Location d\'Équipement est désactivé');
    }
  } else if (!input.dropoff) {
    throw new HttpError(400, 'missing_dropoff',
      'A dropoff is required for fixed-fare rides');
  }

  // Pricing — different paths for fixed vs metered.
  let fareEstimateMru: number | null;
  let distanceEstimateM: number | null;
  let isIntercityPricing = false;
  let pricingModeForRow: FarePricingMode = 'solo';
  let sharedSeatsForRow: number | null = null;
  if (rideType === 'private_driver') {
    const nightPricing = {
      enabled: settings.nightPricingEnabled,
      multiplier: settings.nightPriceMultiplier,
      startHour: settings.nightPriceStartHour,
      endHour: settings.nightPriceEndHour,
    };
    const quote = privateDriverFareMru(
      settings.privateDriverHourlyRateMru,
      input.privateDriverDurationH!,
      nightPricing,
    );
    fareEstimateMru = quote.fareMru;
    distanceEstimateM = null;
  } else if (isOpen) {
    if (input.pricingMode === 'shared') {
      throw new HttpError(400, 'shared_open_not_supported',
        'Shared mode is not supported for open rides');
    }
    fareEstimateMru = null;
    distanceEstimateM = null;
  } else {
    const dStraight = await distanceMeters(
      input.pickup.lat, input.pickup.lng,
      input.dropoff!.lat, input.dropoff!.lng,
    );
    if (dStraight < 50) {
      throw new HttpError(400, 'distance_too_short',
        'Pickup and dropoff are too close (<50 m)');
    }
    const est = await estimateFareMru(dStraight, rideType, {
      pricingMode: input.pricingMode,
      sharedSeats: input.sharedSeats,
    });
    fareEstimateMru = est.fareMru;
    distanceEstimateM = est.distanceEstimateM;
    isIntercityPricing = est.isIntercityPricing;
    pricingModeForRow = est.pricingModeApplied;
    sharedSeatsForRow = est.sharedSeatsApplied;

    if (requestedPricingMode === 'shared' && !est.isIntercityPricing) {
      throw new HttpError(400, 'shared_not_available',
        'Shared mode is available only for inter-city rides');
    }
  }

  const commissionBps = source === 'operator'
    ? (rideType === 'colis'
        ? settings.operatorColisCommissionBps
        : settings.operatorPassengerCommissionBps)
    : source === 'restaurant'
    ? (rideType === 'colis'
        ? settings.restaurantColisCommissionBps
        : settings.restaurantPassengerCommissionBps)
    : source === 'partner'
    ? (rideType === 'colis'
        ? settings.partnerColisCommissionBps
        : settings.partnerPassengerCommissionBps)
    : rideType === 'private_driver'
    ? settings.privateDriverCommissionBps
    : rideType === 'convoyage'
    ? settings.convoyageCommissionBps
    : rideType === 'car_rental'
    ? settings.carRentalCommissionBps
    : rideType === 'roadside_assistance'
    ? settings.roadsideAssistanceCommissionBps
    : rideType === 'light_moving'
    ? settings.lightMovingCommissionBps
    : rideType === 'intercity_freight'
    ? settings.intercityFreightCommissionBps
    : rideType === 'equipment_rental'
    ? settings.equipmentRentalCommissionBps
    : (isIntercityPricing
        ? settings.intercityCommissionBps
        : rideType === 'colis'
          ? settings.colisCommissionBps
          : settings.defaultCommissionBps);

  // Validate colis-specific inputs
  if (rideType === 'colis') {
    if (!input.recipientName || !input.recipientPhone) {
      throw new HttpError(400, 'colis_missing_recipient',
        'Colis rides require recipientName and recipientPhone');
    }
  }

  // "Course pour quelqu'un d'autre": passenger is someone other than the booker.
  // Status starts at pending_passenger_confirm; we send an SMS to the passenger
  // and only after they reply YES (POST /public/rides/:id/confirm) do we move to searching.
  const isForOther = !!(input.passengerName && input.passengerPhone);
  // Riders book colis from the app as themselves (sender = booker, recipient = third party),
  // so "for someone else" is meaningless there. The operator flow is different: the caller
  // is the sender, the admin is the booker, and the recipient is a separate person — all
  // three roles legitimately exist.
  if (isForOther && rideType === 'colis' && source !== 'operator') {
    throw new HttpError(400, 'colis_for_other',
      'Colis rides cannot be booked "for someone else" (the recipient field already serves that purpose)');
  }
  const normalizedPassengerPhone = input.passengerPhone
    ? normalizeMrPhone(input.passengerPhone)
    : null;

  // "course pour quelqu'un d'autre" normally waits for SMS confirmation.
  // Two reasons to bypass that loop:
  //   1. the caller asked for it (admin operator booking a phone-in passenger
  //      who already consented),
  //   2. the SMS provider isn't actually wired up (env.SMS_PROVIDER === 'mock'),
  //      in which case the passenger would never receive the SMS and the ride
  //      would stay invisible to captains forever.
  // The check switches itself off automatically the day we plug Twilio /
  // Chinguitel and flip SMS_PROVIDER.
  const smsConfirmAvailable = env.SMS_PROVIDER !== 'mock';
  const needsPassengerConfirm =
    isForOther && !input.skipPassengerConfirm && smsConfirmAvailable;
  const initialStatus: RideStatus = needsPassengerConfirm ? 'pending_passenger_confirm' : 'searching';

  const result = await withTx(async (client) => {
    // For "for other" rides, passenger_user_id stays NULL (passenger has no account).
    const passengerUserId = isForOther ? null : input.bookerId;
    // Open rides leave dropoff_location NULL until completion. For closed
    // rides we build the geography from the rider's pinned dropoff. PostGIS
    // can't accept NULL coords in ST_MakePoint, so we branch on isOpen and
    // pass either NULL or the literal geography into the column.
    const dropoffGeo = isOpen
      ? null
      : { lng: input.dropoff!.lng, lat: input.dropoff!.lat };
    const pickupLabel = sanitizeLocationLabel(input.pickup.label);
    const dropoffLabel = isOpen ? null : sanitizeLocationLabel(input.dropoff?.label);
    const openTariff = isOpen
      ? {
          base: settings.openBaseFareMru,
          perKm: settings.openPerKmMru,
          perMin: settings.openPerMinuteMru,
          min: settings.openMinFareMru,
        }
      : null;
    const r = await client.query<RideRow>(
      `INSERT INTO rides (
         booker_id, passenger_user_id, passenger_name, passenger_phone,
         is_for_other, ride_type, status,
         pickup_location, pickup_label,
         dropoff_location, dropoff_label,
         fare_estimate_mru, commission_rate_bps,
         distance_m, payment_method, verification_code, source,
         origin_partner_id,
         pricing_mode, shared_seats,
         is_open,
         open_base_fare_mru, open_per_km_mru,
         open_per_minute_mru, open_min_fare_mru
       )
       VALUES (
         $1::uuid, $14::uuid, $15, $16, $13, $2, $17,
         ST_SetSRID(ST_MakePoint($3, $4), 4326)::geography, $5,
         CASE WHEN $6::float8 IS NULL OR $7::float8 IS NULL
              THEN NULL
              ELSE ST_SetSRID(ST_MakePoint($6, $7), 4326)::geography
         END,
         $8,
         $9, $10, $11, $12, $18, $19,
         $27::uuid,
         $20, $21,
         $22,
         $23, $24, $25, $26
       )
       RETURNING ${RIDE_COLUMNS}`,
      [
        input.bookerId, rideType,
        input.pickup.lng, input.pickup.lat, pickupLabel,
        dropoffGeo?.lng ?? null, dropoffGeo?.lat ?? null, dropoffLabel,
        fareEstimateMru, commissionBps, distanceEstimateM,
        input.paymentMethod ?? 'cash',
        isForOther,
        passengerUserId,
        input.passengerName ?? null,
        normalizedPassengerPhone,
        initialStatus,
        null,
        source,
        pricingModeForRow,
        sharedSeatsForRow,
        isOpen,
        openTariff?.base ?? null,
        openTariff?.perKm ?? null,
        openTariff?.perMin ?? null,
        openTariff?.min ?? null,
        originPartnerId,
      ],
    );
    const ride = r.rows[0]!;

    // Strategy 2: the end customer served by an individual member is recorded
    // as HIS beneficiary — first member serving a phone owns it (conversion
    // bonus goes to him when that customer later self-orders from the app).
    if (originPartnerType === 'individual' && normalizedPassengerPhone) {
      await client.query(
        `INSERT INTO partner_beneficiaries (partner_id, phone)
         VALUES ($1, $2)
         ON CONFLICT (phone) DO NOTHING`,
        [originPartnerId, normalizedPassengerPhone],
      );
    }

    // Colis details
    if (rideType === 'colis') {
      await client.query(
        `INSERT INTO colis_details (ride_id, recipient_name, recipient_phone, package_description)
         VALUES ($1, $2, $3, $4)`,
        [
          ride.id,
          input.recipientName!,
          normalizeMrPhone(input.recipientPhone!),
          input.packageDescription ?? null,
        ],
      );
    }

    // Private driver details
    if (rideType === 'private_driver') {
      await client.query(
        `INSERT INTO private_driver_details (ride_id, booked_duration_h, hourly_rate_mru, booked_fare_mru)
         VALUES ($1, $2, $3, $4)`,
        [ride.id, input.privateDriverDurationH!, settings.privateDriverHourlyRateMru, fareEstimateMru],
      );
    }

    // Convoyage details
    if (rideType === 'convoyage') {
      await client.query(
        `INSERT INTO convoyage_details (ride_id, vehicle_plate, vehicle_description)
         VALUES ($1, $2, $3)`,
        [ride.id, input.vehiclePlate!, input.vehicleDescription ?? ''],
      );
    }

    // Roadside assistance details
    if (rideType === 'roadside_assistance') {
      await client.query(
        `INSERT INTO roadside_assistance_details (ride_id, assistance_type, vehicle_condition)
         VALUES ($1, $2, $3)`,
        [ride.id, input.packageDescription ?? 'assistance', null],
      );
    }

    // Light moving details
    if (rideType === 'light_moving') {
      await client.query(
        `INSERT INTO light_moving_details (ride_id, item_description, estimated_weight_kg)
         VALUES ($1, $2, $3)`,
        [ride.id, input.packageDescription ?? '', null],
      );
    }

    // Intercity freight details
    if (rideType === 'intercity_freight') {
      await client.query(
        `INSERT INTO intercity_freight_details (ride_id, cargo_description, estimated_weight_kg, special_handling)
         VALUES ($1, $2, $3, $4)`,
        [ride.id, input.packageDescription ?? '', null, false],
      );
    }

    // Car rental details
    if (rideType === 'car_rental') {
      await client.query(
        `INSERT INTO car_rental_details (ride_id, booked_days, daily_rate_mru, booked_fare_mru)
         VALUES ($1, $2, $3, $4)`,
        [ride.id, 1, settings.carRentalDailyRateMru, fareEstimateMru],
      );
    }

    // Equipment rental details
    if (rideType === 'equipment_rental') {
      await client.query(
        `INSERT INTO equipment_rental_details (ride_id, equipment_type, booked_days, daily_rate_mru, booked_fare_mru)
         VALUES ($1, $2, $3, $4, $5)`,
        [ride.id, input.packageDescription ?? 'equipment', 1, settings.equipmentRentalDailyRateMru, fareEstimateMru],
      );
    }

    // SMS notifications (mocked in dev) — only when we actually need the
    // passenger to confirm. Admin operator rides skip this entirely.
    if (needsPassengerConfirm && normalizedPassengerPhone) {
      // 4-digit confirmation code stored in otp_codes for the passenger
      const confirmCode = crypto.randomInt(0, 10_000).toString().padStart(4, '0');
      const bcrypt = await import('bcryptjs');
      const hash = await bcrypt.default.hash(confirmCode, 8);
      await client.query(
        `INSERT INTO otp_codes (phone, code_hash, purpose, expires_at)
         VALUES ($1, $2, 'passenger_confirm:' || $3, now() + interval '15 minutes')`,
        [normalizedPassengerPhone, hash, ride.id],
      );
      await sms.send(
        normalizedPassengerPhone,
        `Tewiz: ${input.passengerName ?? 'quelqu\'un'} a commandé un taxi pour vous. Code: ${confirmCode}. Répondez ou ouvrez l'app pour confirmer.`,
      );
    }

    const shaped = shape(ride, { revealCode: true });
    // Counted here, inside the transaction callback but after every validation
    // gate, so a rejected request never lands in the denominator of the fill
    // rate. `source` is a small server-controlled enum (app/restaurant/partner/…),
    // safe as a label.
    ridesRequested.inc({ ride_type: ride.ride_type, source: ride.source ?? 'app' });
    return { shaped, ride };
  });

  // Push to nearby captains — AFTER the commit, never from inside the callback.
  // The previous version fired from within `withTx`, on a separate pool
  // connection, so the ride was frequently still invisible and the broadcast
  // silently reached nobody. See broadcastNewRide for the full mechanism.
  //
  // Only when the ride is immediately 'searching' — for SMS-confirmed rides the
  // push comes from confirmPassengerRide once the passenger has agreed.
  if (result.ride.status === 'searching') {
    void broadcastNewRide(result.ride, 'notifyCaptainsNewRide');
  }
  return result.shaped;
}

/**
 * Confirm a "course pour quelqu'un d'autre" using the 4-digit SMS code.
 * Public endpoint — the passenger has no app.
 */
export async function confirmPassengerRide(input: {
  rideId: string;
  code: string;
}) {
  const result = await withTx(async (client) => {
    const r = await client.query<RideRow>(
      `SELECT ${RIDE_COLUMNS} FROM rides WHERE id = $1 FOR UPDATE`,
      [input.rideId],
    );
    const ride = r.rows[0];
    if (!ride) throw new HttpError(404, 'not_found', 'Ride not found');
    if (ride.status !== 'pending_passenger_confirm') {
      throw new HttpError(409, 'wrong_status', `Ride is ${ride.status}`);
    }
    if (!ride.passenger_phone) {
      throw new HttpError(400, 'no_passenger_phone', 'Ride has no passenger phone');
    }

    // Verify code
    const codeRow = await client.query<{ id: string; code_hash: string; expires_at: Date; attempts: number }>(
      `SELECT id, code_hash, expires_at, attempts FROM otp_codes
        WHERE phone = $1 AND purpose = 'passenger_confirm:' || $2
              AND consumed_at IS NULL
        ORDER BY created_at DESC LIMIT 1`,
      [ride.passenger_phone, ride.id],
    );
    const c = codeRow.rows[0];
    if (!c) throw new HttpError(400, 'no_code', 'No active confirmation code');
    if (c.expires_at.getTime() < Date.now()) {
      throw new HttpError(400, 'code_expired', 'Code expired');
    }
    const bcrypt = await import('bcryptjs');
    const ok = await bcrypt.default.compare(input.code, c.code_hash);
    if (!ok) {
      await client.query(`UPDATE otp_codes SET attempts = attempts + 1 WHERE id = $1`, [c.id]);
      throw new HttpError(400, 'invalid_code', 'Invalid code');
    }
    await client.query(`UPDATE otp_codes SET consumed_at = now() WHERE id = $1`, [c.id]);

    const upd = await client.query<RideRow>(
      `UPDATE rides
          SET status = 'searching', passenger_confirmed_at = now()
        WHERE id = $1
      RETURNING ${RIDE_COLUMNS}`,
      [ride.id],
    );
    const updated = upd.rows[0]!;
    return { shaped: shape(updated, { revealCode: true }), updated };
  });

  // After the commit — the passenger's confirmation is what flips the ride to
  // 'searching', and broadcasting from inside the transaction meant the ride was
  // often still invisible to the lookup running on its own connection.
  void broadcastNewRide(result.updated, 'notifyCaptainsNewRide');
  return result.shaped;
}

// ────────────────────────────────────────────────────────────────────────────
// Reads

/**
 * Recombine independently-computed enrichments of the same ride.
 *
 * Every `enrichWith*` helper is shaped `ride => ({ ...ride, someNewField })`, so
 * folding them (`a` feeds `b` feeds `c`) and fanning them out (all read the same
 * base, then merge) produce the same object — PROVIDED no two of them write the
 * same field, which today none do. That is the whole reason the read paths can
 * issue their queries at once instead of one after another.
 *
 * The exception is deliberate and lives at the call site, not here:
 * `enrichWithCaptainPosition` rewrites the `captain` object that
 * `enrichWithCaptain` built, so those two stay chained. Merging a
 * position-enriched result must therefore come after any other producer of
 * `captain` — with only one producer, ordering the spread by argument position
 * is enough.
 *
 * `base` is spread first so the result keeps its identity even when `parts` is
 * empty, and so a part that (wrongly) dropped a base field cannot silently
 * shrink the payload.
 */
function mergeEnriched<B extends object, P extends object[]>(
  base: B,
  parts: [...P],
): B & UnionToIntersection<P[number]> {
  return Object.assign({}, base, ...parts);
}

/** Collapse `A | B | C` into `A & B & C`, so a merged payload keeps every key. */
type UnionToIntersection<U> = (U extends unknown ? (k: U) => void : never) extends (
  k: infer I,
) => void
  ? I
  : never;

export async function getRideForUser(
  rideId: string,
  userId: string,
  role: 'rider' | 'captain' | 'admin',
) {
  const r = await pool.query<RideRow>(
    `SELECT ${RIDE_COLUMNS} FROM rides WHERE id = $1`,
    [rideId],
  );
  const ride = r.rows[0];
  if (!ride) throw new HttpError(404, 'not_found', 'Ride not found');

  // Authorization: booker or captain (once accepted) or admin.
  if (role !== 'admin'
      && ride.booker_id !== userId
      && ride.captain_id !== userId) {
    throw new HttpError(403, 'forbidden', 'Not your ride');
  }

  // Code reveal rules:
  //   - Booker (rider) always sees it (they need to read it to the captain)
  //   - Captain sees it only AFTER accept (so they can verify identity at pickup)
  //   - Admin always
  const revealCode =
    role === 'admin' ||
    ride.booker_id === userId ||
    (ride.captain_id === userId && ride.status !== 'searching');
  const shaped = shape(ride, { revealCode });

  // The assigned captain gets the rider's contact (name + phone) so they can
  // call at pickup. The rider gets the captain's details. Admin gets neither
  // here (the admin console joins separately).
  //
  // Each branch fans its lookups out rather than folding them: every enricher
  // below keys off the ride row we already hold (`id`, `captainId`, `bookerId`,
  // `rideType`), so none of them needs another's output and the request paid the
  // SUM of their latencies for no reason. See `mergeEnriched` for why spreading
  // the results is equivalent to chaining them.
  if (role === 'captain' && ride.captain_id === userId) {
    const parts = await Promise.all([
      enrichWithBooker(shaped),
      enrichRideWithAllDetails(shaped),
      enrichWithLiveMeter(shaped),
    ]);
    return mergeEnriched(shaped, parts);
  }
  if (role === 'rider' && ride.booker_id === userId) {
    const parts = await Promise.all([
      enrichWithCaptain(shaped),
      enrichRideWithAllDetails(shaped),
      enrichWithLiveMeter(shaped),
    ]);
    return mergeEnriched(shaped, parts);
  }
  if (role === 'admin') {
    // The operator console shows the assigned captain (name + phone) plus the
    // full list of captains who accepted — the winner and everyone who tapped
    // a moment too late.
    const parts = await Promise.all([
      enrichWithCaptain(shaped),
      enrichWithAcceptances(shaped),
      enrichRideWithAllDetails(shaped),
      enrichWithLiveMeter(shaped),
    ]);
    return mergeEnriched(shaped, parts);
  }
  const parts = await Promise.all([
    enrichRideWithAllDetails(shaped),
    enrichWithLiveMeter(shaped),
  ]);
  return mergeEnriched(shaped, parts);
}

export async function getCurrentRideForRider(userId: string) {
  // Active rides AND completed-but-not-yet-rated rides from the last 24 h.
  // Keeping a completed ride "current" lets the rider see the fare summary
  // and rate the captain right where they were tracking.
  const r = await pool.query<RideRow>(
    `SELECT ${RIDE_COLUMNS} FROM rides
      WHERE booker_id = $1
        AND (
          status IN ('searching','accepted','arrived','in_progress')
          OR (status = 'completed'
              AND completed_at > now() - interval '24 hours'
              AND NOT EXISTS (
                SELECT 1 FROM ratings r
                 WHERE r.ride_id = rides.id AND r.rater_id = $1
              ))
        )
      ORDER BY requested_at DESC LIMIT 1`,
    [userId],
  );
  if (!r.rows[0]) return null;
  const ride = shape(r.rows[0], { revealCode: true });

  // Captain → position is the one genuine dependency in this file: the position
  // step merges `location` INTO the captain object the previous step built, and
  // skips its query entirely when no captain row came back. It stays a chain.
  // The type details and the live meter depend on neither, so they run alongside
  // it instead of behind it — this is the endpoint the tracking screen polls for
  // the whole trip, so its latency is paid over and over.
  const parts = await Promise.all([
    enrichWithCaptain(ride).then(enrichWithCaptainPosition),
    enrichRideWithAllDetails(ride),
    enrichWithLiveMeter(ride),
  ]);
  return mergeEnriched(ride, parts);
}

/** Statuses during which the rider is entitled to see where their captain is. */
const LIVE_POSITION_STATUSES = new Set<RideStatus>(['accepted', 'arrived', 'in_progress']);

/**
 * Attach the captain's live position to a rider-facing ride.
 *
 * The data has always been there — `captain_state.location` is what dispatch
 * matches against, kept current by the background tracker the app already pays
 * for in permissions and battery. It simply never reached the person who wanted
 * it most.
 *
 * Two rules make the difference between a useful map and a misleading one:
 *
 *   * FRESHNESS. A position older than the rider window is reported as `null`,
 *     not drawn. Being honestly blank beats being confidently wrong.
 *   * SCOPE. Only while the ride is live. The tracking screen stays mounted
 *     after completion so the rider can rate; continuing to stream a captain's
 *     whereabouts to a finished trip is a privacy leak, not a feature.
 */
async function enrichWithCaptainPosition<
  T extends {
    status: RideStatus;
    captainId: string | null;
    pickup: { lat: number; lng: number };
    captain: CaptainInfo | null;
  },
>(ride: T): Promise<T & { captainDistanceM: number | null }> {
  if (!ride.captainId || !ride.captain || !LIVE_POSITION_STATUSES.has(ride.status)) {
    return { ...ride, captainDistanceM: null };
  }

  try {
    const { rows } = await pool.query<{
      lat: string | number | null;
      lng: string | number | null;
      location_updated_at: Date | null;
    }>(
      `SELECT ST_Y(location::geometry) AS lat,
              ST_X(location::geometry) AS lng,
              location_updated_at
         FROM captain_state
        WHERE captain_id = $1
          AND location IS NOT NULL`,
      [ride.captainId],
    );
    const row = rows[0];
    if (!row || row.lat == null || row.lng == null) {
      return { ...ride, captainDistanceM: null };
    }

    const ageS = row.location_updated_at
      ? (Date.now() - new Date(row.location_updated_at).getTime()) / 1000
      : Number.POSITIVE_INFINITY;
    if (ageS > env.RIDER_CAPTAIN_POSITION_MAX_AGE_S) {
      return { ...ride, captainDistanceM: null };
    }

    const lat = Number(row.lat);
    const lng = Number(row.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return { ...ride, captainDistanceM: null };
    }

    return {
      ...ride,
      captain: {
        ...ride.captain,
        location: { lat, lng, updatedAt: row.location_updated_at ?? new Date() },
      },
      // Crow-flies, deliberately: it needs no routing provider, costs nothing,
      // and is the honest version of an ETA. The app can render "à 1,2 km".
      captainDistanceM: Math.round(
        haversineM(lat, lng, ride.pickup.lat, ride.pickup.lng),
      ),
    };
  } catch (err) {
    // Optional telemetry must never take down the tracking screen — the same
    // rule the live meter follows a few lines below.
    // eslint-disable-next-line no-console
    console.warn('[rides] captain position unavailable', { rideId: (ride as any).id, err });
    return { ...ride, captainDistanceM: null };
  }
}

/**
 * Adds `captain` (and `vehicle`) onto a ride when one is assigned, so the
 * rider can see the driver's name + phone + plate at a glance and tap to
 * call. Private (used only by rider-facing endpoints).
 */
interface CaptainInfo {
  id: string;
  fullName: string | null;
  phone: string;
  ratingAvg: number;
  totalRides: number;
  vehicle: {
    plate: string;
    brand: string;
    model: string;
    color: string;
  } | null;
  /**
   * Live position, or null when there is none fresh enough to draw. Present
   * only while the ride is live — see enrichWithCaptainPosition.
   */
  location?: { lat: number; lng: number; updatedAt: Date } | null;
}

async function enrichWithCaptain<T extends { captainId: string | null }>(
  ride: T,
): Promise<T & { captain: CaptainInfo | null }> {
  if (!ride.captainId) return { ...ride, captain: null };
  const r = await pool.query<{
    id: string;
    full_name: string | null;
    phone: string;
    rating_avg: string;
    total_rides: number;
    plate: string | null;
    brand: string | null;
    model: string | null;
    color: string | null;
  }>(
    `SELECT u.id, u.full_name, u.phone,
            c.rating_avg, c.total_rides,
            v.plate, v.brand, v.model, v.color
       FROM users u
       JOIN captains c ON c.user_id = u.id
  LEFT JOIN vehicles v ON v.captain_id = c.user_id AND v.is_active = true
      WHERE u.id = $1`,
    [ride.captainId],
  );
  const row = r.rows[0];
  if (!row) return { ...ride, captain: null };
  return {
    ...ride,
    captain: {
      id: row.id,
      fullName: row.full_name,
      phone: row.phone,
      ratingAvg: Number(row.rating_avg),
      totalRides: row.total_rides,
      vehicle: row.plate
        ? { plate: row.plate, brand: row.brand!, model: row.model!, color: row.color! }
        : null,
    },
  };
}

/**
 * Adds `acceptances` — the list of every captain who tapped "Accepter" on the
 * ride, oldest first — onto a ride. Admin-only: it exposes captain contact
 * details (name + phone) so the operator can see who got the ride AND who else
 * wanted it (e.g. to re-assign by phone if the winner cancels). `isAssigned`
 * flags the captain that actually holds the ride (rides.captain_id).
 */
interface AcceptanceInfo {
  captainId: string;
  fullName: string | null;
  phone: string;
  acceptedAt: string;
  isAssigned: boolean;
}

async function enrichWithAcceptances<T extends { id: string; captainId: string | null }>(
  ride: T,
): Promise<T & { acceptances: AcceptanceInfo[] }> {
  const r = await pool.query<{
    id: string;
    full_name: string | null;
    phone: string;
    accepted_at: string;
  }>(
    `SELECT u.id, u.full_name, u.phone, ra.accepted_at
       FROM ride_acceptances ra
       JOIN users u ON u.id = ra.captain_id
      WHERE ra.ride_id = $1
      ORDER BY ra.accepted_at ASC`,
    [ride.id],
  );
  return {
    ...ride,
    acceptances: r.rows.map((row) => ({
      captainId: row.id,
      fullName: row.full_name,
      phone: row.phone,
      acceptedAt: row.accepted_at,
      isAssigned: row.id === ride.captainId,
    })),
  };
}

/**
 * Adds `rider` (the person the captain must call at pickup) onto a ride. For a
 * normal ride that's the booker; for a "course pour quelqu'un d'autre" it's the
 * passenger. Private — used only by captain-facing endpoints AFTER the captain
 * is assigned, so riders stay anonymous to captains while the ride is still in
 * the open inbox.
 */
interface RiderInfo {
  id: string;
  fullName: string | null;
  phone: string | null;
}

async function enrichWithBooker<
  T extends {
    bookerId: string;
    isForOther: boolean;
    passengerName: string | null;
    passengerPhone: string | null;
  },
>(ride: T): Promise<T & { rider: RiderInfo }> {
  if (ride.isForOther && ride.passengerPhone) {
    return {
      ...ride,
      rider: { id: ride.bookerId, fullName: ride.passengerName, phone: ride.passengerPhone },
    };
  }
  const r = await pool.query<{ full_name: string | null; phone: string | null }>(
    `SELECT full_name, phone FROM users WHERE id = $1`,
    [ride.bookerId],
  );
  const row = r.rows[0];
  return {
    ...ride,
    rider: { id: ride.bookerId, fullName: row?.full_name ?? null, phone: row?.phone ?? null },
  };
}

async function enrichWithPrivateDriverDetails<T extends { id: string; rideType: string }>(
  ride: T,
): Promise<T & { privateDriverDetails: { bookedDurationH: number; hourlyRateMru: number; bookedFareMru: number } | null }> {
  if (ride.rideType !== 'private_driver') return { ...ride, privateDriverDetails: null };
  const r = await pool.query<{
    booked_duration_h: number;
    hourly_rate_mru: number;
    booked_fare_mru: number;
  }>(`SELECT booked_duration_h, hourly_rate_mru, booked_fare_mru FROM private_driver_details WHERE ride_id = $1`,
    [ride.id]);
  const row = r.rows[0];
  return {
    ...ride,
    privateDriverDetails: row
      ? { bookedDurationH: row.booked_duration_h, hourlyRateMru: row.hourly_rate_mru, bookedFareMru: row.booked_fare_mru }
      : null,
  };
}

async function enrichWithConvoyageDetails<T extends { id: string; rideType: string }>(
  ride: T,
): Promise<T & { convoyageDetails: { vehiclePlate: string; vehicleDescription: string } | null }> {
  if (ride.rideType !== 'convoyage') return { ...ride, convoyageDetails: null };
  const r = await pool.query<{
    vehicle_plate: string;
    vehicle_description: string;
  }>(`SELECT vehicle_plate, vehicle_description FROM convoyage_details WHERE ride_id = $1`,
    [ride.id]);
  const row = r.rows[0];
  return {
    ...ride,
    convoyageDetails: row
      ? { vehiclePlate: row.vehicle_plate, vehicleDescription: row.vehicle_description }
      : null,
  };
}

async function enrichWithRoadsideAssistanceDetails<T extends { id: string; rideType: string }>(
  ride: T,
): Promise<T & { roadsideAssistanceDetails: { assistanceType: string; vehicleCondition: string | null } | null }> {
  if (ride.rideType !== 'roadside_assistance') return { ...ride, roadsideAssistanceDetails: null };
  const r = await pool.query<{
    assistance_type: string;
    vehicle_condition: string | null;
  }>(`SELECT assistance_type, vehicle_condition FROM roadside_assistance_details WHERE ride_id = $1`,
    [ride.id]);
  const row = r.rows[0];
  return {
    ...ride,
    roadsideAssistanceDetails: row
      ? { assistanceType: row.assistance_type, vehicleCondition: row.vehicle_condition }
      : null,
  };
}

async function enrichWithLightMovingDetails<T extends { id: string; rideType: string }>(
  ride: T,
): Promise<T & { lightMovingDetails: { itemDescription: string | null; estimatedWeightKg: number | null } | null }> {
  if (ride.rideType !== 'light_moving') return { ...ride, lightMovingDetails: null };
  const r = await pool.query<{
    item_description: string | null;
    estimated_weight_kg: number | null;
  }>(`SELECT item_description, estimated_weight_kg FROM light_moving_details WHERE ride_id = $1`,
    [ride.id]);
  const row = r.rows[0];
  return {
    ...ride,
    lightMovingDetails: row
      ? { itemDescription: row.item_description, estimatedWeightKg: row.estimated_weight_kg }
      : null,
  };
}

async function enrichWithIntercityFreightDetails<T extends { id: string; rideType: string }>(
  ride: T,
): Promise<T & { intercityFreightDetails: { cargoDescription: string | null; estimatedWeightKg: number | null; specialHandling: boolean } | null }> {
  if (ride.rideType !== 'intercity_freight') return { ...ride, intercityFreightDetails: null };
  const r = await pool.query<{
    cargo_description: string | null;
    estimated_weight_kg: number | null;
    special_handling: boolean;
  }>(`SELECT cargo_description, estimated_weight_kg, special_handling FROM intercity_freight_details WHERE ride_id = $1`,
    [ride.id]);
  const row = r.rows[0];
  return {
    ...ride,
    intercityFreightDetails: row
      ? { cargoDescription: row.cargo_description, estimatedWeightKg: row.estimated_weight_kg, specialHandling: row.special_handling }
      : null,
  };
}

async function enrichWithCarRentalDetails<T extends { id: string; rideType: string }>(
  ride: T,
): Promise<T & { carRentalDetails: { bookedDays: number; dailyRateMru: number; bookedFareMru: number } | null }> {
  if (ride.rideType !== 'car_rental') return { ...ride, carRentalDetails: null };
  const r = await pool.query<{
    booked_days: number;
    daily_rate_mru: number;
    booked_fare_mru: number;
  }>(`SELECT booked_days, daily_rate_mru, booked_fare_mru FROM car_rental_details WHERE ride_id = $1`,
    [ride.id]);
  const row = r.rows[0];
  return {
    ...ride,
    carRentalDetails: row
      ? { bookedDays: row.booked_days, dailyRateMru: row.daily_rate_mru, bookedFareMru: row.booked_fare_mru }
      : null,
  };
}

async function enrichWithEquipmentRentalDetails<T extends { id: string; rideType: string }>(
  ride: T,
): Promise<T & { equipmentRentalDetails: { equipmentType: string; bookedDays: number; dailyRateMru: number; bookedFareMru: number } | null }> {
  if (ride.rideType !== 'equipment_rental') return { ...ride, equipmentRentalDetails: null };
  const r = await pool.query<{
    equipment_type: string;
    booked_days: number;
    daily_rate_mru: number;
    booked_fare_mru: number;
  }>(`SELECT equipment_type, booked_days, daily_rate_mru, booked_fare_mru FROM equipment_rental_details WHERE ride_id = $1`,
    [ride.id]);
  const row = r.rows[0];
  return {
    ...ride,
    equipmentRentalDetails: row
      ? { equipmentType: row.equipment_type, bookedDays: row.booked_days, dailyRateMru: row.daily_rate_mru, bookedFareMru: row.booked_fare_mru }
      : null,
  };
}

async function enrichRideWithAllDetails<T extends { id: string; rideType: string }>(
  ride: T,
): Promise<T & {
  privateDriverDetails: any;
  convoyageDetails: any;
  roadsideAssistanceDetails: any;
  lightMovingDetails: any;
  intercityFreightDetails: any;
  carRentalDetails: any;
  equipmentRentalDetails: any;
}> {
  const withPd = await enrichWithPrivateDriverDetails(ride);
  const withConv = await enrichWithConvoyageDetails(withPd);
  const withRA = await enrichWithRoadsideAssistanceDetails(withConv);
  const withLM = await enrichWithLightMovingDetails(withRA);
  const withIF = await enrichWithIntercityFreightDetails(withLM);
  const withCR = await enrichWithCarRentalDetails(withIF);
  return enrichWithEquipmentRentalDetails(withCR);
}

export async function getCurrentRideForCaptain(captainId: string) {
  const r = await pool.query<RideRow>(
    `SELECT ${RIDE_COLUMNS} FROM rides
      WHERE captain_id = $1
        AND status IN ('accepted','arrived','in_progress')
      ORDER BY accepted_at DESC LIMIT 1`,
    [captainId],
  );
  if (!r.rows[0]) return null;
  const ride = shape(r.rows[0], { revealCode: true });
  const parts = await Promise.all([
    enrichWithBooker(ride),
    enrichRideWithAllDetails(ride),
    enrichWithLiveMeter(ride),
  ]);
  return mergeEnriched(ride, parts);
}

/**
 * Admin-wide list with optional filters. `status='active'` is a shortcut for
 * any ride still in progress (searching/accepted/arrived/in_progress).
 * `status='done'` covers terminal states. Otherwise we accept any concrete
 * RideStatus value.
 */
export async function listAdminRides(input: {
  status?: 'active' | 'done' | RideStatus;
  limit?: number;
  before?: Date; // cursor: only rides requested before this timestamp
}) {
  const limit = Math.min(input.limit ?? 50, 200);
  const wheres: string[] = [];
  const params: unknown[] = [];

  if (input.status === 'active') {
    wheres.push(
      `status IN ('pending_passenger_confirm','searching','accepted','arrived','in_progress')`,
    );
  } else if (input.status === 'done') {
    wheres.push(
      `status IN ('completed','cancelled_by_rider','cancelled_by_captain','cancelled_by_system','no_show')`,
    );
  } else if (input.status) {
    params.push(input.status);
    wheres.push(`status = $${params.length}`);
  }
  if (input.before) {
    params.push(input.before);
    wheres.push(`requested_at < $${params.length}`);
  }

  params.push(limit);
  const sql = `
    SELECT ${RIDE_COLUMNS}
      FROM rides
      ${wheres.length ? `WHERE ${wheres.join(' AND ')}` : ''}
     ORDER BY requested_at DESC
     LIMIT $${params.length}
  `;
  const r = await pool.query<RideRow>(sql, params);
  return r.rows.map((row) => shape(row));
}

/**
 * Rider rates the captain of a completed ride. Upserts into ratings (one row
 * per rider+ride pair) and recomputes the captain's running average.
 * Returns the captain's fresh aggregate so the client can confirm and show
 * a "thanks" toast.
 */
export async function rateCaptain(input: {
  rideId: string; riderId: string; stars: number; comment?: string;
}) {
  return withTx(async (client) => {
    // Lock + validate the ride.
    const rideRes = await client.query<RideRow>(
      `SELECT ${RIDE_COLUMNS} FROM rides WHERE id = $1 FOR UPDATE`,
      [input.rideId],
    );
    const ride = rideRes.rows[0];
    if (!ride) throw new HttpError(404, 'not_found', 'Ride not found');
    if (ride.booker_id !== input.riderId) {
      throw new HttpError(403, 'forbidden', 'Not your ride');
    }
    if (ride.status !== 'completed') {
      throw new HttpError(409, 'wrong_status', 'Only completed rides can be rated');
    }
    if (!ride.captain_id) {
      throw new HttpError(409, 'no_captain', 'Ride has no captain');
    }

    // Upsert the rating.
    await client.query(
      `INSERT INTO ratings (ride_id, rater_id, ratee_id, stars, comment)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (ride_id, rater_id)
       DO UPDATE SET stars = EXCLUDED.stars, comment = EXCLUDED.comment`,
      [input.rideId, input.riderId, ride.captain_id, input.stars, input.comment ?? null],
    );

    // Recompute the captain's running average from all their ratings.
    const agg = await client.query<{ avg: string; cnt: number }>(
      `SELECT COALESCE(AVG(stars), 0)::numeric(3,2) AS avg,
              COUNT(*)::int AS cnt
         FROM ratings WHERE ratee_id = $1`,
      [ride.captain_id],
    );
    const row = agg.rows[0]!;
    await client.query(
      `UPDATE captains SET rating_avg = $1, rating_count = $2 WHERE user_id = $3`,
      [row.avg, row.cnt, ride.captain_id],
    );

    return {
      stars: input.stars,
      captainRatingAvg: Number(row.avg),
      captainRatingCount: row.cnt,
    };
  });
}

/**
 * The captain rates the rider, after a completed ride.
 *
 * Mirror image of rateCaptain: same table, same guards, roles reversed. The
 * asymmetry it removes is not cosmetic — ride_insights already shows a captain
 * the rider's completion rate and no-show count while they decide whether to
 * accept, and until now the `avgRating` next to those numbers could only ever
 * be null.
 *
 * Kept deliberately separate from rateCaptain rather than generalised into one
 * "rate the other party" function: the two directions will diverge (a captain
 * rating should probably never be shown to the rider it describes, whereas the
 * captain's average is public), and a shared function would make that change
 * risky in both directions at once.
 */
export async function rateRider(input: {
  rideId: string; captainId: string; stars: number; comment?: string;
}) {
  return withTx(async (client) => {
    const rideRes = await client.query<RideRow>(
      `SELECT ${RIDE_COLUMNS} FROM rides WHERE id = $1 FOR UPDATE`,
      [input.rideId],
    );
    const ride = rideRes.rows[0];
    if (!ride) throw new HttpError(404, 'not_found', 'Ride not found');
    if (ride.captain_id !== input.captainId) {
      throw new HttpError(403, 'forbidden', 'Not your ride');
    }
    if (ride.status !== 'completed') {
      throw new HttpError(409, 'wrong_status', 'Only completed rides can be rated');
    }

    // The passenger may not be the booker ("course pour quelqu'un d'autre").
    // Rate the account that will book again — the booker — since that is the
    // one a future captain will be deciding about.
    const rateeId = ride.booker_id;

    await client.query(
      `INSERT INTO ratings (ride_id, rater_id, ratee_id, stars, comment)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (ride_id, rater_id)
       DO UPDATE SET stars = EXCLUDED.stars, comment = EXCLUDED.comment`,
      [input.rideId, input.captainId, rateeId, input.stars, input.comment ?? null],
    );

    // Recomputed rather than incremented, for the same reason as the captain
    // average: the upsert above allows an edit, and a running counter drifts the
    // moment one happens.
    const agg = await client.query<{ avg: string; cnt: number }>(
      `SELECT COALESCE(AVG(stars), 0)::numeric(3,2) AS avg,
              COUNT(*)::int AS cnt
         FROM ratings WHERE ratee_id = $1`,
      [rateeId],
    );
    const row = agg.rows[0] ?? { avg: '0', cnt: 0 };
    await client.query(
      `UPDATE users SET rating_avg = $1, rating_count = $2 WHERE id = $3`,
      [row.avg, row.cnt, rateeId],
    );

    return {
      stars: input.stars,
      riderRatingAvg: Number(row.avg),
      riderRatingCount: row.cnt,
    };
  });
}

/**
 * Returns true if the given rider has already rated the given ride.
 */
export async function hasRated(rideId: string, riderId: string): Promise<boolean> {
  const r = await pool.query(
    `SELECT 1 FROM ratings WHERE ride_id = $1 AND rater_id = $2 LIMIT 1`,
    [rideId, riderId],
  );
  return r.rowCount! > 0;
}

export async function listRiderHistory(userId: string, limit = 30) {
  const r = await pool.query<RideRow>(
    `SELECT ${RIDE_COLUMNS} FROM rides
      WHERE booker_id = $1
      ORDER BY requested_at DESC LIMIT $2`,
    [userId, limit],
  );
  return r.rows.map((row) => shape(row));
}

export async function listCaptainHistory(captainId: string, limit = 30) {
  // Resolve the booker's name/phone in the SAME query via a LATERAL join
  // instead of one follow-up `enrichWithBooker` query per row. This endpoint
  // is polled every few seconds by every online captain, so collapsing the
  // 1+N round-trips into a single query is a real, cumulative latency win.
  // The LATERAL derived table only exposes full_name/phone, so `RIDE_COLUMNS`'
  // bare `id` stays unambiguous.
  const r = await pool.query<
    RideRow & { booker_full_name: string | null; booker_phone: string | null }
  >(
    `SELECT ${RIDE_COLUMNS},
            bu.full_name AS booker_full_name,
            bu.phone     AS booker_phone
       FROM rides
  LEFT JOIN LATERAL (
         SELECT full_name, phone FROM users WHERE id = rides.booker_id
       ) bu ON true
      WHERE rides.captain_id = $1
      ORDER BY requested_at DESC LIMIT $2`,
    [captainId, limit],
  );
  return r.rows.map((row) => {
    // Mirror enrichWithBooker: for a "course pour quelqu'un d'autre" the person
    // the captain calls is the passenger, otherwise it's the booker.
    const rider =
      row.is_for_other && row.passenger_phone
        ? { id: row.booker_id, fullName: row.passenger_name, phone: row.passenger_phone }
        : { id: row.booker_id, fullName: row.booker_full_name, phone: row.booker_phone };
    return { ...shape(row), rider };
  });
}

// ────────────────────────────────────────────────────────────────────────────
// State transitions — all use SELECT FOR UPDATE for atomicity.

async function lockRide(client: pg.PoolClient, rideId: string): Promise<RideRow> {
  const r = await client.query<RideRow>(
    `SELECT ${RIDE_COLUMNS} FROM rides WHERE id = $1 FOR UPDATE`,
    [rideId],
  );
  if (!r.rows[0]) throw new HttpError(404, 'not_found', 'Ride not found');
  return r.rows[0];
}

/**
 * Re-push the "new ride" notification to currently-eligible captains for a
 * ride still in 'searching'. No state change — just another broadcast for an
 * operator that calls back asking why no captain has accepted yet.
 */
export async function rebroadcastRide(rideId: string): Promise<{ captainsNotified: number }> {
  const r = await pool.query<{ status: RideStatus; ride_type: RideType; fare_estimate_mru: number | null }>(
    `SELECT status, ride_type, fare_estimate_mru FROM rides WHERE id = $1`,
    [rideId],
  );
  const ride = r.rows[0];
  if (!ride) throw new HttpError(404, 'not_found', 'Ride not found');
  if (ride.status !== 'searching') {
    throw new HttpError(409, 'not_searching',
      `Ride is ${ride.status}, only 'searching' rides can be rebroadcast`);
  }
  const captainIds = await eligibleCaptainsForRide(rideId);
  if (captainIds.length > 0) {
    await notifyCaptainsNewRide(captainIds, {
      id: rideId,
      rideType: ride.ride_type,
      fareEstimateMru: ride.fare_estimate_mru,
    });
  }
  return { captainsNotified: captainIds.length };
}

/**
 * Name + vehicle of a captain, for the rider-facing notification copy.
 *
 * Best-effort by design: a notification that says "Votre Captain arrive" is far
 * better than no notification because a vehicle row was missing. Any failure
 * degrades to nulls rather than propagating — the caller is already outside the
 * transaction and must not be able to undo a committed ride.
 */
async function captainDisplayInfo(
  captainId: string,
): Promise<{ captainName: string | null; vehicle: string | null }> {
  try {
    const { rows } = await pool.query<{
      full_name: string | null;
      plate: string | null;
      brand: string | null;
      model: string | null;
      color: string | null;
    }>(
      `SELECT u.full_name, v.plate, v.brand, v.model, v.color
         FROM users u
         JOIN captains c ON c.user_id = u.id
    LEFT JOIN vehicles v ON v.captain_id = c.user_id AND v.is_active = true
        WHERE u.id = $1`,
      [captainId],
    );
    const row = rows[0];
    if (!row) return { captainName: null, vehicle: null };
    const vehicle = [row.brand, row.model, row.color].filter(Boolean).join(' ').trim();
    const plate = row.plate ? ` (${row.plate})` : '';
    return {
      captainName: row.full_name,
      vehicle: vehicle ? `${vehicle}${plate}` : (row.plate ?? null),
    };
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[rides] could not read captain display info', { captainId, err });
    return { captainName: null, vehicle: null };
  }
}

/**
 * Tell the rider a captain is on the way. Runs AFTER the transaction commits,
 * for the same reason the captain broadcast does: a notification fired from
 * inside `withTx` describes a state that another query may still roll back.
 *
 * Errors are swallowed here rather than at the call site so every future
 * rider-notification point gets the same guarantee for free.
 */
async function notifyRiderAccepted(ride: {
  id: string;
  bookerId: string;
  captainId: string;
}): Promise<void> {
  try {
    const info = await captainDisplayInfo(ride.captainId);
    await notifyRiderRideAccepted(ride.bookerId, { id: ride.id, ...info });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[rides] rider accept notification failed', { rideId: ride.id, err });
  }
}

/**
 * Reasons acceptRide can refuse a tap, as a closed set. Anything outside it is
 * folded into 'other' before becoming a Prometheus label: an unbounded label
 * value is how a metrics endpoint turns into a memory leak, and error codes are
 * exactly the kind of thing that grows over time without anyone revisiting this
 * file.
 *
 * Reading them: 'not_searching' climbing means captains are racing for the same
 * rides (a dispatch problem — broadcast is too wide). 'balance_too_low' climbing
 * means captains cannot afford to work (a wallet/top-up problem).
 */
const ACCEPT_REJECT_REASONS = new Set([
  'not_searching',
  'balance_too_low',
  'captain_busy',
  'not_captain',
  'colis_not_allowed',
  'passenger_not_allowed',
]);

export async function acceptRide(rideId: string, captainId: string) {
  try {
    const accepted = await withTx(async (client) => {
      const ride = await lockRide(client, rideId);

      if (ride.status !== 'searching') {
        throw new HttpError(409, 'not_searching',
          `Ride is ${ride.status}, cannot accept`);
      }

      // Balance gate: captain cannot accept rides below the minimum threshold.
      const balance = await getBalance(captainId);
      if (balance < env.MIN_BALANCE_TO_GO_ONLINE_MRU) {
        throw new HttpError(402, 'balance_too_low',
          `Solde insuffisant pour accepter une course (min ${env.MIN_BALANCE_TO_GO_ONLINE_MRU} MRU, actuel ${balance} MRU)`,
          { balance, minRequired: env.MIN_BALANCE_TO_GO_ONLINE_MRU });
      }

      // Captain must not have another active ride.
      const busy = await client.query(
        `SELECT 1 FROM rides
          WHERE captain_id = $1
            AND status IN ('accepted','arrived','in_progress')
          LIMIT 1`,
        [captainId],
      );
      if ((busy.rowCount ?? 0) > 0) {
        throw new HttpError(409, 'captain_busy',
          'You already have an active ride');
      }

      const cap = await client.query<{ accepts_colis: boolean; vehicle_type: 'car' | 'moto' }>(
        `SELECT accepts_colis, vehicle_type FROM captains WHERE user_id = $1`,
        [captainId],
      );
      const captain = cap.rows[0];
      if (!captain) {
        throw new HttpError(404, 'not_captain', 'Captain not found');
      }

      // Vehicle gate:
      // - moto captains can only accept colis
      // - car captains can accept colis only when opted in
      if (ride.ride_type === 'colis') {
        if (captain.vehicle_type === 'car' && !captain.accepts_colis) {
          throw new HttpError(403, 'colis_not_allowed',
            "Vous n'acceptez pas les courses colis");
        }
      } else if (captain.vehicle_type !== 'car') {
        throw new HttpError(403, 'passenger_not_allowed',
          'Les motos ne peuvent pas accepter les courses Clients');
      }

      const upd = await client.query<RideRow>(
        `UPDATE rides
            SET captain_id = $1,
                status = 'accepted',
                accepted_at = now()
          WHERE id = $2
        RETURNING ${RIDE_COLUMNS}`,
        [captainId, rideId],
      );

      // Log the winning acceptance. Committed atomically with the assignment so
      // the ride's captain_id always has a matching ride_acceptances row.
      await client.query(
        `INSERT INTO ride_acceptances (ride_id, captain_id)
         VALUES ($1, $2)
         ON CONFLICT (ride_id, captain_id) DO NOTHING`,
        [rideId, captainId],
      );

      // Mark captain on_ride.
      await client.query(
        `UPDATE captain_state SET presence = 'on_ride', updated_at = now()
          WHERE captain_id = $1`,
        [captainId],
      );

      // Colis: notify the recipient that a courier is on the way.
      if (ride.ride_type === 'colis') {
        const colis = await client.query<{ recipient_phone: string; recipient_name: string }>(
          `SELECT recipient_phone, recipient_name FROM colis_details WHERE ride_id = $1`,
          [ride.id],
        );
        if (colis.rows[0]) {
          await sms.send(
            colis.rows[0].recipient_phone,
            `Tewiz Colis: un livreur est en route avec votre colis.`,
          );
        }
      }

      return shape(upd.rows[0]!, { revealCode: true });
    });
    // Recorded only after withTx has COMMITTED. Counting inside the transaction
    // would inflate both the match count and the time-to-match histogram every
    // time a commit failed, and a histogram cannot be decremented.
    recordMatch(accepted.rideType, accepted.requestedAt);
    // Fire-and-forget: the captain's tap must not wait on Expo, and a dead push
    // service must never cost a match.
    void notifyRiderAccepted({
      id: accepted.id,
      bookerId: accepted.bookerId,
      captainId,
    });
    return accepted;
  } catch (err) {
    if (err instanceof HttpError) {
      const reason = ACCEPT_REJECT_REASONS.has(err.code) ? err.code : 'other';
      rideAcceptRejected.inc({ reason });
    }
    // The captain lost the race: another captain accepted a heartbeat earlier,
    // so the ride is no longer 'searching' and the transaction above rolled
    // back. We still record this captain's interest (outside the rolled-back tx)
    // so the operator sees everyone who wanted the ride, then surface the 409.
    if (err instanceof HttpError && err.code === 'not_searching') {
      await recordLateAcceptance(rideId, captainId);
    }
    throw err;
  }
}

/**
 * Best-effort log of an acceptance tap that arrived after the ride was already
 * claimed by another captain. Runs on its own connection because the caller's
 * transaction has rolled back. Failures here must never mask the original 409,
 * so any error is swallowed. Recorded only when the ride is genuinely taken by
 * someone else (accepted/arrived/in_progress) — not when it was cancelled or
 * completed.
 */
async function recordLateAcceptance(rideId: string, captainId: string): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO ride_acceptances (ride_id, captain_id)
       SELECT $1, $2
         FROM rides
        WHERE id = $1
          AND captain_id IS NOT NULL
          AND captain_id <> $2
          AND status IN ('accepted','arrived','in_progress')
       ON CONFLICT (ride_id, captain_id) DO NOTHING`,
      [rideId, captainId],
    );
  } catch (e) {
    console.error('[rides] failed to record late acceptance', { rideId, captainId, e });
  }
}

export async function arriveRide(rideId: string, captainId: string) {
  const arrived = await withTx(async (client) => {
    const ride = await lockRide(client, rideId);
    if (ride.captain_id !== captainId) {
      throw new HttpError(403, 'forbidden', 'Not your ride');
    }
    if (ride.status !== 'accepted') {
      throw new HttpError(409, 'wrong_status',
        `Ride is ${ride.status}, cannot mark arrived`);
    }
    const nextStatus: RideStatus = (ride.is_open || ride.ride_type === 'private_driver') ? 'in_progress' : 'arrived';
    const upd = await client.query<RideRow>(
      `UPDATE rides
          SET status = $2::ride_status,
              arrived_at = now(),
              started_at = CASE
                WHEN $2::ride_status = 'in_progress'::ride_status THEN now()
                ELSE started_at
              END
        WHERE id = $1
      RETURNING ${RIDE_COLUMNS}`,
      [rideId, nextStatus],
    );
    return shape(upd.rows[0]!, { revealCode: true });
  });

  // Tell the rider their captain is waiting — but only on the real "I'm at the
  // pickup, come out" transition. Open and private-driver rides use `arrive` as
  // a shortcut straight into `in_progress`: there the rider is already in the
  // car, and a "votre Captain est arrivé" push after the meter starts is noise.
  // Noise is how a notification channel gets muted, which would cost us the
  // alerts that do matter.
  if (arrived.status === 'arrived') {
    void (async () => {
      try {
        const info = await captainDisplayInfo(captainId);
        await notifyRiderCaptainArrived(arrived.bookerId, {
          id: arrived.id,
          captainName: info.captainName,
        });
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('[rides] rider arrival notification failed', { rideId, err });
      }
    })();
  }

  return arrived;
}

export async function startRide(rideId: string, captainId: string) {
  return withTx(async (client) => {
    const ride = await lockRide(client, rideId);
    if (ride.captain_id !== captainId) {
      throw new HttpError(403, 'forbidden', 'Not your ride');
    }
    if (ride.status !== 'arrived') {
      throw new HttpError(409, 'wrong_status',
        `Captain must mark arrived first (current: ${ride.status})`);
    }
    const upd = await client.query<RideRow>(
      `UPDATE rides
          SET status = 'in_progress', started_at = now()
        WHERE id = $1
      RETURNING ${RIDE_COLUMNS}`,
      [rideId],
    );
    return shape(upd.rows[0]!, { revealCode: true });
  });
}

interface CompleteInput {
  rideId: string;
  captainId: string;
  actualDistanceM?: number;
  actualDurationS?: number;
}

type GpsPenaltyAction = 'warning_1' | 'warning_2' | 'double_commission' | 'recovery_suspend';

interface GpsPenaltyResult {
  violation: boolean;
  offenseNumber: number;
  action: GpsPenaltyAction;
  chargedCommissionMru: number;
  recoveryDebitMru: number;
  suspendCaptain: boolean;
}

async function evaluateClosedRideGpsViolation(input: {
  client: pg.PoolClient;
  rideId: string;
  startedAt: Date;
  captainId: string;
  baseCommissionMru: number;
  severeModeEnabled?: boolean;
  enforceCancellationContext?: boolean;
}): Promise<GpsPenaltyResult | null> {
  const {
    client,
    rideId,
    startedAt,
    captainId,
    baseCommissionMru,
    severeModeEnabled = true,
    enforceCancellationContext = false,
  } = input;

  if (!severeModeEnabled) return null;

  const gps = await client.query<{ samples: string; last_recorded: Date | null }>(
    `SELECT COUNT(*)::text AS samples,
            MAX(recorded_at) AS last_recorded
       FROM ride_locations
      WHERE ride_id = $1
        AND recorded_at >= ($2::timestamptz - interval '10 seconds')`,
    [rideId, startedAt],
  );
  const samples = Number(gps.rows[0]?.samples ?? 0);
  const lastRecorded = gps.rows[0]?.last_recorded ?? null;
  const durationS = Math.max(0, Math.round((Date.now() - startedAt.getTime()) / 1000));
  const lastAgeS = lastRecorded
    ? Math.max(0, Math.round((Date.now() - lastRecorded.getTime()) / 1000))
    : Number.POSITIVE_INFINITY;

  // Non-open rides should still stream GPS while in_progress. If telemetry is
  // missing/sparse/stale, treat it as a potential GPS tampering attempt.
  const missingTelemetry = samples === 0
    || (durationS >= 180 && samples < 2)
    || (durationS >= 300 && lastAgeS > 180);
  if (!missingTelemetry) return null;

  if (enforceCancellationContext) {
    const cancelCtx = await client.query<{ id: string; cancelled_at: Date; near_destination: boolean }>(
      `WITH latest AS (
         SELECT e.id, e.cancelled_at, e.cancel_dropoff
           FROM captain_cancel_events e
          WHERE e.captain_id = $1
            AND e.resolved_at IS NULL
            AND e.cancelled_at >= (now() - interval '6 hours')
          ORDER BY e.cancelled_at DESC
          LIMIT 1
       ),
       no_replacement AS (
         SELECT l.id
           FROM latest l
          WHERE NOT EXISTS (
            SELECT 1
              FROM rides r2
             WHERE r2.captain_id = $1
               AND r2.accepted_at IS NOT NULL
               AND r2.accepted_at > l.cancelled_at
               AND r2.id <> $2
               AND l.cancel_dropoff IS NOT NULL
               AND r2.dropoff_location IS NOT NULL
               AND ST_DWithin(r2.dropoff_location, l.cancel_dropoff, 500)
          )
       )
       SELECT l.id,
              l.cancelled_at,
              EXISTS (
                SELECT 1
                  FROM ride_locations rl
                 WHERE rl.ride_id = $2
                   AND rl.recorded_at >= ($3::timestamptz - interval '10 seconds')
                   AND l.cancel_dropoff IS NOT NULL
                   AND ST_DWithin(rl.point, l.cancel_dropoff, 500)
                 LIMIT 1
              ) AS near_destination
         FROM latest l
         JOIN no_replacement nr ON nr.id = l.id`,
      [captainId, rideId, startedAt],
    );

    const ctx = cancelCtx.rows[0];
    if (!ctx?.near_destination) return null;

    await client.query(
      `UPDATE captain_cancel_events
          SET resolved_at = now()
        WHERE id = $1`,
      [Number(ctx.id)],
    );
  }

  const countRes = await client.query<{ n: string }>(
    `SELECT COUNT(*)::text AS n
       FROM captain_gps_violations
      WHERE captain_id = $1`,
    [captainId],
  );
  const offenseNumber = Number(countRes.rows[0]?.n ?? 0) + 1;

  let action: GpsPenaltyAction;
  let chargedCommissionMru = baseCommissionMru;
  let recoveryDebitMru = 0;
  let suspendCaptain = false;

  if (offenseNumber === 1) {
    action = 'warning_1';
  } else if (offenseNumber === 2) {
    action = 'warning_2';
  } else if (offenseNumber === 3) {
    action = 'double_commission';
    chargedCommissionMru = baseCommissionMru * 2;
  } else {
    action = 'recovery_suspend';
    suspendCaptain = true;

    const firstThree = await client.query<{ id: string; base_commission_mru: number }>(
      `SELECT id, base_commission_mru
         FROM captain_gps_violations
        WHERE captain_id = $1
          AND recovered_at IS NULL
        ORDER BY created_at ASC
        LIMIT 3
        FOR UPDATE`,
      [captainId],
    );
    recoveryDebitMru = firstThree.rows
      .reduce((sum, row) => sum + Number(row.base_commission_mru ?? 0), 0);

    if (firstThree.rows.length > 0) {
      await client.query(
        `UPDATE captain_gps_violations
            SET recovered_at = now()
          WHERE id = ANY($1::bigint[])`,
        [firstThree.rows.map((r) => Number(r.id))],
      );
    }
  }

  await client.query(
    `INSERT INTO captain_gps_violations
       (captain_id, ride_id, base_commission_mru, charged_commission_mru, action)
     VALUES ($1, $2, $3, $4, $5)`,
    [captainId, rideId, baseCommissionMru, chargedCommissionMru, action],
  );

  return {
    violation: true,
    offenseNumber,
    action,
    chargedCommissionMru,
    recoveryDebitMru,
    suspendCaptain,
  };
}

export const __test__ = {
  evaluateClosedRideGpsViolation,
};

export async function completeRide(input: CompleteInput) {
  const result = await withTx(async (client) => {
    const settings = await getPricingSettings();
    const ride = await lockRide(client, input.rideId);
    if (ride.captain_id !== input.captainId) {
      throw new HttpError(403, 'forbidden', 'Not your ride');
    }
    if (ride.status !== 'in_progress') {
      throw new HttpError(409, 'wrong_status',
        `Ride is ${ride.status}, cannot complete`);
    }

    // For colis rides: mark the delivery as confirmed on completion.
    if (ride.ride_type === 'colis') {
      await client.query(
        `UPDATE colis_details SET recipient_confirmed_at = now() WHERE ride_id = $1`,
        [ride.id],
      );
    }

    let finalDistanceM: number;
    let finalDurationS: number | null;
    let fareFinalMru: number;
    let finalDropoff: { lat: number; lng: number } | null = null;

    if (ride.is_open) {
      // Open ride: distance is summed from accepted GPS pings; duration is
      // wall-clock from started_at → now (the captain just pressed "End").
      // The captain's reported distance is ignored on purpose — the whole
      // point of the metered ride is that the rider trusts the server, not
      // the captain's app.
      if (!ride.started_at) {
        throw new HttpError(409, 'not_started',
          'Cannot complete an open ride that never started');
      }
      finalDistanceM = await computeDistanceM(client, ride.id);
      finalDurationS = Math.max(0, Math.round((Date.now() - ride.started_at.getTime()) / 1000));
      const tariff: OpenTariff = {
        baseFareMru: ride.open_base_fare_mru!,
        perKmMru: ride.open_per_km_mru!,
        perMinuteMru: ride.open_per_minute_mru!,
        minFareMru: ride.open_min_fare_mru!,
      };
      fareFinalMru = openFareMru(tariff, finalDistanceM, finalDurationS, {
        enabled: settings.nightPricingEnabled,
        multiplier: settings.nightPriceMultiplier,
        startHour: settings.nightPriceStartHour,
        endHour: settings.nightPriceEndHour,
      });
      finalDropoff = await lastTrailPoint(client, ride.id);
    } else if (ride.ride_type === 'private_driver') {
      if (!ride.started_at) {
        throw new HttpError(409, 'not_started',
          'Cannot complete a private driver ride that never started');
      }
      const pd = await client.query<{
        booked_duration_h: number;
        hourly_rate_mru: number;
      }>(`SELECT booked_duration_h, hourly_rate_mru FROM private_driver_details WHERE ride_id = $1`,
        [ride.id]);
      if (!pd.rows[0]) throw new HttpError(500, 'missing_details', 'Private driver details missing');
      const { booked_duration_h, hourly_rate_mru } = pd.rows[0];
      finalDurationS = Math.max(0, Math.round((Date.now() - ride.started_at.getTime()) / 1000));
      finalDistanceM = 0;
      fareFinalMru = privateDriverFinalFareMru(
        hourly_rate_mru,
        booked_duration_h,
        finalDurationS,
        {
          enabled: settings.nightPricingEnabled,
          multiplier: settings.nightPriceMultiplier,
          startHour: settings.nightPriceStartHour,
          endHour: settings.nightPriceEndHour,
        },
      );
    } else {
      // Fixed-fare ride: keep the legacy behaviour. If the captain reports
      // an actual distance, recompute the fare; otherwise charge the upfront
      // estimate (what the rider was quoted at booking).
      finalDistanceM = input.actualDistanceM ?? ride.distance_m ?? 0;
      finalDurationS = input.actualDurationS ?? null;
      fareFinalMru = Number(ride.fare_estimate_mru ?? 0);
      if (input.actualDistanceM && input.actualDistanceM !== ride.distance_m) {
        const { estimateFareMru: estimate } = await import('./pricing.js');
        const { fareMru } = await estimate(
          input.actualDistanceM / env.ROUTE_MULTIPLIER,
          ride.ride_type,
        );
        fareFinalMru = fareMru;
      }
    }

    const baseCommission = commissionMru(fareFinalMru, ride.commission_rate_bps);

    // Captain free day (migration 0086): the captain keeps the whole fare
    // today. Decided server-side — old app builds get it exactly the same.
    // Resolved before the bonus so a free ride never eats into the bonus
    // counter: the captain paid nothing, so nothing accumulates.
    const freeDay = await resolveFreeDayOnCompletion(client, input.captainId);

    // Captain bonus (migration 0028): if the captain currently has an active
    // bonus, halve the commission; otherwise accumulate towards the threshold.
    // Runs inside the same tx so the wallet debit and bonus state stay aligned.
    const bonus = freeDay.isFreeToday
      ? { effectiveCommissionMru: 0, bonusApplied: false, bonusJustEarned: false, bonusUntil: null }
      : await applyBonusOnCompletion(client, input.captainId, baseCommission);
    const baselineCommission = bonus.effectiveCommissionMru;
    // A GPS penalty doubles the commission — on a free day the base is 0, so
    // it stays 0. We still run the evaluation: the offense must be recorded
    // and a repeat offender still gets suspended, free day or not.
    const gpsPenalty = !ride.is_open && ride.ride_type !== 'private_driver' && ride.started_at
      ? await evaluateClosedRideGpsViolation({
          client,
          rideId: ride.id,
          startedAt: ride.started_at,
          captainId: input.captainId,
          baseCommissionMru: baselineCommission,
          severeModeEnabled: settings.gpsFraudSevereMode,
          enforceCancellationContext: true,
        })
      : null;
    const commission = freeDay.isFreeToday
      ? 0
      : gpsPenalty?.chargedCommissionMru ?? baselineCommission;

    // Debit the captain wallet for the commission (atomically inside this tx).
    // When commission is 0 (e.g. admin set rate to 0%), there's nothing to debit;
    // skip the wallet write so we don't hit the "amount must be positive" guard.
    const debit = commission > 0
      ? await debitWallet({
          captainId: input.captainId,
          amountMru: commission,
          type: 'commission',
          rideId: ride.id,
          reason: gpsPenalty?.action === 'double_commission'
            ? `GPS off/tampering penalty: double commission on ride ${ride.id}`
            : bonus.bonusApplied
            ? `Commission ${(ride.commission_rate_bps / 100).toFixed(2)}% ÷2 (bonus) on ride ${ride.id}`
            : `Commission ${(ride.commission_rate_bps / 100).toFixed(2)}% on ride ${ride.id}`,
        }, client)
      : { transactionId: null, balanceAfter: await (async () => {
          const r = await client.query<{ balance_mru: string }>(
            `SELECT balance_mru FROM wallets WHERE captain_id = $1`,
            [input.captainId],
          );
          return r.rows[0] ? Number(r.rows[0].balance_mru) : 0;
        })() };

    let balanceAfter = debit.balanceAfter;

    if ((gpsPenalty?.recoveryDebitMru ?? 0) > 0) {
      const recovery = await debitWallet({
        captainId: input.captainId,
        amountMru: gpsPenalty!.recoveryDebitMru,
        type: 'manual_adjustment',
        rideId: ride.id,
        reason: `GPS fraud recovery after repeated violation (ride ${ride.id})`,
      }, client);
      balanceAfter = recovery.balanceAfter;
    }

    const upd = await client.query<RideRow>(
      `UPDATE rides
          SET status = 'completed',
              completed_at = now(),
              fare_final_mru = $1,
              commission_mru = $2,
              distance_m = $3,
              duration_s = $4,
              commission_bonus_applied = $5,
              commission_free_day = $10,
              -- For open rides we write the last GPS point as the dropoff so
              -- the post-trip map / history still has a clean from→to to
              -- render. CASE-guarded so closed rides are untouched.
              dropoff_location = CASE
                WHEN $7::float8 IS NOT NULL AND $8::float8 IS NOT NULL
                THEN ST_SetSRID(ST_MakePoint($7, $8), 4326)::geography
                ELSE dropoff_location
              END,
              dropoff_label = CASE
                WHEN $7::float8 IS NOT NULL AND $8::float8 IS NOT NULL
                THEN COALESCE(dropoff_label, $9)
                ELSE dropoff_label
              END
        WHERE id = $6
      RETURNING ${RIDE_COLUMNS}`,
      [
        fareFinalMru, commission, finalDistanceM, finalDurationS,
        bonus.bonusApplied, ride.id,
        finalDropoff?.lng ?? null,
        finalDropoff?.lat ?? null,
        finalDropoff ? 'Fin de course' : null,
        freeDay.isFreeToday,
      ],
    );

    if (gpsPenalty?.suspendCaptain) {
      await client.query(
        `UPDATE captains
            SET status = 'suspended',
                suspended_reason = 'Fraude GPS repetee (course non ouverte)',
                suspended_until = NULL
          WHERE user_id = $1`,
        [input.captainId],
      );
      await client.query(
        `UPDATE captain_state SET presence = 'offline', updated_at = now()
          WHERE captain_id = $1`,
        [input.captainId],
      );
    } else {
      // Captain goes back to "online".
      await client.query(
        `UPDATE captain_state SET presence = 'online', updated_at = now()
          WHERE captain_id = $1`,
        [input.captainId],
      );
    }

    // Fire-and-forget notification when the captain just earned the bonus.
    // Outside the wallet write so a notification hiccup never rolls back
    // the ride completion.
    if (bonus.bonusJustEarned && bonus.bonusUntil) {
      void notifyCaptainBonusEarned(input.captainId, bonus.bonusUntil);
    }

    // Same treatment when this completion happened to draw the captain's free
    // days for the week (the daily job hadn't run yet): tell them right away.
    if (freeDay.newlyDrawn.length > 0) {
      void notifyCaptainFreeDays(input.captainId, freeDay.newlyDrawn);
    }

    return {
      ride: shape(upd.rows[0]!, { revealCode: true }),
      commissionMru: commission,
      captainBalanceAfter: balanceAfter,
      gpsCompliance: gpsPenalty
        ? {
            offenseNumber: gpsPenalty.offenseNumber,
            action: gpsPenalty.action,
            recoveryDebitMru: gpsPenalty.recoveryDebitMru,
            suspended: gpsPenalty.suspendCaptain,
          }
        : null,
    };
  });

  // Partner commission sharing (migration 0041) — strictly best-effort and
  // AFTER the completion committed: the captain's payment can never be
  // blocked by an attribution problem. The earnings ledger is idempotent
  // (UNIQUE ride/partner/role), so a failed attempt can be replayed safely.
  try {
    await applyPartnerAttributionOnCompletion(result.ride.id);
  } catch (e: any) {
    console.warn('[partners] attribution failed after ride completion', {
      rideId: result.ride.id,
      error: e?.message ?? String(e),
    });
  }

  return result;
}

interface CancelInput {
  rideId: string;
  userId: string;
  role: 'rider' | 'captain';
  reason: string;
}

export async function cancelRide(input: CancelInput) {
  // A box rather than a plain `let`: TypeScript does not track assignments made
  // inside a callback, so a `let … = null` would be narrowed to `null` here and
  // the broadcast below would look like dead code.
  const pending: { value: RideRow | null } = { value: null };

  const result = await withTx(async (client) => {
    const ride = await lockRide(client, input.rideId);

    // Authorization
    if (input.role === 'rider' && ride.booker_id !== input.userId) {
      throw new HttpError(403, 'forbidden', 'Not your ride');
    }
    if (input.role === 'captain' && ride.captain_id !== input.userId) {
      throw new HttpError(403, 'forbidden', 'Not your ride');
    }

    // For an open ride the rider is in the car and the meter is running, so
    // only the captain can end it (whether via /complete or /cancel). The
    // rider can still cancel BEFORE a captain accepts (status='searching').
    if (
      input.role === 'rider'
      && (ride.is_open || ride.ride_type === 'private_driver')
      && ride.status !== 'searching'
    ) {
      throw new HttpError(403, 'rider_cancel_open_forbidden',
        'Cette course ne peut être annulée que par le Captain');
    }

    if (!['searching', 'accepted', 'arrived'].includes(ride.status)) {
      throw new HttpError(409, 'wrong_status',
        `Cannot cancel from ${ride.status}`);
    }

    // ── Captain cancels a ride they had accepted (accepted or arrived) ──
    // Don't kill the ride: put it back into 'searching' so other nearby
    // captains can take over. The cancelling captain is added to the
    // ride_declines table so they won't be re-notified for the same ride.
    // The trip that the rider booked is preserved.
    if (
      input.role === 'captain'
      && ride.captain_id === input.userId
      && (ride.status === 'accepted' || ride.status === 'arrived')
    ) {
      // How often has this captain done this lately? Read BEFORE writing the
      // new event so the current cancellation is not counted against itself.
      const recent = await client.query<{ n: string }>(
        `SELECT COUNT(*)::text AS n
           FROM captain_cancel_events
          WHERE captain_id = $1
            AND cancelled_at >= now() - make_interval(hours => $2)`,
        [input.userId, env.CAPTAIN_CANCEL_WINDOW_H],
      );
      const priorCancellations = Number(recent.rows[0]?.n ?? 0);
      const overLimit = priorCancellations >= env.CAPTAIN_CANCEL_LIMIT;

      const upd = await client.query<RideRow>(
        `UPDATE rides
            SET captain_id   = NULL,
                status       = 'searching',
                accepted_at  = NULL,
                arrived_at   = NULL,
                last_captain_cancel_reason = $2,
                last_captain_cancel_at     = now()
          WHERE id = $1
        RETURNING ${RIDE_COLUMNS}`,
        [ride.id, input.reason],
      );

      // The cancelling captain leaves the ride. Normally they go straight back
      // to 'online'; past the limit they are sent 'offline' for a cooldown so
      // they stop occupying the dispatch queue for a while. Recorded as having
      // declined this specific ride either way, so the dispatcher and the alert
      // modal both skip them on the re-broadcast.
      await client.query(
        `UPDATE captain_state
            SET presence = $2::captain_presence, updated_at = now()
          WHERE captain_id = $1 AND presence = 'on_ride'`,
        [input.userId, overLimit ? 'offline' : 'online'],
      );
      if (overLimit) {
        // Drop them from the live geo index too, or `redis` dispatch mode would
        // keep offering rides to a captain Postgres considers offline.
        void clearLiveLocation(input.userId).catch(() => {});
      }
      await client.query(
        `INSERT INTO ride_declines (ride_id, captain_id)
         VALUES ($1, $2)
         ON CONFLICT (ride_id, captain_id) DO NOTHING`,
        [ride.id, input.userId],
      );
      await client.query(
        `INSERT INTO captain_cancel_events (captain_id, ride_id, cancel_dropoff)
         VALUES (
           $1,
           $2,
           CASE
             WHEN $3::float8 IS NULL OR $4::float8 IS NULL THEN NULL
             ELSE ST_SetSRID(ST_MakePoint($3, $4), 4326)::geography
           END
         )
         ON CONFLICT (ride_id) DO NOTHING`,
        [input.userId, ride.id, ride.dropoff_lng, ride.dropoff_lat],
      );

      // Re-broadcast to every other eligible captain, after the tx commits so we
      // don't notify on a state another query might still rollback. That was
      // always the intent of this block; firing it from inside the callback did
      // the opposite — the revived ride was routinely invisible to the lookup,
      // so a captain cancelling silently left the ride broadcast to nobody.
      // Handed to the caller below, which runs once withTx has returned.
      const reborn = upd.rows[0]!;
      pending.value = reborn;

      return shape(reborn, { revealCode: true });
    }

    const newStatus = input.role === 'rider'
      ? 'cancelled_by_rider'
      : 'cancelled_by_captain';

    const upd = await client.query<RideRow>(
      `UPDATE rides
          SET status = $1,
              cancelled_at = now(),
              cancel_reason = $2
        WHERE id = $3
      RETURNING ${RIDE_COLUMNS}`,
      [newStatus, input.reason, ride.id],
    );

    // If captain was assigned, return them to "online".
    if (ride.captain_id) {
      await client.query(
        `UPDATE captain_state SET presence = 'online', updated_at = now()
          WHERE captain_id = $1 AND presence = 'on_ride'`,
        [ride.captain_id],
      );
    }
    return shape(upd.rows[0]!, { revealCode: true });
  });

  // Only set on the branch where a captain cancelled and the ride went back to
  // 'searching'. Fired here so the revived row is committed and visible.
  if (pending.value) {
    void broadcastNewRide(pending.value, 're-broadcast after captain cancel');
    // …and tell the rider, whose screen would otherwise silently rewind from
    // "un captain arrive" to "recherche en cours" with no explanation.
    const revived = pending.value;
    void (async () => {
      try {
        await notifyRiderCaptainCancelled(revived.booker_id, { id: revived.id });
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('[rides] rider cancel notification failed', { rideId: input.rideId, err });
      }
    })();
  }
  return result;
}

interface AdminCancelInput {
  rideId: string;
  reason: string;
}

// Admin override cancel: can terminate a ride from ANY non-terminal state
// (searching, accepted, arrived, in_progress, pending_passenger_confirm).
// Sets status='cancelled_by_system' and frees the assigned captain.
export async function adminCancelRide(input: AdminCancelInput) {
  return withTx(async (client) => {
    const ride = await lockRide(client, input.rideId);

    const terminal = ['completed', 'cancelled_by_rider', 'cancelled_by_captain',
                      'cancelled_by_system', 'no_show'];
    if (terminal.includes(ride.status)) {
      throw new HttpError(409, 'wrong_status',
        `Ride is already in terminal state ${ride.status}`);
    }

    const upd = await client.query<RideRow>(
      `UPDATE rides
          SET status = 'cancelled_by_system',
              cancelled_at = now(),
              cancel_reason = $1
        WHERE id = $2
      RETURNING ${RIDE_COLUMNS}`,
      [input.reason, ride.id],
    );

    if (ride.captain_id) {
      await client.query(
        `UPDATE captain_state SET presence = 'online', updated_at = now()
          WHERE captain_id = $1 AND presence = 'on_ride'`,
        [ride.captain_id],
      );
    }
    return shape(upd.rows[0]!, { revealCode: true });
  });
}
