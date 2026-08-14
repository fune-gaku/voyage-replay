import { describe, expect, it } from "vitest";

import { conditionsAt } from "../src/core/conditions.js";
import type { Environment, LatLon } from "../src/core/types.js";

const SUO_NADA: LatLon = { lat: 33.905, lon: 131.7116667 };
const CONTACT = Date.parse("2025-11-27T09:13:30Z") / 1000;
const NOON = Date.parse("2025-11-27T03:00:00Z") / 1000;

function conditions(environment: Environment | undefined, epochSeconds = CONTACT) {
  return conditionsAt(SUO_NADA, environment, epochSeconds);
}

describe("what the sun decides", () => {
  it("names the step of twilight the sun is in", () => {
    expect(conditions(undefined).sunLevel).toBe("astronomical-twilight");
    expect(conditions(undefined, NOON).sunLevel).toBe("day");
  });

  /**
   * Every step, in order, over one evening. The named levels are the standard definitions
   * rather than a scale anybody chose, and a ladder tested only at its ends is a ladder
   * whose middle rungs can be in any order at all.
   */
  it("walks down the steps in order as the sun sets", () => {
    const seen: string[] = [];
    for (let minute = 0; minute < 5 * 60; minute += 5) {
      const level = conditions(undefined, CONTACT - 150 * 60 + minute * 60).sunLevel;
      if (seen.at(-1) !== level) seen.push(level);
    }
    expect(seen).toEqual([
      "day",
      "civil-twilight",
      "nautical-twilight",
      "astronomical-twilight",
      "night",
    ]);
  });

  /**
   * COLREG Rule 20 is written as "from sunset to sunrise", and sunset is the sun's centre
   * at -0.833 degrees rather than at zero - refraction plus its semidiameter. This is the
   * rule that says the lights this project draws had to be shown at all, so it is worth
   * being able to answer rather than assume.
   */
  it("says whether the lights were required, by the rule's own definition", () => {
    expect(conditions(undefined).navigationLightsRequired, "two hours after sunset").toBe(true);
    expect(conditions(undefined, NOON).navigationLightsRequired, "at noon").toBe(false);
  });

  it("reports where the moon was, not only that it was night", () => {
    const { moon } = conditions({ lightCondition: "night" });
    expect(moon.altitudeDegrees).toBeGreaterThan(30);
    expect(moon.illuminatedFraction).toBeGreaterThan(0.3);
  });
});

describe("the file against the sky", () => {
  it("agrees when the file says night and the sun is down", () => {
    expect(conditions({ lightCondition: "night" }).statedLightAgrees).toBe(true);
  });

  // The case this exists for: a transcription that says one thing while the sun says the
  // other. Nothing else in the project can catch it, because nothing else knows the sky.
  it("disagrees when the file says day and the sun is fourteen degrees down", () => {
    expect(conditions({ lightCondition: "day" }).statedLightAgrees).toBe(false);
  });

  /**
   * "restricted-visibility" answers a different question - it can be true at noon - so it
   * is silence on this axis rather than disagreement. Reported as disagreement, it would
   * fire on every fog case and train a reader to ignore the column.
   */
  it("says nothing about a file that spoke about visibility instead", () => {
    expect(conditions({ lightCondition: "restricted-visibility" }).statedLightAgrees).toBeNull();
    expect(conditions({}).statedLightAgrees).toBeNull();
    expect(conditions(undefined).statedLightAgrees).toBeNull();
  });

  /**
   * A watchkeeper writing "night" is describing the darkness they were in, not claiming the
   * sun was more than eighteen degrees down. Held to the astronomer's definition, every
   * dusk collision in the corpus would be flagged as a transcription error.
   */
  it("lets a stated night cover the twilights", () => {
    expect(conditions({ lightCondition: "night" }).sunLevel).not.toBe("night");
    expect(conditions({ lightCondition: "night" }).statedLightAgrees).toBe(true);
    expect(conditions({ lightCondition: "twilight" }).statedLightAgrees).toBe(true);
  });
});

describe("what only the file can say", () => {
  // Nothing computes the weather. These come through untouched, and their absence is a
  // fact about the record rather than a zero.
  it("passes visibility and sea state through, and says null when unstated", () => {
    expect(conditions({ visibilityMetres: 9260, seaState: 3 }).visibilityMetres).toBe(9260);
    expect(conditions({ visibilityMetres: 9260, seaState: 3 }).seaState).toBe(3);
    expect(conditions({}).visibilityMetres).toBeNull();
    expect(conditions({ visibilityMetres: null }).visibilityMetres).toBeNull();
  });
});

describe("as a function of time", () => {
  /**
   * Written as a function of time although almost everything in it is constant today,
   * because the sun already is not: the reference case runs for eighty-seven minutes and
   * crosses out of nautical twilight eleven minutes before the collision.
   */
  it("moves the sun across the run of one scenario", () => {
    const opening = conditions(undefined, CONTACT - 87 * 60);
    const contact = conditions(undefined);

    expect(opening.sun.altitudeDegrees).toBeGreaterThan(contact.sun.altitudeDegrees);
    expect(opening.sunLevel).not.toBe(contact.sunLevel);
  });
});
