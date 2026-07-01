import { describe, expect, it } from 'vitest';
import {
  commissionMru,
  intercityFareMru,
  openFareMru,
} from '../src/modules/rides/pricing.js';

describe('pricing', () => {
  it('commissionMru floors the commission amount', () => {
    expect(commissionMru(103, 500)).toBe(5);
    expect(commissionMru(999, 1250)).toBe(124);
  });

  it('openFareMru applies min fare and rounds up to nearest 5', () => {
    const fare = openFareMru(
      {
        baseFareMru: 30,
        perKmMru: 10,
        perMinuteMru: 6,
        minFareMru: 60,
      },
      2_200,
      600,
    );

    // raw = 30 + 22 + 60 = 112 -> rounded up to 115
    expect(fare).toBe(115);
  });

  it('openFareMru clamps negative distance and duration', () => {
    const fare = openFareMru(
      {
        baseFareMru: 20,
        perKmMru: 12,
        perMinuteMru: 4,
        minFareMru: 50,
      },
      -10,
      -20,
    );

    expect(fare).toBe(50);
  });

  it('intercityFareMru targets around 20k for a 1200 km solo estimate', () => {
    const quote = intercityFareMru(1_200_000, {
      baseFareMru: 100,
      tier1LimitKm: 80,
      tier2LimitKm: 300,
      tier1PerKmMru: 30,
      tier2PerKmMru: 18,
      tier3PerKmMru: 16,
      sharedDefaultSeats: 12,
      sharedMinSeatFareMru: 300,
      minFareMru: 40,
    }, { pricingMode: 'solo' });

    expect(quote.fareMru).toBe(20860);
    expect(quote.pricingModeApplied).toBe('solo');
  });

  it('intercityFareMru computes per-seat shared price and floors seats', () => {
    const quote = intercityFareMru(1_200_000, {
      baseFareMru: 100,
      tier1LimitKm: 80,
      tier2LimitKm: 300,
      tier1PerKmMru: 30,
      tier2PerKmMru: 18,
      tier3PerKmMru: 16,
      sharedDefaultSeats: 12,
      sharedMinSeatFareMru: 300,
      minFareMru: 40,
    }, { pricingMode: 'shared', sharedSeats: 15 });

    expect(quote.soloFareMru).toBe(20860);
    expect(quote.fareMru).toBe(1395);
    expect(quote.sharedSeatsApplied).toBe(15);
    expect(quote.pricingModeApplied).toBe('shared');
  });
});
