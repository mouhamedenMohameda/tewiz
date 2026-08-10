/**
 * Motion physics — the maths behind every gesture-driven surface in the app.
 *
 * Three ideas, all borrowed from how iOS actually behaves:
 *
 *  1. Springs, not durations. A duration-based animation cannot respond to new
 *     input; a spring can, because retargeting it just moves the target while
 *     the motion stays continuous. Everything a finger can touch uses one.
 *  2. Momentum is projected, not ignored. When a flick ends we work out where
 *     it *was heading* and snap to the nearest point to THAT, so a short fast
 *     flick throws the sheet instead of springing back.
 *  3. Boundaries resist, they don't slam. Dragging past the end gets
 *     progressively harder rather than hitting a wall.
 *
 * Springs are described the way Apple's designers describe them (response +
 * damping ratio) rather than as raw stiffness/damping/mass, because those two
 * numbers are the ones you can actually reason about. `springConfig` converts.
 */

import type { Animated } from 'react-native';

export interface SpringFeel {
  /**
   * Roughly how long the value takes to reach the target, in seconds. Lower is
   * snappier. NOT a duration — a spring has no fixed end; the settle time falls
   * out of the physics.
   */
  response: number;
  /**
   * 1 = critically damped: arrives and stops, no overshoot. Below 1 overshoots
   * and springs back — reserve it for motion the user's own gesture threw.
   */
  dampingRatio: number;
}

type RNSpringConfig = {
  mass: number;
  stiffness: number;
  damping: number;
  velocity?: number;
  useNativeDriver: boolean;
};

/**
 * Turn a designer-facing {response, dampingRatio} into the stiffness/damping/
 * mass triplet `Animated.spring` wants.
 *
 *   ω = 2π / response
 *   k = m·ω²                (stiffness)
 *   c = 2·ζ·m·ω             (damping)
 *
 * `velocity` is in units per second — the same units the animated value moves
 * in. Pass the gesture's release velocity here and the animation continues at
 * exactly the speed the finger left off at, so there is no visible seam between
 * dragging and animating. (Note PanResponder reports px/ms; multiply by 1000.)
 */
export function springConfig(
  feel: SpringFeel,
  options: { velocity?: number; useNativeDriver?: boolean } = {},
): RNSpringConfig {
  const mass = 1;
  const omega = (2 * Math.PI) / feel.response;
  return {
    mass,
    stiffness: mass * omega * omega,
    damping: 2 * feel.dampingRatio * mass * omega,
    velocity: options.velocity,
    useNativeDriver: options.useNativeDriver ?? true,
  };
}

/**
 * Where a flick would come to rest if we let it decelerate on its own —
 * exactly how scroll views decide their landing point.
 *
 * Returns the DISTANCE still to travel, so the projected endpoint is
 * `current + project(v)`. Velocity is in units per second.
 *
 * This is the exponential-decay form iOS uses, not the textbook v²/2a: the
 * difference is very visible, the textbook one under-throws.
 */
export function project(velocity: number, decelerationRate = DECELERATION_RATE): number {
  return ((velocity / 1000) * decelerationRate) / (1 - decelerationRate);
}

/** Scroll-like deceleration. 0.998 is the normal feel; 0.99 is noticeably snappier. */
export const DECELERATION_RATE = 0.998;

/**
 * Progressive resistance past a boundary. The further out the drag goes, the
 * less the surface follows it — so an edge reads as "responsive, but there's
 * nothing more here" rather than as a frozen UI.
 *
 * `overshoot` is how far past the bound the finger has travelled, `dimension`
 * the size of the surface being dragged.
 */
export function rubberband(overshoot: number, dimension: number, constant = 0.55): number {
  if (dimension <= 0) return 0;
  return (overshoot * dimension * constant) / (dimension + constant * Math.abs(overshoot));
}

/**
 * Clamp a drag to [min, max], but let it stretch past either end with
 * rubber-band resistance instead of stopping dead.
 */
export function clampWithResistance(
  value: number,
  min: number,
  max: number,
  dimension: number,
): number {
  if (value < min) return min - rubberband(min - value, dimension);
  if (value > max) return max + rubberband(value - max, dimension);
  return value;
}

/** The snap point closest to `value`. */
export function nearestSnapPoint(value: number, points: readonly number[]): number {
  return points.reduce((best, p) =>
    Math.abs(p - value) < Math.abs(best - value) ? p : best,
  );
}

/**
 * Decide where a released drag should land: project the momentum forward, then
 * snap to whichever point is nearest that projection.
 *
 * @param position  where the finger let go
 * @param velocity  release velocity in units per SECOND
 */
export function settleTarget(
  position: number,
  velocity: number,
  points: readonly number[],
  decelerationRate = DECELERATION_RATE,
): number {
  return nearestSnapPoint(position + project(velocity, decelerationRate), points);
}

/** PanResponder reports px/ms; every function here speaks px/s. */
export function toVelocityPerSecond(gestureVelocity: number): number {
  return gestureVelocity * 1000;
}

/**
 * Read an animated value's LIVE on-screen position and stop whatever is moving
 * it, so a new gesture can pick up exactly where the pixels are.
 *
 * Starting a new animation from the logical/target value instead of the
 * presented one is what produces the classic "jump" when you grab something
 * mid-flight. `stopAnimation`'s callback is async (the native driver has to be
 * asked), which is why callers keep their own listener-fed mirror of the value
 * for the synchronous first frame and use this to correct it.
 */
export function grabValue(
  value: Animated.Value,
  onValue: (current: number) => void,
): void {
  value.stopAnimation(onValue);
}
