/**
 * How a damped oscillator answers a wave, which is the whole of a small buoy's motion.
 *
 * A floating body forced at the water's own frequency is a spring and a mass: the spring is
 * the water it displaces when it dips, and the mass is the water it displaced already. The
 * arithmetic is the same as any other second-order system, and it is here rather than in
 * `actors/mark/` because nothing about it is a fact about buoys.
 *
 * **Two numbers come out, not one.** The gain says how far the body moves against how far the
 * water moves; the lag says how late. Taking only the gain leaves every motion peaking at the
 * same instant as every other - and a buoy's heave and her tilt have different natural
 * periods, so falling out of step with each other is most of what makes her motion look
 * irregular rather than metronomic.
 */

export interface Answer {
  /** How far it moves for a unit of forcing. One is following the water exactly. */
  gain: number;
  /** How late, in radians of the forcing's own cycle. */
  lagRadians: number;
}

/**
 * The classical response of a damped single-degree-of-freedom system.
 *
 * `ratio` is the forcing frequency over the natural one - so below one is a slow wave the
 * body simply follows, one is resonance, and far above one is a wave too quick to answer.
 * `damping` is the fraction of critical damping.
 *
 * At resonance the gain is `1 / (2 * damping)`, which is why the damping matters most exactly
 * where a model like this is least trustworthy.
 */
export function answerTo(ratio: number, damping: number): Answer {
  const stiffness = 1 - ratio * ratio;
  const resistance = 2 * damping * ratio;
  return {
    gain: 1 / Math.hypot(stiffness, resistance),
    // atan2 rather than atan: the lag passes a quarter cycle at resonance and goes on towards
    // half a cycle above it, and `atan` alone would fold it back down again.
    lagRadians: Math.atan2(resistance, stiffness),
  };
}

/**
 * The natural period of a floating body in heave, from its draught alone.
 *
 * The restoring force is the weight of the water in the extra draught, `rho * g * A * z`, and
 * the mass is the water displaced already, `rho * A * d`. **The waterplane area cancels**, so
 * `omega^2 = g / d` and the period follows from the draught and nothing else - which is why
 * this is computable for a buoy where a ship's roll is not: it needs no metacentric height,
 * only how deep she floats.
 *
 * Added mass is left out. It lengthens the period - the body drags water with it - by
 * something like a tenth for a slender float, and putting a figure on it needs a shape this
 * format does not carry.
 */
export function heavePeriodSeconds(draughtMetres: number): number {
  return 2 * Math.PI * Math.sqrt(draughtMetres / GRAVITY);
}

const GRAVITY = 9.81;
