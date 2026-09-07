/**
 * The rhythmic character of a light: the thing that says which mark it is.
 *
 * Under the IALA Maritime Buoyage System the four cardinal marks are told apart by nothing
 * else - north is a continuous quick light, east three flashes, south six and a long flash,
 * west nine - so a steady dot where a Q(9) should be is not a cosmetic loss. It is a mark
 * misidentified, and the quadrant a ship must pass on is carried in the count of the flashes.
 *
 * **The grammar lives here rather than in the data.** A table of on/off times per mark would
 * put the grammar in every scenario, where each one could get it wrong separately. This is
 * the same shape as `core/celestial.ts` turning a time and a place into an altitude: a small
 * closed vocabulary in, arithmetic out.
 *
 * Everything numeric below comes from **IALA Recommendation E-110, "Rhythmic Characters of
 * Lights on Aids to Navigation", Edition 4.0, December 2016** - Table 1 (maximum periods),
 * Table 2 (the classes and their constraints) and Table 3 (what the buoyage assigns to each
 * mark). Nothing here is invented, and `test/light-character.spec.ts` checks the generated
 * sequences against Table 2's constraints rather than against this file's own arithmetic.
 *
 * **Table 3's per-mark remarks are not applied here, and cannot be.** Some of them tighten
 * the timings for one kind of mark - an isolated danger's flash and eclipse together are to
 * be 1 to 1.5 s in a 5 s period, say - and knowing that a character belongs to an isolated
 * danger means knowing what the mark MEANS, which the format cannot state yet. That is
 * issue #42, and it wants this block as its source of truth rather than a second one. What
 * is generated here conforms to Table 2, which binds every character regardless of what is
 * carrying it.
 *
 * **The abbreviation does not determine the sequence, and that is the whole difficulty.**
 * `Fl 4s` says one flash in every four seconds; it does not say how long the flash is.
 * E-110 gives bounds and worked examples, not a function - the exact split comes from the
 * Light List entry for that particular light. So a sequence generated here is `inferred`,
 * never `measured`, and whatever draws or prints it has to say so.
 */

/** Colours the buoyage uses. Red and green for lateral, white for cardinal, yellow for
 * special, blue with yellow for an emergency wreck marking buoy (E-110 note 4). */
export const LIGHT_COLOURS = ["white", "red", "green", "yellow", "blue"] as const;
export type LightColour = (typeof LIGHT_COLOURS)[number];

/** The abbreviations a chart and a Light List print for those colours. */
const COLOUR_CODES: Record<string, LightColour> = {
  W: "white",
  R: "red",
  G: "green",
  Y: "yellow",
  Bu: "blue",
};

/**
 * The classes of E-110 Table 2 that a mark can carry.
 *
 * `F` is here because a file may state one, not because a mark should: E-110 note 2 to
 * Table 3 says a single fixed light "shall not be used" on a mark within the buoyage,
 * because it may not be recognised as an aid to navigation at all.
 */
export const LIGHT_CLASSES = [
  "F",
  "Oc",
  "Iso",
  "Fl",
  "LFl",
  "Q",
  "VQ",
  "UQ",
  "Mo",
  "Al",
  "OcAl",
] as const;
export type LightClass = (typeof LIGHT_CLASSES)[number];

export interface LightCharacter {
  klass: LightClass;
  /** Flashes or eclipses per group: `[]` plain, `[3]` a group of three, `[2, 1]` composite. */
  groups: number[];
  /** The long flash a south cardinal carries after its group - `Q(6) + LFl`. */
  longFlash: boolean;
  /** One colour, or two for an alternating light. Empty where the file states none. */
  colours: LightColour[];
  /** Seconds. Null for a continuous quick light, whose period is its own flash cycle. */
  periodSeconds: number | null;
  /** The letters of a Morse light, e.g. "A". Empty for every other class. */
  morse: string;
}

/**
 * Why a character could not be read, exhaustively.
 *
 * A reason rather than a bare null, and never a fallback to something plainer: reading
 * `Fl(2) W 10s` as a single flash turns an isolated-danger mark into a special mark, on
 * screen, with the page agreeing. Nothing is drawn flashing that could not be read.
 */
export type Unreadable =
  | "nothing stated"
  | "no class in it"
  | "the group is not a count"
  | "the period is not a number"
  | "a colour this system does not use"
  | "a letter that is not in the Morse code"
  | "an alternating light with fewer than two colours"
  | "a period of no length"
  | "a period too short for the flashes in it"
  | "a period too short for that class of light"
  | "a period outside the rate that makes it that class"
  | "a Morse light with no letters in it"
  | "a group on a class that has none"
  | "a long flash on a class that does not take one"
  | "two colours on a light that does not alternate"
  | "a group of one, which is not a group"
  | "a composite group on a class that has none"
  | "a composite group of more than two groups"
  | "a composite group whose groups are the same size"
  | "an alternating light of more than two colours"
  | "an alternating light showing one colour twice"
  | Nonconformity;

export type CharacterReading =
  { read: true; character: LightCharacter } | { read: false; because: Unreadable };

/** Longest first, so `LFl` is not read as `L` and `OcAl` is not read as `Oc`. */
const CLASS_ORDER: LightClass[] = [
  "OcAl",
  "LFl",
  "Iso",
  "VQ",
  "UQ",
  "Mo",
  "Al",
  "Oc",
  "Fl",
  "Q",
  "F",
];

const MORSE: Record<string, string> = {
  A: ".-",
  B: "-...",
  C: "-.-.",
  D: "-..",
  E: ".",
  F: "..-.",
  G: "--.",
  H: "....",
  I: "..",
  J: ".---",
  K: "-.-",
  L: ".-..",
  M: "--",
  N: "-.",
  O: "---",
  P: ".--.",
  Q: "--.-",
  R: ".-.",
  S: "...",
  T: "-",
  U: "..-",
  V: "...-",
  W: ".--",
  X: "-..-",
  Y: "-.--",
  Z: "--..",
};

/**
 * Read a Light List abbreviation - "Q(6) + LFl 15s", "Fl(2+1) R 10s", "Mo(A) W 7s".
 *
 * Spacing varies between publications and between hands, so it is thrown away first. What is
 * not thrown away is anything the grammar does not recognise: an unreadable character is
 * reported as such rather than reduced to the part that parsed.
 */
export function parseCharacter(text: string): CharacterReading {
  const tidy = text.replace(/\s+/g, "");
  if (tidy === "") return { read: false, because: "nothing stated" };

  const klass = CLASS_ORDER.find((name) => tidy.startsWith(name));
  if (!klass) return { read: false, because: "no class in it" };

  let rest = tidy.slice(klass.length);
  const groups = takeGroups(rest, klass);
  if (typeof groups === "string") return { read: false, because: groups };
  rest = rest.slice(groups.consumed);

  const longFlash = rest.startsWith("+LFl");
  if (longFlash) rest = rest.slice("+LFl".length);

  return assemble({ klass, groups: groups.counts, longFlash }, rest);
}

/** What the class, the bracket and the trailing long flash left to read. */
interface Head {
  klass: LightClass;
  groups: number[];
  longFlash: boolean;
}

/** The rest of the abbreviation: the colours, then the period. */
function assemble(head: Head, rest: string): CharacterReading {
  const period = /(\d+(?:\.\d+)?)s$/.exec(rest);
  const colourPart = period === null ? rest : rest.slice(0, rest.length - period[0].length);
  const colours = takeColours(colourPart);
  if (colours === null) return { read: false, because: "a colour this system does not use" };

  const morse = head.klass === "Mo" ? lettersOf(head.groups) : "";
  const character = characterOf(head, colours, period?.[1], morse);
  const misfit = wrongForItsClass(character);
  return misfit === null ? fitsItsPeriod(character) : { read: false, because: misfit };
}

/** The classes that count something in brackets (Table 2 classes 2.2, 2.3, 4.3, 4.4, 5.2, 6.2). */
const GROUPED_CLASSES: LightClass[] = ["Oc", "Fl", "Q", "VQ"];

/** And the two that take a COMPOSITE group - successive groups of different sizes. */
const COMPOSITE_CLASSES: LightClass[] = ["Oc", "Fl"];

/**
 * Parts of the abbreviation that its class does not take.
 *
 * **Every one of these would otherwise be printed and then ignored.** `Iso(3) W 4s` shows a
 * group on the page and an isophase light in the picture; `Fl WR 4s` names two colours and
 * shows only the first. A field the format accepts and the renderer drops is the page and the
 * picture disagreeing, with whoever wrote the file caught in between.
 */
function wrongForItsClass(character: LightCharacter): Unreadable | null {
  const grouping = wrongGrouping(character);
  if (grouping !== null) return grouping;
  // A trailing long flash belongs to the south cardinal, which is a group quick or group very
  // quick light and nothing else (Table 2 classes 5.2 and 6.2).
  if (character.longFlash && character.klass !== "Q" && character.klass !== "VQ") {
    return "a long flash on a class that does not take one";
  }
  // A Morse light IS its letters: with none it has no sequence at all, and would read as
  // valid, print as "Mo W 7s", and draw as a light that never shows.
  if (character.klass === "Mo" && character.morse === "") {
    return "a Morse light with no letters in it";
  }
  return wrongColours(character);
}

/**
 * What the bracket is allowed to hold.
 *
 * A group of one is a single-flashing light with a bracket round it, and it reads as a group
 * everywhere that asks: `Q(1) 10s` would be drawn as one flash in ten seconds - six a
 * minute - while calling itself quick. A trailing one in a COMPOSITE is a real thing, and
 * E-110 reserves `Fl(2+1)` for a preferred-channel mark.
 */
function wrongGrouping(character: LightCharacter): Unreadable | null {
  if (character.groups.length === 0) return null;
  if (!GROUPED_CLASSES.includes(character.klass)) return "a group on a class that has none";
  if (character.groups.length === 1 && character.groups[0] === 1) {
    return "a group of one, which is not a group";
  }
  return wrongComposite(character);
}

/**
 * What a composite group is allowed to be.
 *
 * Table 2 defines one for occulting and flashing lights only (classes 2.3 and 4.4), as two
 * successive groups "of different numbers". Each of those is definitional rather than a
 * preference: `Fl(2+2)` is `Fl(2)` twice in a period, which is `Fl(2)` with half the period,
 * and a page printing `Fl(2+2)` over it would be naming a mark that is not there. The one
 * composite the buoyage reserves - `Fl(2+1)` - is the preferred-channel mark.
 */
function wrongComposite(character: LightCharacter): Unreadable | null {
  if (character.groups.length < 2) return null;
  if (!COMPOSITE_CLASSES.includes(character.klass)) {
    return "a composite group on a class that has none";
  }
  if (character.groups.length > 2) return "a composite group of more than two groups";
  return character.groups[0] === character.groups[1]
    ? "a composite group whose groups are the same size"
    : null;
}

/**
 * How many colours the class takes.
 *
 * An alternating light is defined by showing different colours in turn (Table 2 classes 10
 * and 11), so one colour does not describe one - drawn from the first colour twice it would
 * burn steadily, which is another class again. Every other class shows one colour, and a
 * second named beside it would be printed on the page and dropped from the picture.
 */
function wrongColours(character: LightCharacter): Unreadable | null {
  const alternates = character.klass === "Al" || character.klass === "OcAl";
  if (!alternates) {
    return character.colours.length > 1 ? "two colours on a light that does not alternate" : null;
  }
  if (character.colours.length < 2) return "an alternating light with fewer than two colours";
  // Exactly two, and different ones. `Al WW` alternates white with white, which is a fixed
  // light with a page calling it alternating; a third colour is printed and then dropped.
  if (character.colours.length > 2) return "an alternating light of more than two colours";
  return character.colours[0] === character.colours[1]
    ? "an alternating light showing one colour twice"
    : null;
}

/**
 * The bands that define the quick classes: 50 to 79 flashes a minute, 80 to 159, 160 to 300
 * (E-110 Table 2, classes 5, 6 and 7).
 */
const RATE_BAND: Partial<Record<LightClass, [number, number]>> = {
  Q: [50, 79],
  VQ: [80, 159],
  UQ: [160, 300],
};

/**
 * A continuous quick light's period is its own flash cycle, so a stated one has to be a rate
 * inside the band that makes it quick.
 *
 * `Q W 10s` would otherwise be drawn as one flash in ten seconds - six a minute, which is a
 * single-flashing light - under a page printing "Q". A GROUP quick light is different: there
 * the period covers the whole group and the rate lives inside it, which the generated
 * sequence already handles.
 */
function outsideItsRate(character: LightCharacter, period: number): boolean {
  const band = RATE_BAND[character.klass];
  if (band === undefined || character.groups.length > 0) return false;
  const rate = 60 / period;
  return rate < band[0] || rate > band[1];
}

/**
 * The shortest period each class can be shown in and still BE that class.
 *
 * From E-110 Table 2: an isophase, single-occulting or single-flashing light has "the period
 * should not be less than 2 s", and a long-flashing light needs darkness of three times a
 * flash of not less than two seconds. Below these a light is a different class - "Fl 1s" is
 * sixty flashes a minute, which is a quick light and not a flashing one.
 *
 * **Table 1's maxima are deliberately not enforced.** They tell an authority what to build,
 * and this tool reconstructs lights that exist: refusing a source's own figure because IALA
 * would not recommend it is letting a derivation rule swallow a stated value.
 */
const LEAST_PERIOD_SECONDS: Partial<Record<LightClass, number>> = {
  Iso: 2,
  Oc: 2,
  Fl: 2,
  LFl: 8,
};

/**
 * A last question of the whole character: can it be shown in the period it states?
 *
 * `Q(9) W 2s` cannot. Nine quick flashes and the eclipses between them take 8.5 s, so the
 * sequence built for it runs for nine seconds while the page goes on printing "2s" - the
 * picture and the page reporting different lights, which is the failure this repository keeps
 * returning to. Refused rather than stretched, because a period is a stated figure and this
 * tool does not get to quietly disagree with one.
 *
 * Asked by building the sequence and comparing, rather than by working out a minimum period
 * for each class: one rule builds the phases, so one rule should answer for them.
 */
function fitsItsPeriod(character: LightCharacter): CharacterReading {
  const stated = character.periodSeconds;
  if (stated === null) return { read: true, character };
  if (stated <= 0) return { read: false, because: "a period of no length" };

  const least = LEAST_PERIOD_SECONDS[character.klass];
  if (least !== undefined && stated < least) {
    return { read: false, because: "a period too short for that class of light" };
  }
  if (outsideItsRate(character, stated)) {
    return { read: false, because: "a period outside the rate that makes it that class" };
  }

  const phases = phasesOf(character);
  const drawn = cycleSeconds(phases);
  if (drawn - stated > 1e-9) {
    return { read: false, because: "a period too short for the flashes in it" };
  }

  // And the sequence it would draw has to be a light of the class written above it. The same
  // question `actors/mark/light.ts` asks of a sequence a scenario states for itself, asked by
  // the same code: a stated sequence and a generated one are judged alike or the tool ends up
  // refusing an arrangement it produces itself.
  const fault = nonconformity(character, phases);
  return fault === null ? { read: true, character } : { read: false, because: fault };
}

function characterOf(
  head: Head,
  colours: LightColour[],
  period: string | undefined,
  morse: string,
): LightCharacter {
  return {
    klass: head.klass,
    // A Morse light's bracket holds its letters, not a count of anything.
    groups: head.klass === "Mo" ? [] : head.groups,
    longFlash: head.longFlash,
    colours,
    periodSeconds: period === undefined ? null : Number(period),
    morse,
  };
}

function lettersOf(codes: number[]): string {
  return codes.map((code) => String.fromCharCode(code)).join("");
}

/**
 * `(3)`, `(2+1)`, `(A)` - or nothing, which is not a failure.
 *
 * **What is inside the bracket depends on the class**, so the class has to be known here: a
 * Morse light carries letters and every other class carries counts. Reading letters
 * everywhere would make `Fl(x)` a group of 120 flashes; reading counts everywhere would
 * report a bad Morse letter as a bad number, which sends whoever wrote it looking in the
 * wrong place. The letters come back as their character codes because one return type has to
 * take both, and `assemble` turns them back.
 */
function takeGroups(
  rest: string,
  klass: LightClass,
): { counts: number[]; consumed: number } | Unreadable {
  const wrong: Unreadable =
    klass === "Mo" ? "a letter that is not in the Morse code" : "the group is not a count";
  if (!rest.startsWith("(")) return { counts: [], consumed: 0 };

  const close = rest.indexOf(")");
  if (close < 0) return wrong;
  const inside = rest.slice(1, close);
  if (klass === "Mo") return morseLetters(inside, close + 1, wrong);

  const counts = inside.split("+").map(countOf);
  if (counts.some((count) => count === null)) return wrong;
  return { counts: counts as number[], consumed: close + 1 };
}

/**
 * A Morse light's bracket, which holds letters written together: `Mo(A)`, `Mo(AB)`.
 *
 * Not split on `+`, which is what a group of flashes uses. Read that way `Mo(A+B)` would
 * become the letters AB, print back as `Mo(AB)`, and be drawn as one run of elements with no
 * letter gap in it - which is neither A nor B but the code for something else. E-110 Table 2
 * class 8 allows "a character or characters", so two letters are read; a separator that is
 * not part of the vocabulary is refused instead of being dropped.
 */
function morseLetters(
  inside: string,
  consumed: number,
  wrong: Unreadable,
): { counts: number[]; consumed: number } | Unreadable {
  const codes: number[] = [];
  for (let i = 0; i < inside.length; i += 1) {
    const letter = inside.charAt(i);
    if (MORSE[letter] === undefined) return wrong;
    codes.push(letter.charCodeAt(0));
  }
  return { counts: codes, consumed };
}

/** A group of none is not a group; every other class counts flashes or eclipses. */
function countOf(part: string): number | null {
  return /^\d+$/.test(part) && Number(part) > 0 ? Number(part) : null;
}

function takeColours(part: string): LightColour[] | null {
  if (part === "") return [];
  const codes = part.match(/Bu|[WRGY]/g);
  if (codes?.join("") !== part) return null;
  return codes.map((code) => COLOUR_CODES[code]).filter((c): c is LightColour => c !== undefined);
}

/**
 * What a phase is FOR, where E-110 puts a constraint on that particular phase.
 *
 * Carried on the phase rather than worked out again by whoever needs it:
 * `actors/mark/light.ts` checks a scenario's own timings against the character beside them,
 * and the only way to ask "is this the eclipse that separates the groups" without a second
 * copy of the generation rules is for the generation to say so as it builds.
 */
export type PhaseRole = "separator" | "long flash" | "flash" | "dot" | "dash";

/** One appearance or one eclipse. A null colour is darkness. */
export interface Phase {
  seconds: number;
  colour: LightColour | null;
  role?: PhaseRole;
}

/**
 * The IALA-specified flash rates: 60, 120 and 240 flashes a minute (E-110 Table 2, classes 5,
 * 6 and 7). The classes are DEFINED by bands - quick is 50 to 79 a minute, very quick 80 to
 * 159, ultra quick 160 to 300 - and the specification picks one rate inside each.
 *
 * **The band is what to trust, not the period bounds printed beside it.** The very quick row
 * reads "0.5 s <= p <= 1.6 s" in the published PDF, and 80 flashes a minute is 0.75 s, not
 * 1.6 s. The band is stated twice and unambiguously; the period column is not.
 */
const FLASHES_PER_MINUTE: Partial<Record<LightClass, number>> = { Q: 60, VQ: 120, UQ: 240 };

/** A long flash is "not less than 2 seconds" (E-110 Table 2 class 4.2 and its footnote). */
const LONG_FLASH_SECONDS = 2;

/**
 * A flash is shorter than a long flash, which is the only bound the source puts on it. One
 * second is E-110's own worked example for `Fl`, `Fl(2)` and `Fl(2+1)`, and using it
 * reproduces the published example sequences exactly.
 */
const FLASH_SECONDS = 1;

/**
 * The sequence a light actually shows, one phase after another, repeating.
 *
 * **Inferred, not measured.** The abbreviation bounds these durations and does not fix them,
 * so this is one sequence that conforms rather than the sequence that light shows. Where a
 * scenario states the real durations they are used instead and nothing here runs.
 */
export function phasesOf(character: LightCharacter): Phase[] {
  const colour = character.colours[0] ?? "white";
  switch (character.klass) {
    case "F":
      return [{ seconds: character.periodSeconds ?? 1, colour }];
    case "Iso":
      return isophase(character, colour);
    case "Oc":
      return occulting(character, colour);
    case "Mo":
      return morse(character, colour);
    case "Al":
    case "OcAl":
      return alternating(character);
    default:
      return flashing(character, colour);
  }
}

/** "All the durations of light and darkness are clearly equal" (Table 2 class 3). */
function isophase(character: LightCharacter, colour: LightColour): Phase[] {
  const half = (character.periodSeconds ?? 4) / 2;
  return [
    { seconds: half, colour },
    { seconds: half, colour: null },
  ];
}

/**
 * Light longer than darkness, the eclipses equal (Table 2 class 2).
 *
 * Single occulting takes the source's own proportion - "the duration of an appearance of
 * light should not be less than three times the duration of an eclipse" at its limit, which
 * is E-110's example of l = 3 s, d = 1 s, p = 4 s. A group takes equal eclipses and equal
 * lights within the group, sized so the light between groups is three times one of them.
 */
function occulting(character: LightCharacter, colour: LightColour): Phase[] {
  const period = character.periodSeconds ?? 4;
  const groups = character.groups.length > 0 ? character.groups : [1];
  const unit = occultingUnit(period, groups);

  const phases: Phase[] = [];
  for (const count of groups) {
    for (let i = 0; i < count; i += 1) {
      phases.push({ seconds: unit, colour: null });
      if (i < count - 1) phases.push({ seconds: unit, colour });
    }
    // Between groups, and closing the period, the light is three times the one inside a
    // group (Table 2 class 2.2) - the same separation that makes a group of flashes a group,
    // and for the same reason: level it and Oc(2+1) shows as Oc(3).
    phases.push({ seconds: 3 * unit, colour, role: "separator" });
  }
  return closeThePeriod(phases, period, 3 * unit);
}

/**
 * The eclipse an occulting light hides for, and the light between eclipses inside a group.
 *
 * Taken as long as the period allows, which puts the light between groups at its minimum of
 * three times the one inside one. For a single occulting light that comes to a quarter of the
 * period - E-110's own example of l = 3 s, d = 1 s, p = 4 s.
 */
function occultingUnit(period: number, groups: number[]): number {
  const eclipses = groups.reduce((total, count) => total + count, 0);
  const inside = groups.reduce((total, count) => total + count - 1, 0);
  const between = 3 * groups.length;
  return period / (eclipses + inside + between);
}

/**
 * Every flashing class, including the quick ones and the south cardinal's trailing long
 * flash. Darkness longer than light, and the eclipse between groups at least three times the
 * eclipse within one (Table 2 classes 4, 5, 6, 7).
 */
function flashing(character: LightCharacter, colour: LightColour): Phase[] {
  const period = character.periodSeconds;
  const flash = flashLength(character, period);
  // Light and darkness equal within a group, which is what every worked example in Table 2
  // does; the eclipse that closes the period then carries the rest.
  const dark = flash;
  const groups = character.groups.length > 0 ? character.groups : [1];
  const closing = closingEclipse(character, dark);
  // A long-flashing light's single appearance IS the long flash, and has to be held to the
  // two seconds that make it one rather than to the under-two that makes an ordinary flash.
  const role: PhaseRole = character.klass === "LFl" ? "long flash" : "flash";

  const phases: Phase[] = [];
  groups.forEach((count, index) => {
    for (let i = 0; i < count; i += 1) {
      phases.push({ seconds: flash, colour, role });
      if (i < count - 1) phases.push({ seconds: dark, colour: null });
    }
    phases.push(afterAGroup(character, index === groups.length - 1, dark, closing));
  });

  if (character.longFlash) {
    phases.push({ seconds: LONG_FLASH_SECONDS, colour, role: "long flash" });
    phases.push({ seconds: closing, colour: null, role: "separator" });
  }
  return closeThePeriod(phases, period, closing);
}

/**
 * The eclipse that follows a group.
 *
 * **Three times the one inside the group where another group follows** (Table 2 class 4.3):
 * at the same length a composite Fl(2+1) would show as a plain Fl(3), which in the buoyage is
 * a different mark. **But the eclipse before a LONG FLASH is not that**: Table 3 says it
 * "should be equal to the duration of the eclipses between the flashes", so the south
 * cardinal's six quick flashes run straight into its long one.
 */
function afterAGroup(
  character: LightCharacter,
  last: boolean,
  dark: number,
  closing: number,
): Phase {
  if (!last) return { seconds: 3 * dark, colour: null, role: "separator" };
  // The eclipse before a long flash belongs to the group, so it is not a separator: a south
  // cardinal's separating darkness comes after the long flash instead.
  if (character.longFlash) return { seconds: dark, colour: null };
  return { seconds: closing, colour: null, role: "separator" };
}

/**
 * The darkness at the end of the period, before a stated period stretches it.
 *
 * A character with no period on it - "Q(3)" as written on some charts - would otherwise close
 * with an eclipse the length of the ones inside its group, and show as a continuous quick
 * light. And after a long flash it is at least as long as that flash: Table 3 says "the
 * duration of a long flash should not be greater than the duration of the eclipse immediately
 * following the long flash".
 */
function closingEclipse(character: LightCharacter, dark: number): number {
  if (character.longFlash) return Math.max(3 * dark, LONG_FLASH_SECONDS);
  return character.groups.length > 0 ? 3 * dark : dark;
}

/**
 * How long one flash lasts.
 *
 * A quick, very quick or ultra quick light takes it from its rate, which is what makes it
 * that class at all. Everything else takes a flash of a second - shorter where the period is
 * too short to leave three times as much darkness, since darkness longer than light is the
 * definition of a flashing light rather than a preference.
 */
function flashLength(character: LightCharacter, period: number | null): number {
  const rate = FLASHES_PER_MINUTE[character.klass];
  if (rate !== undefined) {
    // A CONTINUOUS quick light's period is its own flash cycle, so a stated one sets the
    // rate: `Q W 0.8s` is 75 flashes a minute, which is a quick light. Built at the
    // specification's 60 instead, it would run for a second and be refused for not fitting
    // the period it just stated. A group's period covers the whole group, and there the
    // specified rate is what lives inside it.
    if (character.groups.length === 0 && period !== null) return period / 2;
    return 60 / rate / 2;
  }
  if (character.klass === "LFl") return LONG_FLASH_SECONDS;

  const flashes = character.groups.reduce((total, count) => total + count, 0) || 1;
  const room = (period ?? 4) / (2 * flashes + 2);
  return Math.min(FLASH_SECONDS, room);
}

/**
 * The darkness that fills what is left of the period.
 *
 * The last eclipse in the list is the one between groups, so it absorbs the remainder rather
 * than a new phase being added: a sequence that ended with two eclipses in a row would show
 * the same picture and count wrong when anything asked how many flashes there were.
 */
function closeThePeriod(phases: Phase[], period: number | null, dark: number): Phase[] {
  if (period === null || phases.length === 0) return phases;

  // Whatever phase comes last, since it is the one the class builds to absorb the remainder:
  // darkness for a flashing light, and the long appearance of light for an occulting one.
  const kept = phases.slice(0, -1);
  const filled = kept.reduce((total, phase) => total + phase.seconds, 0);
  // Never shorter than the phase the class asked for: a stated period too short for the
  // character would otherwise close it with a negative length, and the sequence would run
  // backwards through itself. `parseCharacter` refuses such a period, having built the
  // sequence and found it did not fit.
  const closing = phases[phases.length - 1];
  return [
    ...kept,
    {
      seconds: Math.max(period - filled, dark),
      colour: closing?.colour ?? null,
      ...(closing?.role === undefined ? {} : { role: closing.role }),
    },
  ];
}

/**
 * A Morse light: appearances of two clearly different durations (Table 2 class 8).
 *
 * "The duration of a 'dot' should be about 0.5 s, and the duration of a 'dash' should not be
 * less than three times the duration of a 'dot'" - which is E-110's own Mo(A) example of
 * l = 0.5 s, l' = 1.5 s, d = 0.5 s, d' = 4.5 s, p = 7 s.
 */
function morse(character: LightCharacter, colour: LightColour): Phase[] {
  const dot = 0.5;
  const phases: Phase[] = [];
  for (let i = 0; i < character.morse.length; i += 1) {
    for (const element of MORSE[character.morse.charAt(i)] ?? "") {
      const dash = element === "-";
      phases.push({ seconds: dash ? dot * 3 : dot, colour, role: dash ? "dash" : "dot" });
      phases.push({ seconds: dot, colour: null });
    }
    // Three dots of darkness between letters against one between elements - the Morse code's
    // own spacing (ITU-R M.1677). Level them and two letters run together into a third,
    // longer code that means something else.
    const gap = phases.at(-1);
    if (gap && i < character.morse.length - 1) {
      gap.seconds = dot * 3;
      gap.role = "separator";
    }
  }
  // The darkness closing the period separates one repetition of the letters from the next,
  // like the eclipse after a group of flashes - and marking it so keeps it out of the
  // comparison that holds the gap BETWEEN letters to three times the gaps inside one.
  const closing = phases.at(-1);
  if (closing) closing.role = "separator";
  return closeThePeriod(phases, character.periodSeconds, dot);
}

/**
 * Two colours in turn, which for an emergency wreck marking buoy is blue and yellow with an
 * eclipse between them (E-110 Table 2 classes 10 and 11; the OcAl example is l = 1 s,
 * d = 0.5 s, p = 3 s).
 */
function alternating(character: LightCharacter): Phase[] {
  const period = character.periodSeconds ?? 4;
  // Two colours by the time it reaches here: `parseCharacter` refuses an alternating light
  // that names fewer, rather than letting one colour be shown twice as a steady light.
  const [first, second] = [character.colours[0] ?? "white", character.colours[1] ?? "white"];
  if (character.klass === "Al") {
    return [
      { seconds: period / 2, colour: first },
      { seconds: period / 2, colour: second },
    ];
  }
  const lit = period / 3;
  return [
    { seconds: lit, colour: first },
    { seconds: lit / 2, colour: null },
    { seconds: lit, colour: second },
    { seconds: lit / 2, colour: null },
  ];
}

/** How long one turn of the sequence takes, which is the period whether or not one was stated. */
export function cycleSeconds(phases: Phase[]): number {
  return phases.reduce((total, phase) => total + phase.seconds, 0);
}

/**
 * What the light is showing at this instant, or null for darkness.
 *
 * The clock is the scenario's, so two marks in one scene are not synchronised by accident:
 * they run from the same zero and drift apart by their own periods, which is what a
 * wheelhouse sees.
 */
export function showingAt(phases: Phase[], secondsFromStart: number): LightColour | null {
  const cycle = cycleSeconds(phases);
  if (cycle <= 0) return null;

  let position = secondsFromStart % cycle;
  if (position < 0) position += cycle;

  // The phase reached last answers for whatever is left over, so the rounding that can
  // accumulate across a cycle of many short flashes lands in the eclipse that closes it
  // rather than in nothing at all.
  let showing: LightColour | null = null;
  for (const phase of phases) {
    showing = phase.colour;
    if (position < phase.seconds) break;
    position -= phase.seconds;
  }
  return showing;
}

/** The abbreviation again, from the parsed character - so a page can show what it understood. */
export function formatCharacter(character: LightCharacter): string {
  const group =
    character.klass === "Mo"
      ? `(${character.morse})`
      : character.groups.length > 0
        ? `(${character.groups.join("+")})`
        : "";
  const long = character.longFlash ? "+LFl" : "";
  const colours = character.colours.map(codeFor).join("");
  const period = character.periodSeconds === null ? "" : ` ${character.periodSeconds}s`;
  return `${character.klass}${group}${long}${colours === "" ? "" : ` ${colours}`}${period}`;
}

function codeFor(colour: LightColour): string {
  return Object.keys(COLOUR_CODES).find((code) => COLOUR_CODES[code] === colour) ?? "";
}

/**
 * What Table 2 asks of a SEQUENCE, rather than of an abbreviation.
 *
 * One validator, run over the sequence this file generates and again over any a scenario
 * states for itself (`actors/mark/light.ts`). Both are answering the same question - is this
 * a light of the class written above it - and two validators would drift, which is how a
 * stated `Q W 1s` of half a second lit and half dark came to be refused while the generated
 * one, E-110's own worked example, was not.
 *
 * Measured off the phases. The roles the generator attaches say which phase is meant to be
 * what; the durations are then read from the sequence itself, so a stated sequence is judged
 * by what it does rather than by what it was called.
 */
export type Nonconformity =
  | "light and darkness divided unlike its class"
  | "a long flash of less than two seconds"
  | "an ordinary flash of two seconds or more"
  | "flashes too close together in a group to be counted"
  | "a group not kept apart from the next"
  | "a composite group whose last darkness is shorter than the one before"
  | "a rate that is not its own class's"
  | "a dash no longer than a dot"
  | "phases of unequal length inside a group";

/** How each class divides its period, which is what the class MEANS (Table 2 classes 2-7). */
const BALANCE: Partial<Record<LightClass, "lit" | "dark" | "equal" | "dark or equal">> = {
  Oc: "lit",
  OcAl: "lit",
  Iso: "equal",
  Fl: "dark",
  LFl: "dark",
  // "d >= l" (classes 5.1 and 6.1), not "d > l": E-110's own examples for a continuous quick
  // and very quick light are half lit and half dark.
  Q: "dark or equal",
  VQ: "dark or equal",
  UQ: "dark or equal",
};

export function nonconformity(character: LightCharacter, phases: Phase[]): Nonconformity | null {
  return (
    wrongBalance(character, phases) ??
    wrongFlashes(phases) ??
    wrongGroupCycle(character, phases) ??
    wrongSeparators(phases) ??
    wrongRate(character, phases) ??
    wrongElements(phases)
  );
}

function wrongBalance(character: LightCharacter, phases: Phase[]): Nonconformity | null {
  const wanted = BALANCE[character.klass];
  if (wanted === undefined) return null;

  const lit = total(phases.filter((phase) => phase.colour !== null));
  const dark = total(phases.filter((phase) => phase.colour === null));
  const held = {
    lit: lit > dark,
    dark: lit < dark,
    equal: Math.abs(lit - dark) < TOLERANCE,
    "dark or equal": lit <= dark + TOLERANCE,
  }[wanted];
  return held ? null : "light and darkness divided unlike its class";
}

/** Two seconds is the line between a flash and a long flash, and it cuts both ways. */
function wrongFlashes(phases: Phase[]): Nonconformity | null {
  if (lengths(phases, "long flash").some((seconds) => seconds < LONG_FLASH_SECONDS)) {
    return "a long flash of less than two seconds";
  }
  return lengths(phases, "flash").some((seconds) => seconds >= LONG_FLASH_SECONDS)
    ? "an ordinary flash of two seconds or more"
    : null;
}

/**
 * "In a group of two flashes, the duration of a flash together with the duration of the
 * eclipse within the group should not be less than 1 s. In a group of three or more flashes,
 * [...] not less than 2 s" (class 4.3, and class 2.2 says the same of an occulting group).
 *
 * A quick light is exempt: its own classes fix that cycle by the rate instead, and `wrongRate`
 * holds it to that.
 */
function wrongGroupCycle(character: LightCharacter, phases: Phase[]): Nonconformity | null {
  if (RATE_BAND[character.klass] !== undefined) return null;
  const biggest = Math.max(...character.groups, 0);
  if (biggest < 2) return null;

  const cycles = withinCycles(phases);
  const least = biggest >= 3 ? 2 : 1;
  return cycles.some((cycle) => cycle < least - TOLERANCE)
    ? "flashes too close together in a group to be counted"
    : null;
}

/**
 * The phase separating two groups is three times the ones inside one, and in a composite
 * group the darkness closing the period is at least as long as the one between the groups
 * (classes 2.3 and 4.4). Level either and the groups stop being groups.
 */
function wrongSeparators(phases: Phase[]): Nonconformity | null {
  const separators = phases.filter((phase) => phase.role === "separator");
  for (const separator of separators) {
    const inside = phases.filter(
      (phase) =>
        phase.role !== "separator" && (phase.colour === null) === (separator.colour === null),
    );
    if (inside.some((phase) => separator.seconds < 3 * phase.seconds - TOLERANCE)) {
      return "a group not kept apart from the next";
    }
  }
  const last = separators.at(-1)?.seconds ?? 0;
  const before = separators.at(-2)?.seconds ?? 0;
  return separators.length > 1 && last < before - TOLERANCE
    ? "a composite group whose last darkness is shorter than the one before"
    : null;
}

/** Quick is 50 to 79 flashes a minute, very quick 80 to 159, ultra quick 160 to 300. */
function wrongRate(character: LightCharacter, phases: Phase[]): Nonconformity | null {
  const band = RATE_BAND[character.klass];
  if (band === undefined) return null;

  // Inside a group where there is one; otherwise the whole cycle, since a continuous quick
  // light's period IS its flash cycle.
  const cycles = withinCycles(phases);
  const rates = (cycles.length > 0 ? cycles : [cycleSeconds(phases)]).map((cycle) => 60 / cycle);
  return rates.some((rate) => rate < band[0] || rate > band[1])
    ? "a rate that is not its own class's"
    : null;
}

/**
 * A dash is "not less than three times the duration of a dot", and the flashes of a group are
 * "of equal duration" - both class definitions rather than preferences. Dot-then-dash is A
 * and dash-then-dot is N, and a group whose flashes differ is not a group of that many.
 */
function wrongElements(phases: Phase[]): Nonconformity | null {
  const dots = lengths(phases, "dot");
  const dashes = lengths(phases, "dash");
  if (dots.length > 0 && dashes.length > 0 && Math.min(...dashes) < 3 * Math.max(...dots)) {
    return "a dash no longer than a dot";
  }
  const flashes = lengths(phases, "flash");
  const uneven = flashes.length > 1 && Math.max(...flashes) - Math.min(...flashes) > TOLERANCE;
  return uneven ? "phases of unequal length inside a group" : null;
}

/** A flash and the eclipse after it, for every pair inside a group. */
function withinCycles(phases: Phase[]): number[] {
  const cycles: number[] = [];
  for (let i = 0; i + 1 < phases.length; i += 1) {
    const lit = phases[i];
    const dark = phases[i + 1];
    if (lit?.colour == null) continue;
    if (dark?.colour !== null || dark.role === "separator") continue;
    cycles.push(lit.seconds + dark.seconds);
  }
  return cycles;
}

function lengths(phases: Phase[], role: PhaseRole): number[] {
  return phases.filter((phase) => phase.role === role).map((phase) => phase.seconds);
}

function total(phases: Phase[]): number {
  return phases.reduce((sum, phase) => sum + phase.seconds, 0);
}

const TOLERANCE = 1e-9;
