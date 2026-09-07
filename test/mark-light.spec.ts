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

  it("takes a light on a beacon as readily as on a buoy", () => {
    const reading = lightOf({ ...buoy(), kind: "beacon", light: { character: "Q(9) W 15s" } });
    expect(reading.known).toBe(true);
    if (reading.known) expect(reading.character.groups).toEqual([9]);
  });
});
