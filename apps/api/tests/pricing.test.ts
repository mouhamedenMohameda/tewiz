import { describe, expect, it } from 'vitest';
import { commissionMru, openFareMru } from '../src/modules/rides/pricing.js';

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
});
