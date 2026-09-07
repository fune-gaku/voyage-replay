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
  nonconformity,
  parseCharacter,
  phasesOf,
  type LightCharacter,
  type Phase,
  type Unreadable,
} from "../../core/light-character.js";
import { appearanceOf, type BuoyageRegion } from "./buoyage.js";
import type { LightPhase, Mark } from "../../core/types.js";

/** Why nothing can be shown flashing. */
export type Unlit =
  | "the file does not say whether it carried a light"
  | "the file states a light but neither its character nor a purpose"
  | "a lateral mark whose buoyage region is not stated"
  | "a purpose the buoyage gives no rhythm of its own"
  | "the stated timings include a phase of no length"
  | "the stated timings do not run for the period the character states"
  | "the stated timings show a colour the character does not"
  | "the stated timings never show one of the character's colours"
  | "the stated timings are not the shape of the character's own sequence"
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
      /**
       * Where the character itself came from. A file may say a mark was lit without saying
       * what it showed, and the buoyage answers that: a north cardinal shows VQ because it is
       * a north cardinal. The page says which, since a generated rhythm and a reported one
       * are the same dot on the water.
       */
      characterFrom: "stated" | "from its purpose";
    }
  | { known: false; because: Unlit };

/**
 * What this mark's light does, or why that cannot be said.
 *
 * One function, so that the page and the picture answer the question the same way. Two
 * readings of the same field is how a panel comes to describe a rhythm the view is not
 * drawing - the fault `plans/done/antenna-offset-6.md` records.
 */
export function lightOf(mark: Mark, region: BuoyageRegion | null = null): LightReading {
  const light = mark.light;
  if (!light) return { known: false, because: "the file does not say whether it carried a light" };

  const written = light.character;
  if (written === undefined) return fromItsPurpose(mark, region);

  const reading = parseCharacter(written);
  if (!reading.read) return { known: false, because: reading.because };

  const stated = statedPhases(light.phases);
  if (stated === "unusable") {
    return { known: false, because: "the stated timings include a phase of no length" };
  }
  if (stated === null) {
    return {
      known: true,
      character: reading.character,
      phases: phasesOf(reading.character),
      timings: "inferred",
      characterFrom: "stated",
    };
  }

  const quarrel = disagreement(reading.character, stated);
  if (quarrel) return { known: false, because: quarrel };
  return {
    known: true,
    character: reading.character,
    phases: stated,
    timings: "stated",
    characterFrom: "stated",
  };
}

/**
 * A file that says the mark was lit without saying what it showed, answered by the buoyage.
 *
 * **Only where the buoyage actually fixes a rhythm.** A lateral mark takes "any character
 * other than the preferred channel's", and a special mark "any other than those reserved" -
 * so for those there is nothing to fall back on, and a rhythm chosen here would identify
 * nothing while looking as though it identified something.
 */
function fromItsPurpose(mark: Mark, region: BuoyageRegion | null): LightReading {
  if (mark.purpose === undefined) {
    return {
      known: false,
      because: "the file states a light but neither its character nor a purpose",
    };
  }
  const meant = appearanceOf(mark.purpose, region);
  if (meant === null) {
    return { known: false, because: "a lateral mark whose buoyage region is not stated" };
  }
  if (meant.character === null) {
    return { known: false, because: "a purpose the buoyage gives no rhythm of its own" };
  }
  return {
    known: true,
    character: meant.character,
    phases: phasesOf(meant.character),
    timings: "inferred",
    characterFrom: "from its purpose",
  };
}

/**
 * Whether the stated timings show the character stated beside them, or nothing.
 *
 * **A file may state both, and they can disagree.** `Fl(2) R 10s` with one ten-second green
 * phase is a red group-flashing light on the page and a steady green one in the picture -
 * the page and the picture reporting different marks, from the same two fields. The timings
 * win where they agree, and where they do not, neither is drawn.
 *
 * What has to match is how long the sequence runs, how many appearances of light it has, and
 * what colours they are. **What is not checked is how long each one lasts** - that is the
 * whole reason for stating them, since the abbreviation never fixed it.
 */
function disagreement(character: LightCharacter, stated: Phase[]): Unlit | null {
  const drawn = phasesOf(character);
  return (
    wrongLength(character, stated) ??
    wrongShape(drawn, stated) ??
    wrongColour(drawn, stated) ??
    // And then the same question the generator answers about its own sequence: is this a
    // light of the class written above it. One validator for both, because two would drift -
    // and did, refusing a stated sequence that the generator produces itself.
    nonconformity(character, wearing(drawn, stated))
  );
}

/**
 * The stated phases, wearing the roles of the sequence they were matched against.
 *
 * `wrongShape` has already established that the two run in the same order and light and
 * darken together, so the role of the nth generated phase is what the nth stated phase is
 * for. The validator then measures the stated durations rather than the generated ones,
 * which is the whole point of stating them.
 */
function wearing(drawn: Phase[], stated: Phase[]): Phase[] {
  return stated.map((phase, i) => {
    const role = drawn[i]?.role;
    return role === undefined ? phase : { ...phase, role };
  });
}

/** The sequence has to run for exactly as long as the character says it does. */
function wrongLength(character: LightCharacter, stated: Phase[]): Unlit | null {
  const period = character.periodSeconds;
  if (period === null) return null;
  const runs = stated.reduce((total, phase) => total + phase.seconds, 0);
  return Math.abs(runs - period) > 1e-9
    ? "the stated timings do not run for the period the character states"
    : null;
}

/**
 * The stated sequence has to have the same phases in the same order as the character's own.
 *
 * A count of appearances alone is not enough: `Fl(2) R 10s` given half a second of red, nine
 * of darkness and half a second of red has two appearances and, repeating, joins its two red
 * ends into one flash. And nothing about the count distinguishes one arrangement of three
 * flashes from another. The durations are still free - that is what stating them is for.
 */
function wrongShape(drawn: Phase[], stated: Phase[]): Unlit | null {
  if (drawn.length !== stated.length) {
    return "the stated timings are not the shape of the character's own sequence";
  }
  const sameNullness = drawn.every(
    (phase, i) => (phase.colour === null) === (stated[i]?.colour === null),
  );
  return sameNullness
    ? null
    : "the stated timings are not the shape of the character's own sequence";
}

/**
 * The colours, both ways round.
 *
 * A colour the character does not name is the obvious half. The other half is a colour it
 * names that never appears: `OcAl BuY 3s` stated as blue, dark, blue, dark passes every count
 * and shows no yellow at all - an alternating light that does not alternate, which is the
 * class the character came from.
 */
function wrongColour(drawn: Phase[], stated: Phase[]): Unlit | null {
  const wanted = new Set<Phase["colour"]>(drawn.map((phase) => phase.colour));
  const shown = new Set<Phase["colour"]>(stated.map((phase) => phase.colour));
  if (![...shown].every((colour) => wanted.has(colour))) {
    return "the stated timings show a colour the character does not";
  }
  return [...wanted].every((colour) => shown.has(colour))
    ? null
    : "the stated timings never show one of the character's colours";
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
