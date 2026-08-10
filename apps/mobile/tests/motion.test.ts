/**
 * The gesture physics in lib/motion.ts are the only part of the interaction
 * layer that can be pinned down without a device: everything else is "does it
 * feel right", but these are numbers with correct answers.
 *
 * The behaviours worth guarding are the ones that break silently and read as
 * "the app is broken" rather than "the app is ugly":
 *   - a fast flick must commit to the far snap point even if it barely moved
 *   - a slow drag must NOT commit just because it started moving
 *   - boundaries must resist rather than stop dead
 */

import { describe, expect, it } from 'vitest';
import {
  clampWithResistance,
  DECELERATION_RATE,
  nearestSnapPoint,
  project,
  rubberband,
  settleTarget,
  springConfig,
  toVelocityPerSecond,
} from '@/lib/motion';

describe('springConfig', () => {
  it('derives stiffness and damping from response and damping ratio', () => {
    // ω = 2π/0.4 ≈ 15.708 → k = ω² ≈ 246.7, c = 2·1·ω ≈ 31.4
    const config = springConfig({ response: 0.4, dampingRatio: 1 });
    expect(config.mass).toBe(1);
    expect(config.stiffness).toBeCloseTo(246.74, 1);
    expect(config.damping).toBeCloseTo(31.42, 1);
  });

  it('is critically damped at ratio 1 — c = 2·√(k·m), the no-overshoot case', () => {
    const { stiffness, damping, mass } = springConfig({ response: 0.5, dampingRatio: 1 });
    expect(damping).toBeCloseTo(2 * Math.sqrt(stiffness * mass), 6);
  });

  it('a lower damping ratio means less damping, i.e. overshoot', () => {
    const critical = springConfig({ response: 0.3, dampingRatio: 1 });
    const bouncy = springConfig({ response: 0.3, dampingRatio: 0.8 });
    expect(bouncy.damping).toBeLessThan(critical.damping);
    // Response is what sets the speed, so stiffness must not move with bounce.
    expect(bouncy.stiffness).toBeCloseTo(critical.stiffness, 6);
  });

  it('a shorter response is a stiffer spring', () => {
    expect(springConfig({ response: 0.2, dampingRatio: 1 }).stiffness)
      .toBeGreaterThan(springConfig({ response: 0.6, dampingRatio: 1 }).stiffness);
  });

  it('carries the handed-off gesture velocity through to the animation', () => {
    expect(springConfig({ response: 0.4, dampingRatio: 1 }, { velocity: 820 }).velocity).toBe(820);
  });
});

describe('project', () => {
  it('projects further the faster the flick', () => {
    expect(project(2000)).toBeGreaterThan(project(500));
  });

  it('keeps the sign, so an upward flick projects upward', () => {
    expect(project(-1200)).toBeLessThan(0);
  });

  it('does not move at all without velocity', () => {
    expect(project(0)).toBe(0);
  });

  it('uses exponential decay, not the textbook v²/2a', () => {
    // v/1000 · d/(1−d) with d = 0.998 → 1000/1000 · 499 = 499px for 1000px/s.
    expect(project(1000, DECELERATION_RATE)).toBeCloseTo(499, 0);
  });

  it('a lower deceleration rate throws a shorter distance', () => {
    expect(project(1000, 0.99)).toBeLessThan(project(1000, 0.998));
  });
});

describe('settleTarget', () => {
  const SNAP = [0, 300] as const;

  it('commits a fast short flick to the far end', () => {
    // Barely moved (still near the top) but thrown hard downward: judging by
    // position alone would spring it back, which reads as the sheet refusing.
    expect(settleTarget(40, 900, SNAP)).toBe(300);
  });

  it('returns to the near end when the flick reverses', () => {
    expect(settleTarget(260, -900, SNAP)).toBe(0);
  });

  it('falls back to plain proximity when released without velocity', () => {
    expect(settleTarget(40, 0, SNAP)).toBe(0);
    expect(settleTarget(260, 0, SNAP)).toBe(300);
  });

  it('does not commit a slow drag that has not crossed the midpoint', () => {
    // ~50px/s is a drift, not a throw: projects ~25px, still nearest to 0.
    expect(settleTarget(100, 50, SNAP)).toBe(0);
  });
});

describe('nearestSnapPoint', () => {
  it('picks the closest of several points', () => {
    expect(nearestSnapPoint(210, [0, 200, 400])).toBe(200);
    expect(nearestSnapPoint(390, [0, 200, 400])).toBe(400);
  });
});

describe('rubberband', () => {
  it('follows the finger less and less the further past the bound it goes', () => {
    const first = rubberband(50, 600);
    const second = rubberband(100, 600);
    expect(second).toBeGreaterThan(first);
    // Twice the overshoot must give strictly less than twice the travel —
    // that diminishing return IS the resistance.
    expect(second).toBeLessThan(first * 2);
  });

  it('never exceeds the raw overshoot — resistance only ever holds back', () => {
    for (const overshoot of [10, 100, 500, 2000]) {
      expect(rubberband(overshoot, 600)).toBeLessThan(overshoot);
    }
  });

  it('is zero at the boundary itself', () => {
    expect(rubberband(0, 600)).toBe(0);
  });
});

describe('clampWithResistance', () => {
  it('tracks 1:1 inside the bounds', () => {
    expect(clampWithResistance(120, 0, 300, 600)).toBe(120);
  });

  it('stretches past either end instead of stopping dead', () => {
    const below = clampWithResistance(-80, 0, 300, 600);
    expect(below).toBeLessThan(0);
    expect(below).toBeGreaterThan(-80);

    const above = clampWithResistance(380, 0, 300, 600);
    expect(above).toBeGreaterThan(300);
    expect(above).toBeLessThan(380);
  });
});

describe('toVelocityPerSecond', () => {
  it('converts PanResponder px/ms into the px/s everything else speaks', () => {
    expect(toVelocityPerSecond(1.2)).toBe(1200);
  });
});
