/**
 * How high a ship stands out of the water - all of it assumed, none of it recorded.
 *
 * The scenario states length, beam and draught. It never states depth, and freeboard is
 * depth minus draught, so every vertical dimension this project draws or reasons with is a
 * fraction of the beam picked here. That was tolerable while the numbers only sized a
 * picture. It is not tolerable silently now that `core/visibility.ts` answers "could she
 * have been seen" from them: whether a wave hides a vessel turns on her height above the
 * water more sharply than on anything else in the calculation.
 *
 * So they live here rather than inside the renderer that first needed them - `core/` and
 * the panels have to be able to reach them, and to say where they came from - and issue #8
 * replaces them with a catalogue of ship classes. Neither fraction varies smoothly with
 * size in reality: a 499 GT Japanese coaster is 6.8 to 7.4 m deep whatever else about her
 * varies, which is exactly the kind of thing a fraction of the beam cannot know.
 */

import type { Vessel } from "../../core/types.js";

const FREEBOARD_FRACTION_OF_BEAM = 0.55;
const BRIDGE_HEIGHT_FRACTION_OF_BEAM = 0.75;

/** Eyes sit below the wheelhouse roof. */
const EYE_FRACTION_OF_BRIDGE_HEIGHT = 0.85;

export interface AssumedHeights {
  /** Main deck above the waterline. */
  freeboardMetres: number;
  /** Wheelhouse windows above the waterline - where a lookout's eye is. */
  eyeMetres: number;
  /**
   * The highest part of the hull and superstructure, which is what a distant observer sees
   * last as the sea or the earth takes the rest. Masts and lights stand above it.
   */
  superstructureMetres: number;
}

/**
 * Every one of these is a guess from the beam. Nothing that prints them may say otherwise.
 */
export function assumedHeights(vessel: Vessel): AssumedHeights {
  const freeboard = vessel.beamMetres * FREEBOARD_FRACTION_OF_BEAM;
  const bridgeHeight = vessel.beamMetres * BRIDGE_HEIGHT_FRACTION_OF_BEAM;
  return {
    freeboardMetres: freeboard,
    eyeMetres: freeboard + bridgeHeight * EYE_FRACTION_OF_BRIDGE_HEIGHT,
    superstructureMetres: freeboard + bridgeHeight,
  };
}
