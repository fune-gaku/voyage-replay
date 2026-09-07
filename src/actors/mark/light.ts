/**
 * The light a sea mark carries, joining what a scenario states to the grammar in
 * `core/light-character.ts`.
 *
 * Separate from that grammar for the reason `actors/vessel/` is separate from `core/`: the
 * rhythm of a light is not a fact about marks - most of a ship's lights are steady, but not
 * all of them are - and the block that generates a sequence should not have to know what is
 * carrying it. This file is the part that does.
 *
 * **Three answers, and they must not collapse into two.** A file that says nothing about a
 * light has not said the mark was unlit: 浮標 and 灯浮標 are different marks, and so are
 * 立標 and 灯標, and a report that omits the light is the ordinary case rather than a
 * statement that there was none. A file that states a character nobody can read is a third
 * thing again. Only the third case is an error; the first is simply the limit of the source.
 */

import {
  parseCharacter,
  phasesOf,
  type LightCharacter,
  type Phase,
  type Unreadable,
} from "../../core/light-character.js";
import type { LightPhase, Mark } from "../../core/types.js";

/** Why nothing can be shown flashing. */
export type Unlit =
  | "the file does not say whether it carried a light"
  | "the stated timings include a phase of no length"
  | Unreadable;

export type LightReading =
  | {
      known: true;
      character: LightCharacter;
      phases: Phase[];
      /**
       * Where the on/off durations came from. **Inferred is the usual answer**: an
       * abbreviation bounds the split within the period and does not fix it, so a sequence
       * generated from one conforms without being the sequence that light actually showed.
       */
      timings: "stated" | "inferred";
    }
  | { known: false; because: Unlit };

/**
 * What this mark's light does, or why that cannot be said.
 *
 * One function, so that the page and the picture answer the question the same way. Two
 * readings of the same field is how a panel comes to describe a rhythm the view is not
 * drawing - the fault `plans/done/antenna-offset-6.md` records.
 */
export function lightOf(mark: Mark): LightReading {
  const light = mark.light;
  if (!light) return { known: false, because: "the file does not say whether it carried a light" };

  const reading = parseCharacter(light.character);
  if (!reading.read) return { known: false, because: reading.because };

  const stated = statedPhases(light.phases);
  if (stated === "unusable") {
    return { known: false, because: "the stated timings include a phase of no length" };
  }

  return {
    known: true,
    character: reading.character,
    phases: stated ?? phasesOf(reading.character),
    timings: stated === null ? "inferred" : "stated",
  };
}

/**
 * The durations a scenario stated, if it stated any.
 *
 * The schema requires each one to be longer than nothing, and so does this: a zero-length
 * phase is a step no clock can land on, and a negative one runs the light backwards through
 * its own period. A scenario reaches this function by roads other than `validateScenario`.
 *
 * **One bad phase spoils the set.** Dropping the bad ones and keeping the rest would report
 * a sequence nobody wrote as "timings stated" - a red flash of no length filtered out of
 * `[0 s red, 4 s dark]` leaves four seconds of darkness described as what the file said.
 * Null means the file stated none at all, which is a different answer again.
 */
function statedPhases(phases: LightPhase[] | undefined): Phase[] | "unusable" | null {
  if (phases === undefined) return null;
  if (phases.length === 0 || phases.some((phase) => !(phase.seconds > 0))) return "unusable";
  return phases.map((phase) => ({ seconds: phase.seconds, colour: phase.colour ?? null }));
}
