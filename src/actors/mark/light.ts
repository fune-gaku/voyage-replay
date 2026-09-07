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
  | "the stated timings do not run for the period the character states"
  | "the stated timings do not show the character's flashes"
  | "the stated timings show a colour the character does not"
  | "the stated timings put two phases of one colour side by side"
  | "the stated timings never show one of the character's colours"
  | "the stated timings divide light and darkness unlike the class of light they are on"
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
  if (stated === null) {
    return {
      known: true,
      character: reading.character,
      phases: phasesOf(reading.character),
      timings: "inferred",
    };
  }

  const quarrel = disagreement(reading.character, stated);
  if (quarrel) return { known: false, because: quarrel };
  return { known: true, character: reading.character, phases: stated, timings: "stated" };
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
    wrongCount(drawn, stated) ??
    wrongColour(drawn, stated) ??
    wrongBalance(character, stated) ??
    runTogether(stated)
  );
}

/**
 * Which classes are mostly lit, which are mostly dark, and which are neither.
 *
 * This is the definition of the class rather than a property of it (E-110 Table 2): "a light
 * in which the total duration of light in a period is longer than the total duration of
 * darkness" IS an occulting light, and the reverse is a flashing one. Stated timings that get
 * it backwards show an occulting light under a flashing character - `Fl R 4s` with 3.5 s of
 * red and half a second of darkness is a different class of light on the same page.
 *
 * Morse is absent on purpose: a long letter can be lit for most of its period, and E-110 puts
 * no ratio on the class. So is F, which is all light, and Al, which is all light in two
 * colours - the alternation rule catches those instead.
 */
const BALANCE: Partial<Record<LightCharacter["klass"], "lit" | "dark" | "equal">> = {
  Oc: "lit",
  OcAl: "lit",
  Iso: "equal",
  Fl: "dark",
  LFl: "dark",
  Q: "dark",
  VQ: "dark",
  UQ: "dark",
};

function wrongBalance(character: LightCharacter, stated: Phase[]): Unlit | null {
  const wanted = BALANCE[character.klass];
  if (wanted === undefined) return null;

  const lit = stated.reduce((t, p) => t + (p.colour === null ? 0 : p.seconds), 0);
  const dark = stated.reduce((t, p) => t + (p.colour === null ? p.seconds : 0), 0);
  const held =
    wanted === "equal" ? Math.abs(lit - dark) < 1e-9 : wanted === "lit" ? lit > dark : lit < dark;
  return held
    ? null
    : "the stated timings divide light and darkness unlike the class of light they are on";
}

function wrongLength(character: LightCharacter, stated: Phase[]): Unlit | null {
  const period = character.periodSeconds;
  if (period === null) return null;
  const runs = stated.reduce((total, phase) => total + phase.seconds, 0);
  return Math.abs(runs - period) > 1e-9
    ? "the stated timings do not run for the period the character states"
    : null;
}

/** The count is the message: an east cardinal is three flashes and a west is nine. */
function wrongCount(drawn: Phase[], stated: Phase[]): Unlit | null {
  return appearances(stated) === appearances(drawn)
    ? null
    : "the stated timings do not show the character's flashes";
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
 * Two phases of one colour in a row are one phase, whatever the file calls them.
 *
 * `[1 s red, 1 s red, 8 s dark]` counts as two appearances and shows as one flash of two
 * seconds - a single-flashing light where the character says a group of two. The count only
 * means something if the phases actually alternate. An alternating light passes: its two
 * appearances are of DIFFERENT colours, which is what makes it one.
 */
function runTogether(stated: Phase[]): Unlit | null {
  for (let i = 1; i < stated.length; i += 1) {
    if (stated[i]?.colour === stated[i - 1]?.colour) {
      return "the stated timings put two phases of one colour side by side";
    }
  }
  return null;
}

/** How many separate appearances of light there are, which is the count a mark is read by. */
function appearances(phases: Phase[]): number {
  return phases.filter((phase) => phase.colour !== null).length;
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
