/**
 * Shared fixtures for the feature-coverage suite (tests/features/).
 *
 * Every file in this directory pins ONE of the 18 features the product cannot
 * ship without. Files are numbered after that list so a reader can go from
 * "feature #7 is broken" to the file that proves it without searching.
 *
 * Some of those features are NOT implemented today. Their tests still live
 * here, and they are written as GAP GUARDS: they assert the current, broken
 * behaviour and say so in the test name. That is deliberate. A `todo` would be
 * silent; a guard fails the day someone wires the missing behaviour, which
 * forces whoever does it to come here and flip the assertion. The gap is
 * therefore tracked by the test runner rather than by memory.
 */

/** A full `rides` row as RIDE_COLUMNS returns it (pg gives numerics as strings). */
export function rideRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ride-1',
    booker_id: 'rider-1',
    passenger_user_id: 'rider-1',
    passenger_name: null,
    passenger_phone: null,
    is_for_other: false,
    passenger_confirmed_at: null,
    captain_id: null,
    ride_type: 'passenger',
    source: 'app',
    origin_partner_id: null,
    pricing_mode: 'solo',
    shared_seats: null,
    status: 'searching',
    pickup_lat: 18.08,
    pickup_lng: -15.97,
    pickup_label: 'Marché Capitale',
    dropoff_lat: 18.1,
    dropoff_lng: -15.95,
    dropoff_label: 'Ksar',
    fare_estimate_mru: '205',
    fare_final_mru: null,
    commission_rate_bps: 700,
    commission_mru: null,
    payment_method: 'cash',
    distance_m: 4200,
    duration_s: null,
    verification_code: null,
    requested_at: new Date('2026-08-04T10:00:00Z'),
    accepted_at: null,
    arrived_at: null,
    started_at: null,
    completed_at: null,
    cancelled_at: null,
    cancel_reason: null,
    is_open: false,
    open_base_fare_mru: null,
    open_per_km_mru: null,
    open_per_minute_mru: null,
    open_min_fare_mru: null,
    ...overrides,
  };
}

/** Default app_settings shape, wide enough for every pricing path under test. */
export function pricingSettings(overrides: Record<string, unknown> = {}) {
  return {
    baseFareMru: 50,
    perKmMru: 40,
    minFareMru: 100,
    commissionRateBps: 700,
    colisCommissionRateBps: 1000,
    operatorCommissionRateBps: 700,
    longDistanceThresholdM: 30_000,
    searchingTimeoutS: 300,
    allowOpenRides: true,
    privateDriverEnabled: true,
    convoyageEnabled: true,
    carRentalEnabled: true,
    roadsideAssistanceEnabled: true,
    lightMovingEnabled: true,
    intercityFreightEnabled: true,
    equipmentRentalEnabled: true,
    nightPricingEnabled: false,
    nightPriceMultiplier: 1,
    nightPriceStartHour: 22,
    nightPriceEndHour: 6,
    gpsFraudSevereMode: false,
    privateDriverHourlyRateMru: 1000,
    carRentalDailyRateMru: 8000,
    equipmentRentalDailyRateMru: 5000,
    captainAlertSoundMode: 'default',
    captainAlertRepeatIntervalS: 10,
    ...overrides,
  };
}

/**
 * A minimal pg client whose `query` is routed by matching the SQL text against
 * regexes, in order. Unmatched statements resolve empty so incidental writes
 * (audit rows, presence bumps…) never fail a test.
 *
 * `calls` keeps every (sql, params) pair so a test can assert what was NOT
 * written — which is how most of the gap guards in this directory work.
 */
export interface FakeClient {
  query: (sql: unknown, params?: any[]) => Promise<{ rows: any[]; rowCount: number }>;
  calls: { sql: string; params: any[] }[];
  /** True when any statement issued so far matches the pattern. */
  didQuery: (re: RegExp) => boolean;
}

export function fakeClient(
  table: Array<[RegExp, (params: any[]) => { rows: any[]; rowCount?: number }]>,
): FakeClient {
  const calls: { sql: string; params: any[] }[] = [];
  return {
    calls,
    didQuery: (re: RegExp) => calls.some((c) => re.test(c.sql)),
    async query(sql: unknown, params: any[] = []) {
      const text = typeof sql === 'string' ? sql : String((sql as any)?.text ?? '');
      calls.push({ sql: text, params });
      for (const [re, handler] of table) {
        if (re.test(text)) {
          const r = handler(params);
          return { rows: r.rows, rowCount: r.rowCount ?? r.rows.length };
        }
      }
      return { rows: [], rowCount: 0 };
    },
  };
}

/** Lets a fire-and-forget `void promise` settle before assertions run. */
export const flush = () => new Promise((resolve) => setImmediate(resolve));
