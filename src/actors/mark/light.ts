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
  type PhaseRole,
  type Unreadable,
} from "../../core/light-character.js";
import type { LightPhase, Mark } from "../../core/types.js";

/** Why nothing can be shown flashing. */
export type Unlit =
  | "the file does not say whether it carried a light"
  | "the stated timings include a phase of no length"
  | "the stated timings do not run for the period the character states"
  | "the stated timings show a colour the character does not"
  | "the stated timings never show one of the character's colours"
  | "the stated timings divide light and darkness unlike the class of light they are on"
  | "the stated timings are not the shape of the character's own sequence"
  | "the stated timings do not keep the character's groups apart"
  | "the stated timings hold a long flash for less than two seconds"
  | "the stated timings hold an ordinary flash for two seconds or more"
  | "the stated timings flash at a rate that is not the character's class"
  | "the stated timings spell a different letter from the character's"
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
    wrongShape(drawn, stated) ??
    wrongColour(drawn, stated) ??
    wrongBalance(character, stated) ??
    wrongParts(character, drawn, stated)
  );
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
 * The few durations E-110 fixes for a particular phase rather than for the sequence.
 *
 * These are what make a character its class. A "long flash" of half a second is not a long
 * flash (Table 2 class 4.2 and its footnote); a group whose separating eclipse is no longer
 * than the ones inside it is not a group (class 4.3), so `Fl(2+1)` stated with even gaps is
 * `Fl(3)`, which in the buoyage is a different mark; and a quick light flashing at twelve a
 * minute is a flashing light (classes 5 to 7). The rest of the split stays free.
 */
function wrongParts(character: LightCharacter, drawn: Phase[], stated: Phase[]): Unlit | null {
  // Two seconds is the line between a flash and a long flash (Table 2 class 4.2 and its
  // footnote), and it cuts both ways: a flash of 2.2 s under `Fl` is an LFl on the water with
  // the page still saying `Fl`, which in the buoyage is a safe-water mark shown as a special
  // one.
  if (lengthsOf(drawn, stated, "long flash").some((seconds) => seconds < 2)) {
    return "the stated timings hold a long flash for less than two seconds";
  }
  if (lengthsOf(drawn, stated, "flash").some((seconds) => seconds >= 2)) {
    return "the stated timings hold an ordinary flash for two seconds or more";
  }
  if (dashShorterThanDot(drawn, stated)) {
    return "the stated timings spell a different letter from the character's";
  }
  return separatorsTooShort(drawn, stated) ?? offItsRate(character, drawn, stated);
}

/** The stated durations of the phases the character built for one purpose. */
function lengthsOf(drawn: Phase[], stated: Phase[], role: PhaseRole): number[] {
  return stated.filter((_, i) => drawn[i]?.role === role).map((phase) => phase.seconds);
}

/**
 * A dash is "not less than three times the duration of a dot" (Table 2 class 8).
 *
 * Which is not a nicety: dot-then-dash is A and dash-then-dot is N, and a safe-water mark
 * shows Mo(A). Timings that reverse the two spell a different letter under the same
 * character.
 */
function dashShorterThanDot(drawn: Phase[], stated: Phase[]): boolean {
  const dots = lengthsOf(drawn, stated, "dot");
  const dashes = lengthsOf(drawn, stated, "dash");
  if (dots.length === 0 || dashes.length === 0) return false;
  return Math.min(...dashes) < 3 * Math.max(...dots);
}

/**
 * The phase that separates one group from the next is three times the ones inside a group.
 *
 * Measured against the phases of the same kind - darkness for a flashing light, light for an
 * occulting one - because that is the pair the rule compares.
 */
function separatorsTooShort(drawn: Phase[], stated: Phase[]): Unlit | null {
  const separators = stated.filter((_, i) => drawn[i]?.role === "separator");
  if (separators.length === 0) return null;

  for (const separator of separators) {
    const inside = stated.filter(
      (phase, i) =>
        drawn[i]?.role !== "separator" && (phase.colour === null) === (separator.colour === null),
    );
    if (inside.some((phase) => separator.seconds < 3 * phase.seconds - 1e-9)) {
      return "the stated timings do not keep the character's groups apart";
    }
  }
  return null;
}

/** Quick is 50 to 79 flashes a minute, very quick 80 to 159, ultra quick 160 to 300. */
function offItsRate(character: LightCharacter, drawn: Phase[], stated: Phase[]): Unlit | null {
  const band = RATE_BAND[character.klass];
  if (band === undefined) return null;

  // A CONTINUOUS quick light has no group, so it has no pair inside one: its whole cycle is
  // the flash cycle. Left to the pair rule alone, `Q` stated as two seconds lit and three
  // dark passes as a quick light while showing twelve flashes a minute.
  // Falling back to the whole cycle whenever no pair inside a group can be measured, not
  // only where the character has no group at all: any arrangement that leaves the rate
  // unmeasured would otherwise pass a quick light unchecked.
  const inside = insideRates(drawn, stated);
  const rates =
    inside.length > 0 ? inside : [60 / stated.reduce((total, phase) => total + phase.seconds, 0)];
  return rates.some((rate) => rate < band[0] || rate > band[1])
    ? "the stated timings flash at a rate that is not the character's class"
    : null;
}

/**
 * The rate of each flash-and-eclipse pair inside a group, in flashes a minute.
 *
 * Inside a group only. The eclipse that separates the groups is not part of anybody's rate -
 * a west cardinal's nine flashes are quick and the six and a half seconds after them are not
 * a slow tenth flash. A continuous quick light has no pair here at all, and is held to its
 * band by its period instead, in `core/light-character.ts`.
 */
function insideRates(drawn: Phase[], stated: Phase[]): number[] {
  const roles = drawn.map((phase) => phase.role);
  const seconds = stated.map((phase) => phase.seconds);
  const rates: number[] = [];
  for (let i = 0; i + 1 < roles.length; i += 1) {
    const pair = (seconds[i] ?? 0) + (seconds[i + 1] ?? 0);
    const inside = roles[i] === "flash" && roles[i + 1] !== "separator";
    if (inside) rates.push(60 / pair);
  }
  return rates;
}

/** The bands that define the quick classes (E-110 Table 2, classes 5, 6 and 7). */
const RATE_BAND: Partial<Record<LightCharacter["klass"], [number, number]>> = {
  Q: [50, 79],
  VQ: [80, 159],
  UQ: [160, 300],
};

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
