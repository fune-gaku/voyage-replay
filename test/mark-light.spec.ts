import { describe, expect, it } from "vitest";

import { lightOf } from "../src/actors/mark/light.js";
import { cycleSeconds } from "../src/core/light-character.js";
import type { Mark } from "../src/core/types.js";

function buoy(overrides: Partial<Mark> = {}): Mark {
  return { id: "no-1", kind: "buoy", at: { lat: 33.9, lon: 131.7 }, ...overrides };
}

/**
 * Three answers, and the whole point of this module is that they stay three. A mark with no
 * light stated is not an unlit mark - a buoy and a lighted buoy are different marks, and a
 * report that omits the light is the ordinary case rather than a statement that there was
 * none. A stated character nobody can read is a third thing again, and only that one is an
 * error in the file.
 */
describe("lightOf", () => {
  it("does not read silence as an unlit mark", () => {
    const reading = lightOf(buoy());
    expect(reading.known).toBe(false);
    if (!reading.known) {
      expect(reading.because).toBe("the file does not say whether it carried a light");
    }
  });

  it("reads a stated character and works out a sequence for it", () => {
    const reading = lightOf(buoy({ light: { character: "Fl(2) R 10s" } }));
    expect(reading.known).toBe(true);
    if (reading.known) {
      expect(reading.character.groups).toEqual([2]);
      expect(reading.timings).toBe("inferred");
      expect(cycleSeconds(reading.phases)).toBeCloseTo(10, 9);
    }
  });

  /**
   * The trap this whole issue turns on. `Fl 4s` says one flash in every four seconds and not
   * how long the flash is, so anything generated from the abbreviation conforms to E-110
   * without being what that light showed - and a page that called it measured would be
   * reporting this tool's arithmetic as somebody's observation.
   */
  it("calls a worked-out sequence inferred, and a stated one stated", () => {
    const stated = lightOf(
      buoy({
        light: {
          character: "Fl R 4s",
          phases: [{ seconds: 0.3, colour: "red" }, { seconds: 3.7 }],
        },
      }),
    );

    expect(stated.known).toBe(true);
    if (stated.known) {
      expect(stated.timings).toBe("stated");
      // The stated flash, not the second E-110's example would have given it.
      expect(stated.phases[0]?.seconds).toBe(0.3);
      expect(stated.phases[1]?.colour).toBeNull();
    }
  });

  /**
   * Reading `Fl(2) W 10s` as a single flash would turn an isolated-danger mark into a
   * special mark, on screen, with the page agreeing. Nothing is shown for what cannot be
   * read, and the reason travels with the refusal so a page can print it.
   */
  it("refuses a character it cannot read rather than falling back to something plainer", () => {
    const reading = lightOf(buoy({ light: { character: "flashing twice" } }));
    expect(reading.known).toBe(false);
    if (!reading.known) expect(reading.because).toBe("no class in it");
  });

  /**
   * The schema requires each stated phase to be longer than nothing, and so does this - a
   * scenario reaches here by other roads than `validateScenario`. Reported rather than
   * silently replaced by the inferred sequence: a file that stated timings meant to state
   * them, and quietly substituting others would hide that they were unusable.
   */
  it("refuses stated timings the schema would have refused too", () => {
    const reading = lightOf(
      buoy({ light: { character: "Fl R 4s", phases: [{ seconds: 0 }, { seconds: -1 }] } }),
    );
    expect(reading.known).toBe(false);
    if (!reading.known) {
      expect(reading.because).toBe("the stated timings include a phase of no length");
    }
  });

  /**
   * **One bad phase spoils the set.** Dropping the bad ones and keeping the rest reports a
   * sequence nobody wrote as "timings stated": filter the red flash out of
   * `[0 s red, 4 s dark]` and four seconds of unbroken darkness is what the file is said to
   * have stated - a light that never shows, described as somebody's observation.
   */
  it("refuses the whole set rather than keeping the phases that were usable", () => {
    const reading = lightOf(
      buoy({
        light: {
          character: "Fl R 4s",
          phases: [{ seconds: 0, colour: "red" }, { seconds: 4 }],
        },
      }),
    );
    expect(reading.known).toBe(false);
    if (!reading.known) {
      expect(reading.because).toBe("the stated timings include a phase of no length");
    }
  });

  /**
   * **A file may state both a character and its timings, and they can disagree.** `Fl(2) R
   * 10s` with one ten-second green phase is a red group-flashing light on the page and a
   * steady green one in the picture - the page and the picture reporting different marks out
   * of the same two fields. Neither is drawn when they do not agree.
   */
  it("refuses timings that show a different light from the character beside them", () => {
    const wrongCount = lightOf(
      buoy({
        light: { character: "Fl(2) R 10s", phases: [{ seconds: 10, colour: "red" }] },
      }),
    );
    expect(wrongCount.known).toBe(false);
    if (!wrongCount.known) {
      expect(wrongCount.because).toBe(
        "the stated timings are not the shape of the character's own sequence",
      );
    }

    const wrongColour = lightOf(
      buoy({
        light: {
          character: "Fl R 4s",
          phases: [{ seconds: 1, colour: "green" }, { seconds: 3 }],
        },
      }),
    );
    expect(wrongColour.known).toBe(false);
    if (!wrongColour.known) {
      expect(wrongColour.because).toBe("the stated timings show a colour the character does not");
    }

    const wrongPeriod = lightOf(
      buoy({
        light: {
          character: "Fl R 4s",
          phases: [{ seconds: 1, colour: "red" }, { seconds: 8 }],
        },
      }),
    );
    expect(wrongPeriod.known).toBe(false);
    if (!wrongPeriod.known) {
      expect(wrongPeriod.because).toBe(
        "the stated timings do not run for the period the character states",
      );
    }
  });

  /**
   * The sequence has to have the same phases in the same order, because a count of
   * appearances does not say how they are arranged. Two red seconds side by side are one
   * two-second flash; half a second of red, nine of darkness and half a second of red joins
   * its two ends into one flash as it repeats. Both have the right number of appearances and
   * neither is the character above them.
   */
  it("refuses timings arranged differently from the character's own sequence", () => {
    const together = lightOf(
      buoy({
        light: {
          character: "Fl(2) R 10s",
          phases: [{ seconds: 1, colour: "red" }, { seconds: 1, colour: "red" }, { seconds: 8 }],
        },
      }),
    );
    expect(together.known).toBe(false);

    const wrapping = lightOf(
      buoy({
        light: {
          character: "Fl(2) R 10s",
          phases: [
            { seconds: 0.5, colour: "red" },
            { seconds: 9 },
            { seconds: 0.5, colour: "red" },
          ],
        },
      }),
    );
    expect(wrapping.known).toBe(false);
    if (!wrapping.known) {
      expect(wrapping.because).toBe(
        "the stated timings are not the shape of the character's own sequence",
      );
    }
  });

  /**
   * A group whose separating eclipse is no longer than the ones inside it is not a group.
   * `Fl(2+1)` stated with even gaps is `Fl(3)` - a preferred-channel mark drawn as an
   * ordinary lateral one, with the page printing the composite character.
   */
  it("refuses timings that do not keep the character's groups apart", () => {
    const reading = lightOf(
      buoy({
        light: {
          character: "Fl(2+1) R 16s",
          phases: [
            { seconds: 1, colour: "red" },
            { seconds: 1 },
            { seconds: 1, colour: "red" },
            { seconds: 1 },
            { seconds: 1, colour: "red" },
            { seconds: 11 },
          ],
        },
      }),
    );
    expect(reading.known).toBe(false);
    if (!reading.known) {
      expect(reading.because).toBe("the stated timings do not keep the character's groups apart");
    }
  });

  /** A long flash of half a second is not a long flash (Table 2 class 4.2 and its footnote). */
  it("refuses timings whose long flash is not long", () => {
    const quick = Array.from({ length: 6 }, () => [
      { seconds: 0.5, colour: "white" as const },
      { seconds: 0.5 },
    ]).flat();
    const reading = lightOf(
      buoy({
        light: {
          character: "Q(6)+LFl W 15s",
          phases: [...quick, { seconds: 0.5, colour: "white" }, { seconds: 8.5 }],
        },
      }),
    );
    expect(reading.known).toBe(false);
    if (!reading.known) {
      expect(reading.because).toBe(
        "the stated timings hold a long flash for less than two seconds",
      );
    }
  });

  /**
   * Dot-then-dash is A and dash-then-dot is N, and a safe-water mark shows Mo(A). Timings
   * that reverse the two spell a different letter under the same character - the page naming
   * one mark and the picture flashing another.
   */
  it("refuses timings that spell a different Morse letter", () => {
    const reading = lightOf(
      buoy({
        light: {
          character: "Mo(A) W 7s",
          phases: [
            { seconds: 1.5, colour: "white" },
            { seconds: 0.5 },
            { seconds: 0.5, colour: "white" },
            { seconds: 4.5 },
          ],
        },
      }),
    );
    expect(reading.known).toBe(false);
    if (!reading.known) {
      expect(reading.because).toBe(
        "the stated timings spell a different letter from the character's",
      );
    }
  });

  it("takes a Morse light whose dot and dash keep their proportion", () => {
    const reading = lightOf(
      buoy({
        light: {
          character: "Mo(A) W 7s",
          phases: [
            { seconds: 0.4, colour: "white" },
            { seconds: 0.4 },
            { seconds: 1.4, colour: "white" },
            { seconds: 4.8 },
          ],
        },
      }),
    );
    expect(reading.known).toBe(true);
    if (reading.known) expect(reading.timings).toBe("stated");
  });

  /**
   * A continuous quick light has no group, so it has no pair inside one to take a rate from -
   * its whole cycle IS the flash cycle. `Q` stated as two seconds lit and three dark is
   * twelve flashes a minute, which is a flashing light under a page saying "Q".
   */
  it("refuses a continuous quick light whose whole cycle is too slow", () => {
    const reading = lightOf(
      buoy({
        light: {
          // A second and a half of light in five seconds: twelve flashes a minute, where a
          // quick light is fifty to seventy-nine. The flash is under two seconds, so this
          // fails on the rate and nothing else.
          character: "Q W",
          phases: [{ seconds: 1.5, colour: "white" }, { seconds: 3.5 }],
        },
      }),
    );
    expect(reading.known).toBe(false);
    if (!reading.known) {
      expect(reading.because).toBe(
        "the stated timings flash at a rate that is not the character's class",
      );
    }

    // And one inside the band is taken, however it divides its second.
    const taken = lightOf(
      buoy({
        light: {
          character: "Q W",
          phases: [{ seconds: 0.3, colour: "white" }, { seconds: 0.7 }],
        },
      }),
    );
    expect(taken.known).toBe(true);
  });

  /**
   * Two seconds is the line between a flash and a long flash, and it cuts both ways: 2.2 s
   * of red under `Fl` is a long-flashing light on the water, which in the buoyage is a
   * safe-water mark shown where the page says something else.
   */
  it("refuses timings whose ordinary flash is long enough to be a long flash", () => {
    const reading = lightOf(
      buoy({
        light: {
          character: "Fl R 10s",
          phases: [{ seconds: 2.2, colour: "red" }, { seconds: 7.8 }],
        },
      }),
    );
    expect(reading.known).toBe(false);
    if (!reading.known) {
      expect(reading.because).toBe(
        "the stated timings hold an ordinary flash for two seconds or more",
      );
    }
  });

  /** And a long-flashing light's own appearance is held to the other side of the same line. */
  it("takes a long-flashing light whose flash is long", () => {
    const reading = lightOf(
      buoy({
        light: {
          character: "LFl W 10s",
          phases: [{ seconds: 2.5, colour: "white" }, { seconds: 7.5 }],
        },
      }),
    );
    expect(reading.known).toBe(true);
    if (reading.known) expect(reading.timings).toBe("stated");
  });

  /** And a quick light flashing at twelve a minute is a flashing light, not a quick one. */
  it("refuses timings that flash outside the rate of their own class", () => {
    const reading = lightOf(
      buoy({
        light: {
          // Three flashes with two and a half seconds between them: 24 a minute, where a
          // quick light is 50 to 79. The darkness between the groups is left long enough to
          // pass its own rule, so this fails on the rate and nothing else.
          character: "Q(3) W 15s",
          phases: [
            { seconds: 0.5, colour: "white" },
            { seconds: 2 },
            { seconds: 0.5, colour: "white" },
            { seconds: 2 },
            { seconds: 0.5, colour: "white" },
            { seconds: 9.5 },
          ],
        },
      }),
    );
    expect(reading.known).toBe(false);
    if (!reading.known) {
      expect(reading.because).toBe(
        "the stated timings flash at a rate that is not the character's class",
      );
    }
  });

  /**
   * The class is a ratio, not a label. "A light in which the total duration of light in a
   * period is longer than the total duration of darkness" IS an occulting light, so timings
   * that get it backwards show an occulting light under a flashing character.
   */
  it("refuses timings that divide light and darkness unlike their own class", () => {
    const reading = lightOf(
      buoy({
        light: {
          character: "Fl R 4s",
          phases: [{ seconds: 3.5, colour: "red" }, { seconds: 0.5 }],
        },
      }),
    );
    expect(reading.known).toBe(false);
    if (!reading.known) {
      expect(reading.because).toBe(
        "the stated timings divide light and darkness unlike the class of light they are on",
      );
    }
  });

  /**
   * And a colour the character names that never appears: an alternating light stated as blue,
   * dark, blue, dark passes every count and does not alternate - which is the one thing that
   * makes it the class it says it is.
   */
  it("refuses timings that leave out one of the character's colours", () => {
    const reading = lightOf(
      buoy({
        light: {
          character: "OcAl BuY 3s",
          phases: [
            { seconds: 1, colour: "blue" },
            { seconds: 0.5 },
            { seconds: 1, colour: "blue" },
            { seconds: 0.5 },
          ],
        },
      }),
    );
    expect(reading.known).toBe(false);
    if (!reading.known) {
      expect(reading.because).toBe("the stated timings never show one of the character's colours");
    }
  });

  /** An alternating light is the exception, and the reason the rule is about COLOUR. */
  it("takes an alternating light's two appearances with no darkness between them", () => {
    const reading = lightOf(
      buoy({
        light: {
          character: "Al WR 4s",
          phases: [
            { seconds: 2.5, colour: "white" },
            { seconds: 1.5, colour: "red" },
          ],
        },
      }),
    );
    expect(reading.known).toBe(true);
    if (reading.known) expect(reading.timings).toBe("stated");
  });

  /**
   * What stated timings are FOR: the split within the period, which the abbreviation never
   * fixed. A flash of a third of a second inside the same four-second period is exactly the
   * kind of thing a Light List carries and an abbreviation cannot.
   */
  it("takes timings that agree with the character, however they divide the period", () => {
    const reading = lightOf(
      buoy({
        light: {
          character: "Fl R 4s",
          phases: [{ seconds: 0.3, colour: "red" }, { seconds: 3.7 }],
        },
      }),
    );
    expect(reading.known).toBe(true);
    if (reading.known) expect(reading.timings).toBe("stated");
  });

  it("takes a light on a beacon as readily as on a buoy", () => {
    const reading = lightOf({ ...buoy(), kind: "beacon", light: { character: "Q(9) W 15s" } });
    expect(reading.known).toBe(true);
    if (reading.known) expect(reading.character.groups).toEqual([9]);
  });
});
