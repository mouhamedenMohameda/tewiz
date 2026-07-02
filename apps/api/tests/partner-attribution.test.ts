import { beforeEach, describe, expect, it, vi } from 'vitest';

// In-memory fake of the handful of tables the attribution service touches.
// Mirrors the SQL shapes in attribution.service.ts closely enough to prove
// the money invariants (idempotence, cap, window close, quota, conversion).

let db: FakeDb;

vi.mock('../src/db/pool.js', () => ({
  pool: { query: (sql: unknown, params?: any[]) => db.query(String(sql), params ?? []) },
  withTx: async (fn: any) =>
    fn({ query: (sql: unknown, params?: any[]) => db.query(String(sql), params ?? []) }),
}));

vi.mock('../src/modules/admin/app-settings.service.js', () => ({
  getPricingSettings: async () => ({
    partnerTotalShareCapBps: 5000,
    partnerFraudPairMaxRides7d: 8,
    partnerFraudMinDistanceM: 300,
    partnerFraudMaxCreationsPerHour: 6,
  }),
}));

import {
  applyPartnerAttributionOnCompletion,
} from '../src/modules/partners/attribution.service.js';

interface FakePartner {
  id: string;
  type: 'agency' | 'restaurant' | 'individual';
  status: 'active' | 'suspended' | 'ended';
  share_bps: number;
  window_max_courses: number;
  closure_bonus_mru: string;
  quota_courses: number;
  quota_months: number;
  conversion_bonus_mru: string;
  created_at: Date;
}

interface FakeLink {
  captain_id: string;
  partner_id: string;
  expires_at: Date;
  courses_counted: number;
  closed_at: Date | null;
  closure_bonus_paid: boolean;
}

interface FakeEarning {
  partner_id: string;
  ride_id: string;
  role: string;
  base_commission_mru: number;
  share_bps: number;
  amount_mru: number;
  status: string;
}

interface FakeRide {
  id: string;
  status: string;
  source: string;
  origin_partner_id: string | null;
  captain_id: string | null;
  commission_mru: string | null;
  booker_phone: string | null;
}

class FakeDb {
  partners = new Map<string, FakePartner>();
  links = new Map<string, FakeLink>();          // by captain_id
  earnings = new Map<string, FakeEarning>();    // by ride|partner|role
  beneficiaries = new Map<string, { partner_id: string; converted_at: Date | null }>();
  rides = new Map<string, FakeRide>();

  async query(sql: string, params: any[]): Promise<{ rows: any[]; rowCount: number }> {
    const s = sql.replace(/\s+/g, ' ').trim();

    if (s.startsWith('SELECT r.id, r.status, r.source')) {
      const ride = this.rides.get(params[0]);
      return { rows: ride ? [ride] : [], rowCount: ride ? 1 : 0 };
    }

    if (s.includes('FROM partners WHERE id = $1 FOR UPDATE')) {
      const p = this.partners.get(params[0]);
      return { rows: p ? [{ ...p }] : [], rowCount: p ? 1 : 0 };
    }

    if (s.includes('SELECT status, conversion_bonus_mru FROM partners')) {
      const p = this.partners.get(params[0]);
      return { rows: p ? [{ status: p.status, conversion_bonus_mru: p.conversion_bonus_mru }] : [], rowCount: p ? 1 : 0 };
    }

    if (s.includes("SELECT count(*) AS n FROM partner_earnings")) {
      const n = [...this.earnings.values()].filter(
        (e) => e.partner_id === params[0] && e.role === 'ride_creator' && e.status !== 'cancelled',
      ).length;
      return { rows: [{ n: String(n) }], rowCount: 1 };
    }

    if (s.includes('FROM captain_partner_links l JOIN partners p')) {
      const l = this.links.get(params[0]);
      if (!l) return { rows: [], rowCount: 0 };
      const p = this.partners.get(l.partner_id)!;
      return {
        rows: [{
          partner_id: l.partner_id,
          expires_at: l.expires_at,
          courses_counted: l.courses_counted,
          closed_at: l.closed_at,
          closure_bonus_paid: l.closure_bonus_paid,
          p_status: p.status,
          share_bps: p.share_bps,
          window_max_courses: p.window_max_courses,
          closure_bonus_mru: p.closure_bonus_mru,
        }],
        rowCount: 1,
      };
    }

    if (s.startsWith('INSERT INTO partner_earnings')) {
      const [partnerId, rideId] = params;
      const role = s.includes("'ride_creator'") ? 'ride_creator'
        : s.includes("'captain_provider'") ? 'captain_provider'
        : s.includes("'closure_bonus'") ? 'closure_bonus'
        : 'conversion_bonus';
      const key = `${rideId}|${partnerId}|${role}`;
      if (this.earnings.has(key)) return { rows: [], rowCount: 0 }; // ON CONFLICT
      const isBonus = role === 'closure_bonus' || role === 'conversion_bonus';
      this.earnings.set(key, {
        partner_id: partnerId,
        ride_id: rideId,
        role,
        base_commission_mru: isBonus ? 0 : params[2],
        share_bps: isBonus ? 0 : params[3],
        amount_mru: isBonus ? params[2] : params[4],
        status: 'pending',
      });
      return { rows: [], rowCount: 1 };
    }

    if (s.includes('SET courses_counted = courses_counted + 1')) {
      const l = this.links.get(params[0])!;
      l.courses_counted += 1;
      return {
        rows: [{ courses_counted: l.courses_counted, closure_bonus_paid: l.closure_bonus_paid }],
        rowCount: 1,
      };
    }

    if (s.includes('SET closed_at = COALESCE(closed_at, now())')) {
      const l = this.links.get(params[0])!;
      l.closed_at = l.closed_at ?? new Date();
      return { rows: [], rowCount: 1 };
    }

    if (s.includes('SET closure_bonus_paid = true')) {
      const l = this.links.get(params[0])!;
      l.closure_bonus_paid = true;
      return { rows: [], rowCount: 1 };
    }

    if (s.startsWith('UPDATE partner_beneficiaries')) {
      const b = this.beneficiaries.get(params[0]);
      if (!b || b.converted_at !== null) return { rows: [], rowCount: 0 };
      b.converted_at = new Date();
      return { rows: [{ partner_id: b.partner_id }], rowCount: 1 };
    }

    throw new Error(`FakeDb: unhandled SQL: ${s.slice(0, 120)}`);
  }
}

const AGENCY = 'aaaaaaaa-0000-0000-0000-000000000001';
const RESTO  = 'bbbbbbbb-0000-0000-0000-000000000002';
const MEMBER = 'cccccccc-0000-0000-0000-000000000003';
const CAPTAIN = 'dddddddd-0000-0000-0000-000000000004';

function seedBase() {
  db = new FakeDb();
  db.partners.set(AGENCY, {
    id: AGENCY, type: 'agency', status: 'active', share_bps: 3000,
    window_max_courses: 300, closure_bonus_mru: '500',
    quota_courses: 100, quota_months: 6, conversion_bonus_mru: '0',
    created_at: new Date(),
  });
  db.partners.set(RESTO, {
    id: RESTO, type: 'restaurant', status: 'active', share_bps: 3000,
    window_max_courses: 300, closure_bonus_mru: '0',
    quota_courses: 100, quota_months: 6, conversion_bonus_mru: '0',
    created_at: new Date(),
  });
  db.partners.set(MEMBER, {
    id: MEMBER, type: 'individual', status: 'active', share_bps: 2000,
    window_max_courses: 300, closure_bonus_mru: '0',
    quota_courses: 2, quota_months: 6, conversion_bonus_mru: '200',
    created_at: new Date(),
  });
  db.links.set(CAPTAIN, {
    captain_id: CAPTAIN, partner_id: AGENCY,
    expires_at: new Date(Date.now() + 30 * 86_400_000),
    courses_counted: 0, closed_at: null, closure_bonus_paid: false,
  });
}

function addRide(r: Partial<FakeRide> & { id: string }) {
  db.rides.set(r.id, {
    status: 'completed', source: 'app', origin_partner_id: null,
    captain_id: null, commission_mru: '100', booker_phone: null,
    ...r,
  });
}

beforeEach(seedBase);

describe('partner attribution on ride completion', () => {
  it('credits ONE captain_provider line and never a second on replay', async () => {
    addRide({ id: 'ride-1', captain_id: CAPTAIN });

    const first = await applyPartnerAttributionOnCompletion('ride-1');
    expect(first.captainEarning).toBe(true);
    expect(db.links.get(CAPTAIN)!.courses_counted).toBe(1);

    const replay = await applyPartnerAttributionOnCompletion('ride-1');
    expect(replay.captainEarning).toBe(false);
    // Counter untouched by the replay — this is acceptance criterion #1.
    expect(db.links.get(CAPTAIN)!.courses_counted).toBe(1);
    expect(db.earnings.size).toBe(1);
  });

  it('closes the window on the Nth ride, pays the closure bonus once, and stops crediting', async () => {
    db.links.get(CAPTAIN)!.courses_counted = 299;

    addRide({ id: 'ride-300', captain_id: CAPTAIN });
    const r300 = await applyPartnerAttributionOnCompletion('ride-300');
    expect(r300.captainEarning).toBe(true);
    expect(r300.closureBonus).toBe(true);
    const link = db.links.get(CAPTAIN)!;
    expect(link.closed_at).not.toBeNull();
    expect(link.closure_bonus_paid).toBe(true);
    expect(db.earnings.get(`ride-300|${AGENCY}|closure_bonus`)!.amount_mru).toBe(500);

    // The 301st ride credits nothing (criterion #2).
    addRide({ id: 'ride-301', captain_id: CAPTAIN });
    const r301 = await applyPartnerAttributionOnCompletion('ride-301');
    expect(r301.captainEarning).toBe(false);
    expect(r301.closureBonus).toBe(false);
    expect([...db.earnings.values()].filter((e) => e.role === 'closure_bonus')).toHaveLength(1);
  });

  it('closes an expired window without crediting, bonus paid once', async () => {
    db.links.get(CAPTAIN)!.expires_at = new Date(Date.now() - 1000);

    addRide({ id: 'ride-late', captain_id: CAPTAIN });
    const r = await applyPartnerAttributionOnCompletion('ride-late');
    expect(r.captainEarning).toBe(false);
    expect(r.closureBonus).toBe(true);
    expect(db.links.get(CAPTAIN)!.closed_at).not.toBeNull();
  });

  it('creates TWO lines for a restaurant-created ride delivered by an agency courier, capped', async () => {
    addRide({
      id: 'ride-double', captain_id: CAPTAIN,
      source: 'restaurant', origin_partner_id: RESTO, commission_mru: '100',
    });
    const r = await applyPartnerAttributionOnCompletion('ride-double');
    expect(r.creatorEarning).toBe(true);
    expect(r.captainEarning).toBe(true);

    const creator = db.earnings.get(`ride-double|${RESTO}|ride_creator`)!;
    const captain = db.earnings.get(`ride-double|${AGENCY}|captain_provider`)!;
    // 3000 + 3000 bps raw > cap 5000 → scaled to 2500 each (criterion #4).
    expect(creator.share_bps).toBe(2500);
    expect(captain.share_bps).toBe(2500);
    expect(creator.amount_mru + captain.amount_mru).toBeLessThanOrEqual(50); // 50% of 100
  });

  it('stops crediting an individual member past his quota (criterion #5)', async () => {
    for (const id of ['m1', 'm2', 'm3']) {
      addRide({ id, source: 'partner', origin_partner_id: MEMBER });
    }
    expect((await applyPartnerAttributionOnCompletion('m1')).creatorEarning).toBe(true);
    expect((await applyPartnerAttributionOnCompletion('m2')).creatorEarning).toBe(true);
    // quota_courses = 2 → the third ride credits nothing.
    expect((await applyPartnerAttributionOnCompletion('m3')).creatorEarning).toBe(false);
  });

  it('pays the conversion bonus exactly once, on the first self-ordered ride (criterion #6)', async () => {
    db.beneficiaries.set('+22233445566', { partner_id: MEMBER, converted_at: null });

    addRide({ id: 'self-1', source: 'app', booker_phone: '+22233445566' });
    const first = await applyPartnerAttributionOnCompletion('self-1');
    expect(first.conversionBonus).toBe(true);
    expect(db.earnings.get(`self-1|${MEMBER}|conversion_bonus`)!.amount_mru).toBe(200);

    addRide({ id: 'self-2', source: 'app', booker_phone: '+22233445566' });
    const second = await applyPartnerAttributionOnCompletion('self-2');
    expect(second.conversionBonus).toBe(false);
  });

  it('ignores rides created via a partner account for conversion purposes', async () => {
    db.beneficiaries.set('+22233445566', { partner_id: MEMBER, converted_at: null });
    // The member booked FOR the customer — not a conversion.
    addRide({
      id: 'via-member', source: 'partner', origin_partner_id: MEMBER,
      booker_phone: '+22233445566',
    });
    const r = await applyPartnerAttributionOnCompletion('via-member');
    expect(r.conversionBonus).toBe(false);
    expect(db.beneficiaries.get('+22233445566')!.converted_at).toBeNull();
  });

  it('credits nothing for a suspended partner', async () => {
    db.partners.get(RESTO)!.status = 'suspended';
    addRide({ id: 'ride-susp', source: 'restaurant', origin_partner_id: RESTO });
    const r = await applyPartnerAttributionOnCompletion('ride-susp');
    expect(r.creatorEarning).toBe(false);
    expect(db.earnings.size).toBe(0);
  });
});
