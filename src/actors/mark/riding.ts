/**
 * How a buoy answers the sea she is floating in, rather than tracing it.
 *
 * The renderer used to take the water's height for her waterline and the water's slope for
 * her deck. That is the small-body limit, and against a long swell it is right - a two-metre
 * float on a hundred-metre wave really does follow the surface. Against a three-second chop it
 * is not: she is then near her own natural period and moves half again as far as the water.
 *
 * **This is computable for a buoy where a ship's roll is not.** A ship's roll needs her
 * metacentric height, which no report contains, and that is why `plans/ship-motion-model.md`
 * is still a plan. A buoy's heave needs only her draught - `core/response.ts` shows the
 * waterplane area cancelling out of the period entirely - and a draught is a thing a source
 * can give. Borrowing the ship's argument here would be borrowing a reason that does not
 * apply.
 *
 * **But "computable" is not "computed".** Where the file states no draught, it is taken as a
 * proportion of her height chosen for her shape - a model of what a buoy of that shape looks
 * like, not a measurement of this one - and since the period rests on the draught alone, that
 * makes the whole period this tool's figure. `ui/panels.ts` says which it had.
 */

import { answerTo, heavePeriodSeconds, type Answer } from "../../core/response.js";
import type { MarkShape } from "../../core/types.js";

/**
 * How wide a body is against its height, and how much of it floats under.
 *
 * **In `actors/mark/` rather than in the renderer**, because these drive the motion as well as
 * the picture: `core/response.ts` turns a draught into a natural period, and `render/mark.ts`
 * happens to need the same numbers to draw her. The same move `actors/vessel/heights.ts` made
 * for a ship's freeboard.
 *
 * **They are a model of a buoy, not measurements of one.** A file that states a draught
 * overrides the second column outright, and where it does not, the period that follows is this
 * tool's rather than the source's.
 */
export const PROPORTIONS: Record<MarkShape, { width: number; draught: number }> = {
  pillar: { width: 0.55, draught: 0.5 },
  spar: { width: 0.22, draught: 1.1 },
  can: { width: 0.95, draught: 0.45 },
  conical: { width: 0.9, draught: 0.45 },
  spherical: { width: 1.1, draught: 0.5 },
};

/**
 * **The one number here with no source.**
 *
 * A buoy's heave damping is not a constant of nature: it depends on her shape and on whether
 * she carries a heave plate, and the literature reports it per hull rather than in general.
 * Thirty per cent of critical is a middling figure for a small float without one - and it is
 * chosen here, which `ui/panels.ts` says beside the mark.
 *
 * It matters most at resonance, where the gain is `1 / (2 * damping)` - which is to say the
 * choice weighs heaviest exactly where a one-degree-of-freedom model is least trustworthy.
 */
export const CHOSEN_DAMPING = 0.3;

/**
 * How much a shape resists leaning, as a fraction of the water's own slope.
 *
 * **A spar buoy exists to stay upright.** That is what the shape is for: ballast low and
 * little waterplane, so her righting is stiff and her period long, and she stands through a
 * sea that rolls a can right over with it. Modelling her as following the slope exactly draws
 * away the one thing the shape was chosen for.
 *
 * A class rather than a calculation, because the pitch period needs ballast and no report
 * carries it. The issue that asked for this said as much: the shape implies the class even
 * where the figure is unknown.
 */
const LEANS: Record<MarkShape, number> = {
  spar: 0.15,
  pillar: 0.6,
  can: 0.9,
  conical: 0.9,
  spherical: 1,
};

/** Where the draught came from, which decides how much of the period is anybody's figure. */
export type DraughtFrom = "stated" | "a proportion of her height, chosen for her shape";

export interface Riding {
  /** What she does with the water's height, component by component. */
  heave(angularFrequencyPerSecond: number): Answer;
  /** And with its slope, which peaks at a different moment because the period differs. */
  tilt(angularFrequencyPerSecond: number): Answer;
  /** Her draught, which is what the period came out of - and where that came from. */
  draughtMetres: number;
  draughtFrom: DraughtFrom;
  /** Her natural period in heave, for the page to print. */
  heavePeriodSeconds: number;
  /** How much of the water's slope she takes, at the long-wave limit. */
  leans: number;
}

/**
 * How this buoy rides, from her shape and her height above the water.
 *
 * The tilt is given a longer natural period than the heave - twice it - rather than a period
 * of its own: what matters for the picture is that **the two fall out of step**, which is
 * most of what makes a real buoy's motion look irregular rather than metronomic. Putting a
 * figure on the pitch period itself would need ballast, and nothing states that.
 */
export function ridingOf(shape: MarkShape, heightMetres: number, stated?: number): Riding {
  // **A stated draught makes the period a computed figure; the fallback makes it a modelled
  // one.** The proportions below are a model of what a buoy of each shape looks like, not a
  // measurement of this buoy - and since the period comes out of the draught alone, saying
  // "from her geometry" over a draught this tool invented would be the whole claim resting
  // on the invented half.
  const draughtMetres = stated ?? heightMetres * PROPORTIONS[shape].draught;
  const draughtFrom: DraughtFrom =
    stated === undefined ? "a proportion of her height, chosen for her shape" : "stated";
  const period = heavePeriodSeconds(draughtMetres);
  const natural = (2 * Math.PI) / period;
  const leans = LEANS[shape];

  return {
    draughtMetres,
    draughtFrom,
    heavePeriodSeconds: period,
    leans,
    heave: (omega) => answerTo(omega / natural, CHOSEN_DAMPING),
    tilt: (omega) => {
      const answer = answerTo(omega / (natural / 2), CHOSEN_DAMPING);
      return { gain: answer.gain * leans, lagRadians: answer.lagRadians };
    },
  };
}
