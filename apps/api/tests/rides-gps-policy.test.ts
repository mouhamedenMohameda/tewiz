import { beforeEach, describe, expect, it, vi } from 'vitest';
import { __test__ } from '../src/modules/rides/rides.service.js';

type ViolationRow = {
  id: number;
  captainId: string;
  rideId: string;
  baseCommissionMru: number;
  chargedCommissionMru: number;
  action: string;
  createdAt: Date;
  recoveredAt: Date | null;
};

class FakeGpsClient {
  private nextId = 1;
  private samplesByRide = new Map<string, { samples: number; lastRecorded: Date | null }>();
  public violations: ViolationRow[] = [];

  setRideSamples(rideId: string, samples: number, lastRecorded: Date | null) {
    this.samplesByRide.set(rideId, { samples, lastRecorded });
  }

  async query(sql: unknown, params: any[] = []) {
    const text = String(sql).replace(/\s+/g, ' ');

    if (text.includes('FROM ride_locations')) {
      const rideId = String(params[0]);
      const sample = this.samplesByRide.get(rideId) ?? { samples: 0, lastRecorded: null };
      return {
        rows: [{
          samples: String(sample.samples),
          last_recorded: sample.lastRecorded,
        }],
      };
    }

    if (text.includes('SELECT COUNT(*)::text AS n') && text.includes('FROM captain_gps_violations')) {
      const captainId = String(params[0]);
      const count = this.violations.filter((v) => v.captainId === captainId).length;
      return { rows: [{ n: String(count) }] };
    }

    if (text.includes('SELECT id, base_commission_mru') && text.includes('LIMIT 3')) {
      const captainId = String(params[0]);
      const rows = this.violations
        .filter((v) => v.captainId === captainId && v.recoveredAt == null)
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
        .slice(0, 3)
        .map((v) => ({ id: String(v.id), base_commission_mru: v.baseCommissionMru }));
      return { rows };
    }

    if (text.includes('UPDATE captain_gps_violations') && text.includes('recovered_at = now()')) {
      const ids = (params[0] as number[]).map((n) => Number(n));
      for (const row of this.violations) {
        if (ids.includes(row.id)) row.recoveredAt = new Date();
      }
      return { rows: [] };
    }

    if (text.includes('INSERT INTO captain_gps_violations')) {
      const [captainId, rideId, baseCommissionMru, chargedCommissionMru, action] = params;
      this.violations.push({
        id: this.nextId++,
        captainId: String(captainId),
        rideId: String(rideId),
        baseCommissionMru: Number(baseCommissionMru),
        chargedCommissionMru: Number(chargedCommissionMru),
        action: String(action),
        createdAt: new Date(),
        recoveredAt: null,
      });
      return { rows: [] };
    }

    throw new Error(`Unexpected SQL: ${text}`);
  }
}

describe('evaluateClosedRideGpsViolation', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-01T12:00:00.000Z'));
  });

  it('returns null when telemetry is sufficient', async () => {
    const client = new FakeGpsClient();
    client.setRideSamples('ride-ok', 5, new Date('2026-07-01T11:59:50.000Z'));

    const result = await __test__.evaluateClosedRideGpsViolation({
      client: client as any,
      rideId: 'ride-ok',
      startedAt: new Date('2026-07-01T11:50:00.000Z'),
      captainId: 'captain-1',
      baseCommissionMru: 120,
    });

    expect(result).toBeNull();
    expect(client.violations).toHaveLength(0);
  });

  it('escalates sanctions and recovers first three commissions on repeated violations', async () => {
    const client = new FakeGpsClient();

    const first = await __test__.evaluateClosedRideGpsViolation({
      client: client as any,
      rideId: 'ride-1',
      startedAt: new Date('2026-07-01T11:45:00.000Z'),
      captainId: 'captain-2',
      baseCommissionMru: 100,
    });

    const second = await __test__.evaluateClosedRideGpsViolation({
      client: client as any,
      rideId: 'ride-2',
      startedAt: new Date('2026-07-01T11:45:00.000Z'),
      captainId: 'captain-2',
      baseCommissionMru: 100,
    });

    const third = await __test__.evaluateClosedRideGpsViolation({
      client: client as any,
      rideId: 'ride-3',
      startedAt: new Date('2026-07-01T11:45:00.000Z'),
      captainId: 'captain-2',
      baseCommissionMru: 100,
    });

    const fourth = await __test__.evaluateClosedRideGpsViolation({
      client: client as any,
      rideId: 'ride-4',
      startedAt: new Date('2026-07-01T11:45:00.000Z'),
      captainId: 'captain-2',
      baseCommissionMru: 100,
    });

    expect(first).toMatchObject({ offenseNumber: 1, action: 'warning_1', chargedCommissionMru: 100 });
    expect(second).toMatchObject({ offenseNumber: 2, action: 'warning_2', chargedCommissionMru: 100 });
    expect(third).toMatchObject({ offenseNumber: 3, action: 'double_commission', chargedCommissionMru: 200 });
    expect(fourth).toMatchObject({
      offenseNumber: 4,
      action: 'recovery_suspend',
      chargedCommissionMru: 100,
      recoveryDebitMru: 300,
      suspendCaptain: true,
    });

    expect(client.violations).toHaveLength(4);
    expect(client.violations.slice(0, 3).every((v) => v.recoveredAt instanceof Date)).toBe(true);
    expect(client.violations[3]?.recoveredAt).toBeNull();
  });
});
