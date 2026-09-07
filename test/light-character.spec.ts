import { describe, expect, it } from "vitest";

import {
  cycleSeconds,
  formatCharacter,
  parseCharacter,
  phasesOf,
  showingAt,
  type LightCharacter,
  type Phase,
} from "../src/core/light-character.js";

/**
 * The source for every number in this file is **IALA Recommendation E-110, "Rhythmic
 * Characters of Lights on Aids to Navigation", Edition 4.0, December 2016** - Table 2 for the
 * classes and their constraints, Table 3 for what the buoyage assigns to each mark.
 *
 * The claims are checked against the source's constraints and its worked examples rather
 * than against the implementation's own arithmetic, for the reason `test/celestial.spec.ts`
 * gives: a test that recomputes what the code computes is wrong by exactly the same amount
 * whenever the code is.
 */

function characterOf(text: string): LightCharacter {
  const reading = parseCharacter(text);
  if (!reading.read) throw new Error(`${text} did not parse: ${reading.because}`);
  return reading.character;
}

function sequence(text: string): Phase[] {
  return phasesOf(characterOf(text));
}

/** The lit phases, in order, as durations. */
function flashes(text: string): number[] {
  return sequence(text)
    .filter((phase) => phase.colour !== null)
    .map((phase) => phase.seconds);
}

/** The dark phases, in order, as durations. */
function eclipses(text: string): number[] {
  return sequence(text)
    .filter((phase) => phase.colour === null)
    .map((phase) => phase.seconds);
}

describe("reading a Light List abbreviation", () => {
  it("reads a class, a group, a colour and a period", () => {
    const character = characterOf("Fl(3) G 10s");
    expect(character.klass).toBe("Fl");
    expect(character.groups).toEqual([3]);
    expect(character.colours).toEqual(["green"]);
    expect(character.periodSeconds).toBe(10);
  });

  it("reads a composite group as two groups, not as their sum", () => {
    expect(characterOf("Fl(2+1) R 10s").groups).toEqual([2, 1]);
  });

  /** The south cardinal is the only character with a class and a long flash in it. */
  it("reads the south cardinal's trailing long flash", () => {
    const character = characterOf("Q(6) + LFl 15s");
    expect(character.klass).toBe("Q");
    expect(character.groups).toEqual([6]);
    expect(character.longFlash).toBe(true);
  });

  it("does not read LFl as a flashing light, nor OcAl as an occulting one", () => {
    expect(characterOf("LFl W 10s").klass).toBe("LFl");
    expect(characterOf("OcAl BuY 3s").klass).toBe("OcAl");
    expect(characterOf("OcAl BuY 3s").colours).toEqual(["blue", "yellow"]);
  });

  it("reads a Morse light's letter rather than a count", () => {
    const character = characterOf("Mo(A) W 7s");
    expect(character.morse).toBe("A");
    expect(character.groups).toEqual([]);
  });

  it("does not mind how the abbreviation is spaced", () => {
    expect(formatCharacter(characterOf("Q(6)+LFl15s"))).toBe(
      formatCharacter(characterOf("Q(6) + LFl 15s")),
    );
  });

  /**
   * The classes a file may state that a mark should not carry, and the ones with no group.
   * E-110 note 2 to Table 3: a single fixed light "shall not be used" on a mark within the
   * buoyage, because it may not be recognised as an aid to navigation at all. It is read
   * because a file may say it, not because it is right.
   */
  it("reads the classes with nothing in brackets", () => {
    expect(characterOf("F W 4s").klass).toBe("F");
    expect(characterOf("Al WR 4s").colours).toEqual(["white", "red"]);
    expect(characterOf("UQ").klass).toBe("UQ");
  });

  it("takes a character with no colour stated, since a chart often omits white", () => {
    const character = characterOf("Fl 4s");
    expect(character.colours).toEqual([]);
    expect(character.periodSeconds).toBe(4);
  });

  it("takes a continuous quick light with no period at all", () => {
    expect(characterOf("Q").periodSeconds).toBeNull();
    expect(characterOf("VQ").periodSeconds).toBeNull();
  });

  /**
   * The important refusals. Reading `Fl(2) W 10s` as a single flash would turn an
   * isolated-danger mark into a special mark on screen, with the page agreeing - so anything
   * unreadable is reported as unreadable rather than reduced to the part that parsed.
   */
  it("refuses what it cannot read, and says why", () => {
    expect(parseCharacter("")).toEqual({ read: false, because: "nothing stated" });
    expect(parseCharacter("Zz 4s")).toEqual({ read: false, because: "no class in it" });
    expect(parseCharacter("Fl(x) 4s")).toEqual({
      read: false,
      because: "the group is not a count",
    });
    expect(parseCharacter("Fl(2 W 10s")).toEqual({
      read: false,
      because: "the group is not a count",
    });
    expect(parseCharacter("Fl P 4s")).toEqual({
      read: false,
      because: "a colour this system does not use",
    });
    // A Morse light's bracket holds letters, so a bad one is reported as a bad letter -
    // reporting it as a bad number sends whoever wrote it looking in the wrong place.
    expect(parseCharacter("Mo(£) W 7s")).toEqual({
      read: false,
      because: "a letter that is not in the Morse code",
    });
    expect(parseCharacter("Fl(0) W 4s")).toEqual({
      read: false,
      because: "the group is not a count",
    });
  });

  it("writes back what it read", () => {
    for (const text of ["Fl(2+1) R 10s", "Q(6)+LFl 15s", "Iso W 4s", "Mo(A) W 7s", "VQ"]) {
      expect(formatCharacter(characterOf(text))).toBe(text.replace(" + ", "+"));
    }
  });
});

/**
 * E-110 prints a worked example beside most of its classes. They are not the only conforming
 * sequences - the abbreviation does not fix the durations - but they are the ones an
 * authority wrote down, so a rule that reproduces them is a rule with a source rather than a
 * preference.
 */
describe("the sequences E-110 prints as its own examples", () => {
  it("gives a continuous quick light 60 flashes a minute, and a very quick 120", () => {
    // Table 2 class 5.1: "l = d = 0.5 s; p = 1 s". Class 6.1: "l = d = 0.25 s; p = 0.5 s".
    expect(sequence("Q")).toEqual([
      { seconds: 0.5, colour: "white" },
      { seconds: 0.5, colour: null },
    ]);
    expect(cycleSeconds(sequence("VQ"))).toBeCloseTo(0.5, 9);
    expect(60 / cycleSeconds(sequence("VQ"))).toBe(120);
    expect(60 / cycleSeconds(sequence("UQ"))).toBe(240);
  });

  it("gives the east cardinal three flashes and 7.5 s of darkness", () => {
    // Table 2 class 5.2: "d' = 7.5 s; l = d = 0.5 s; c = 1 s; p = 10 s".
    expect(flashes("Q(3) W 10s")).toEqual([0.5, 0.5, 0.5]);
    expect(eclipses("Q(3) W 10s")).toEqual([0.5, 0.5, 7.5]);
  });

  it("gives the west cardinal nine flashes and 6.5 s of darkness", () => {
    // Table 2 class 5.2: "d' = 6.5 s; l = d = 0.5 s; c = 1 s; p = 15 s".
    expect(flashes("Q(9) W 15s")).toHaveLength(9);
    expect(eclipses("Q(9) W 15s").at(-1)).toBeCloseTo(6.5, 9);
  });

  it("gives the south cardinal six flashes, a long flash, and 7 s of darkness", () => {
    // Table 2 class 5.2: "d' = 7 s; l' = 2 s; l = d = 0.5 s; c = 1 s; p = 15 s".
    expect(flashes("Q(6)+LFl W 15s")).toEqual([0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 2]);
    expect(eclipses("Q(6)+LFl W 15s").at(-1)).toBeCloseTo(7, 9);
  });

  it("gives the very quick south cardinal 5 s of darkness after its long flash", () => {
    // Table 2 class 6.2: "d' = 5 s; l' = 2 s; l = d = 0.25 s; c = 0.5 s; p = 10 s".
    expect(eclipses("VQ(6)+LFl W 10s").at(-1)).toBeCloseTo(5, 9);
    expect(eclipses("VQ(3) W 5s").at(-1)).toBeCloseTo(3.75, 9);
    expect(eclipses("VQ(9) W 10s").at(-1)).toBeCloseTo(5.75, 9);
  });

  it("gives a single flashing light one second of light in four", () => {
    // Table 2 class 4.1: "d = 3 s; l = 1 s; p = 4 s".
    expect(flashes("Fl W 4s")).toEqual([1]);
    expect(eclipses("Fl W 4s")).toEqual([3]);
  });

  it("gives a long-flashing light two seconds of light in ten", () => {
    // Table 2 class 4.2: "d = 8 s; l = 2 s; p = 10 s".
    expect(flashes("LFl W 10s")).toEqual([2]);
    expect(eclipses("LFl W 10s")).toEqual([8]);
  });

  it("gives a composite group the eclipses that keep its groups apart", () => {
    // Table 2 class 4.4: "d'' = 9 s; d' = 3 s; d = 1 s; l = 1 s; c = 2 s; p = 16 s".
    expect(flashes("Fl(2+1) R 16s")).toEqual([1, 1, 1]);
    expect(eclipses("Fl(2+1) R 16s")).toEqual([1, 3, 9]);
  });

  it("gives an isophase light equal light and darkness, and an occulting light three to one", () => {
    // Table 2 class 3: "l = d = 2 s; p = 4 s". Class 2.1: "l = 3 s; d = 1 s; p = 4 s".
    expect(sequence("Iso W 4s")).toEqual([
      { seconds: 2, colour: "white" },
      { seconds: 2, colour: null },
    ]);
    expect(flashes("Oc W 4s")).toEqual([3]);
    expect(eclipses("Oc W 4s")).toEqual([1]);
  });

  it("gives a Morse A a dot, a dash and four and a half seconds of darkness", () => {
    // Table 2 class 8: "l' = 1.5 s; l = 0.5 s; d = 0.5 s; d' = 4.5 s; p = 7 s".
    expect(flashes("Mo(A) W 7s")).toEqual([0.5, 1.5]);
    expect(eclipses("Mo(A) W 7s")).toEqual([0.5, 4.5]);
  });

  it("gives the emergency wreck buoy a second of each colour in three", () => {
    // Table 2 class 11: "l = 1 s; d = 0.5 s; p = 3 s", blue and yellow.
    expect(sequence("OcAl BuY 3s")).toEqual([
      { seconds: 1, colour: "blue" },
      { seconds: 0.5, colour: null },
      { seconds: 1, colour: "yellow" },
      { seconds: 0.5, colour: null },
    ]);
  });
});

/**
 * The constraints, which bind every character rather than the ones with a printed example.
 * These are the sentences in Table 2's "IALA Specification" column, applied to a sweep of
 * characters a scenario could plausibly carry.
 */
describe("what E-110 requires of any sequence", () => {
  const CHARACTERS = [
    "Fl W 2s",
    "Fl G 3s",
    "Fl R 5s",
    "Fl(2) W 5s",
    "Fl(2) W 10s",
    "Fl(3) G 15s",
    "Fl(4) Y 20s",
    "Fl(2+1) R 12s",
    "Q",
    "Q(3) W 10s",
    "Q(6)+LFl W 15s",
    "Q(9) W 15s",
    "VQ",
    "VQ(3) W 5s",
    "VQ(6)+LFl W 10s",
    "VQ(9) W 10s",
    "LFl W 10s",
    "Iso W 4s",
    "Iso W 6s",
    "Oc W 4s",
    "Oc(2) Y 10s",
    "Oc(3) Y 15s",
    "Mo(A) W 7s",
  ];

  it("runs for exactly the period the abbreviation states", () => {
    for (const text of CHARACTERS) {
      const stated = characterOf(text).periodSeconds;
      if (stated === null) continue;
      expect(cycleSeconds(sequence(text)), text).toBeCloseTo(stated, 9);
    }
  });

  it("never has a phase of no length, or of less than none", () => {
    for (const text of CHARACTERS) {
      for (const phase of sequence(text)) expect(phase.seconds, text).toBeGreaterThan(0);
    }
  });

  it("alternates - a light does not follow a light, nor darkness darkness", () => {
    for (const text of CHARACTERS) {
      const phases = sequence(text);
      for (let i = 1; i < phases.length; i += 1) {
        const before = phases[i - 1]?.colour === null;
        const after = phases[i]?.colour === null;
        expect(before, `${text} at ${i}`).not.toBe(after);
      }
    }
  });

  /**
   * Class 4: "a light in which the total duration of light in a period is clearly shorter
   * than the total duration of darkness". Class 2 is its mirror, and class 3 the equality.
   * Getting this backwards makes an occulting light and a flashing one show the same picture.
   *
   * **The quick classes are not under class 4** and are not held to it here. A continuous
   * quick light is half light and half darkness - E-110's own example for class 5.1 is
   * l = d = 0.5 s - because what makes it a quick light is its RATE, not its duty cycle.
   */
  it("keeps a flashing light dark for most of its period, and an occulting light lit", () => {
    const lit = (text: string): number => flashes(text).reduce((a, b) => a + b, 0);
    const dark = (text: string): number => eclipses(text).reduce((a, b) => a + b, 0);

    for (const text of CHARACTERS.filter((c) => /^(Fl|LFl)/.test(c))) {
      expect(lit(text), text).toBeLessThan(dark(text));
    }
    for (const text of CHARACTERS.filter((c) => c.startsWith("Oc"))) {
      expect(lit(text), text).toBeGreaterThan(dark(text));
    }
    expect(lit("Iso W 6s")).toBeCloseTo(dark("Iso W 6s"), 9);
  });

  /** Classes 5.1 and 6.1: "d >= l" - a quick light is never lit longer than it is dark. */
  it("never lets a quick light's flash outlast its own eclipse", () => {
    for (const text of CHARACTERS.filter((c) => /^(Q|VQ|UQ)/.test(c))) {
      const phases = sequence(text);
      const flash = phases.find((phase) => phase.colour !== null)?.seconds ?? 0;
      const eclipse = phases.find((phase) => phase.colour === null)?.seconds ?? 0;
      expect(eclipse, text).toBeGreaterThanOrEqual(flash);
    }
  });

  /**
   * Class 4.3: "The duration of an eclipse between groups should not be less than three times
   * the duration of an eclipse within a group." This is what makes a group readable as a
   * group at all - level it and Fl(3) is a slow continuous flash.
   *
   * A group of n has n-1 eclipses inside it and one closing it, so the closing one is the one
   * that has to be three times the others. The south cardinal's long flash sits between the
   * group and the closing eclipse, and the eclipse before it belongs to the group (Table 3).
   */
  it("separates one group from the next by three times the eclipse inside one", () => {
    const single = ["Fl(2) W 5s", "Fl(2) W 10s", "Fl(3) G 15s", "Fl(4) Y 20s", "Q(3) W 10s"];
    for (const text of [...single, "Q(9) W 15s", "VQ(3) W 5s", "VQ(9) W 10s"]) {
      const dark = eclipses(text);
      const closing = dark.at(-1) ?? 0;
      for (const inside of dark.slice(0, -1)) {
        expect(closing, text).toBeGreaterThanOrEqual(3 * inside);
      }
    }
  });

  /**
   * Class 4.4, the composite group: "d'' >= d'", "d' >= 3 d". Three eclipse lengths, and the
   * order of them is the whole difference between Fl(2+1) and Fl(3) - level the middle one
   * and a preferred-channel mark shows as an ordinary lateral one.
   */
  it("gives a composite group three lengths of darkness, longest last", () => {
    for (const text of ["Fl(2+1) R 12s", "Fl(2+1) R 16s"]) {
      const [within, between, closing] = eclipses(text);
      expect(between, text).toBeGreaterThanOrEqual(3 * (within ?? 0));
      expect(closing, text).toBeGreaterThanOrEqual(between ?? 0);
    }
  });

  /** Class 5 and 6: quick is 50 to 79 flashes a minute, very quick 80 to 159. */
  it("flashes at the rate that makes a quick light quick", () => {
    const rate = (text: string): number => {
      const phases = sequence(text);
      const flash = phases.find((phase) => phase.colour !== null)?.seconds ?? 0;
      const eclipse = phases.find((phase) => phase.colour === null)?.seconds ?? 0;
      return 60 / (flash + eclipse);
    };

    for (const text of ["Q", "Q(3) W 10s", "Q(9) W 15s"]) {
      expect(rate(text), text).toBeGreaterThanOrEqual(50);
      expect(rate(text), text).toBeLessThan(80);
    }
    for (const text of ["VQ", "VQ(3) W 5s", "VQ(9) W 10s"]) {
      expect(rate(text), text).toBeGreaterThanOrEqual(80);
      expect(rate(text), text).toBeLessThan(160);
    }
  });

  /** Class 4.2 and its footnote: a long flash is "not less than 2 seconds". */
  it("makes every long flash at least two seconds, and every ordinary flash less", () => {
    expect(Math.min(...flashes("LFl W 10s"))).toBeGreaterThanOrEqual(2);
    expect(flashes("Q(6)+LFl W 15s").at(-1)).toBeGreaterThanOrEqual(2);

    for (const text of CHARACTERS.filter((c) => /^(Fl|Q|VQ)/.test(c) && !c.includes("LFl"))) {
      for (const flash of flashes(text)) expect(flash, text).toBeLessThan(2);
    }
  });

  /** The count is the message: an east cardinal is three flashes and a west is nine. */
  it("shows as many flashes as the group says", () => {
    expect(flashes("Q(3) W 10s")).toHaveLength(3);
    expect(flashes("Q(9) W 15s")).toHaveLength(9);
    expect(flashes("Fl(4) Y 20s")).toHaveLength(4);
    expect(flashes("Q(6)+LFl W 15s")).toHaveLength(7);
    expect(eclipses("Oc(3) Y 15s")).toHaveLength(3);
  });
});

describe("the classes that are not flashing at all", () => {
  /** Class 1: "a light showing continuously and steadily" - one phase, and never dark. */
  it("leaves a fixed light on for the whole period", () => {
    expect(phasesOf(characterOf("F W 4s"))).toEqual([{ seconds: 4, colour: "white" }]);
    expect(phasesOf(characterOf("F"))).toHaveLength(1);
  });

  /** Class 10: "a light showing different colours alternately", with no darkness between. */
  it("alternates the two colours of an alternating light", () => {
    expect(phasesOf(characterOf("Al WR 4s"))).toEqual([
      { seconds: 2, colour: "white" },
      { seconds: 2, colour: "red" },
    ]);
  });

  /** A character with no colour is drawn white, which is what a chart's omission means. */
  it("shows an unstated colour as white", () => {
    expect(phasesOf(characterOf("Fl 4s"))[0]?.colour).toBe("white");
  });
});

describe("what the light is showing at a given moment", () => {
  it("is lit at the start of a flash and dark after it", () => {
    const phases = sequence("Fl W 4s");
    expect(showingAt(phases, 0)).toBe("white");
    expect(showingAt(phases, 0.9)).toBe("white");
    expect(showingAt(phases, 1.1)).toBeNull();
    expect(showingAt(phases, 3.9)).toBeNull();
  });

  it("repeats, so the second period looks like the first", () => {
    const phases = sequence("Fl(2) R 10s");
    for (const second of [0, 0.5, 1.2, 2.5, 4, 7.7, 9.9]) {
      expect(showingAt(phases, second), `${second}`).toBe(showingAt(phases, second + 10));
      expect(showingAt(phases, second), `${second}`).toBe(showingAt(phases, second + 40));
    }
  });

  /**
   * A replay can be scrubbed backwards, and a mark before the scenario's zero is not a mark
   * that has gone out. JavaScript's remainder keeps the sign of its left operand, so this is
   * one line of arithmetic away from a light that is dark for all of history.
   */
  it("is showing before the clock's zero as it does after it", () => {
    const phases = sequence("Q(3) W 10s");
    for (const second of [0.1, 0.7, 2.2, 8]) {
      expect(showingAt(phases, second - 10), `${second}`).toBe(showingAt(phases, second));
    }
  });

  it("gives the colour it is showing, which for an alternating light changes", () => {
    const phases = sequence("OcAl BuY 3s");
    expect(showingAt(phases, 0.5)).toBe("blue");
    expect(showingAt(phases, 2)).toBe("yellow");
  });

  it("says nothing rather than something for a sequence of no length", () => {
    expect(showingAt([], 4)).toBeNull();
  });
});

/**
 * Two marks in one anchorage are not synchronised, and a viewer tells them apart by watching
 * them against each other. Running both off the scenario's own clock is what produces that;
 * running each off its own start would put every mark's first flash at the same instant.
 */
describe("two marks in the same scene", () => {
  it("drift apart by their own periods rather than flashing together", () => {
    const east = sequence("Q(3) W 10s");
    const west = sequence("Q(9) W 15s");
    let apart = 0;
    for (let second = 0; second < 30; second += 0.25) {
      if ((showingAt(east, second) === null) !== (showingAt(west, second) === null)) apart += 1;
    }
    expect(apart).toBeGreaterThan(0);
  });
});
