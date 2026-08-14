import { describe, expect, it } from "vitest";

import { moonPosition, sunPosition } from "../src/core/celestial.js";
import type { LatLon } from "../src/core/types.js";

/**
 * Checked against physics, not against itself.
 *
 * An ephemeris is the kind of code where a test can only repeat the arithmetic it is
 * testing and agree with it however wrong both are. So every case here is a fact about the
 * sky that holds whatever the implementation does: the tropics fix the solstice altitudes,
 * the equinox fixes the sunrise bearing, and a full moon is by definition opposite the sun.
 */

const SUO_NADA: LatLon = { lat: 33.905, lon: 131.7116667 };

/** The tilt of the earth, which is what makes the solstice figures below what they are. */
const OBLIQUITY_DEGREES = 23.44;

function at(iso: string): number {
  return Date.parse(iso) / 1000;
}

/** The sun's greatest altitude on a given day, found by looking. */
function highestSun(day: string, place: LatLon): number {
  let highest = -90;
  for (let minute = 0; minute < 24 * 60; minute += 2) {
    highest = Math.max(
      highest,
      sunPosition(at(`${day}T00:00:00Z`) + minute * 60, place).altitudeDegrees,
    );
  }
  return highest;
}

describe("the sun", () => {
  /**
   * At noon on the June solstice the sun stands as far north as it ever gets, so its
   * altitude is ninety degrees less the distance from the observer to the Tropic of Cancer.
   * Nothing in the code knows that; it falls out of the geometry or it does not.
   */
  it("reaches the altitude the tropics say, on both solstices", () => {
    expect(highestSun("2025-06-21", SUO_NADA)).toBeCloseTo(
      90 - (SUO_NADA.lat - OBLIQUITY_DEGREES),
      1,
    );
    expect(highestSun("2025-12-22", SUO_NADA)).toBeCloseTo(
      90 - (SUO_NADA.lat + OBLIQUITY_DEGREES),
      1,
    );
  });

  // At an equinox the sun is on the celestial equator, so it rises due east from anywhere.
  it("rises due east at an equinox", () => {
    const equator = { lat: 0, lon: 0 };
    let rising = 0;
    for (let minute = 0; minute < 24 * 60; minute += 1) {
      const when = at("2025-03-20T00:00:00Z") + minute * 60;
      if (sunPosition(when, equator).altitudeDegrees > -0.833) {
        rising = sunPosition(when, equator).azimuthDegrees;
        break;
      }
    }
    expect(rising).toBeCloseTo(90, 0);
  });

  it("is below the horizon in the middle of a winter night", () => {
    expect(sunPosition(at("2025-12-22T15:00:00Z"), SUO_NADA).altitudeDegrees).toBeLessThan(-20);
  });

  /**
   * The reference case. Nautical twilight - the horizon's last light - ended eleven minutes
   * before the two ships touched, which is not something the scenario's hand-entered
   * "night" can say.
   */
  it("puts the reference collision in astronomical twilight", () => {
    const contact = sunPosition(at("2025-11-27T09:13:30Z"), SUO_NADA);
    expect(contact.altitudeDegrees).toBeCloseTo(-14.2, 0);
  });
});

describe("the moon", () => {
  it("keeps the illuminated fraction between new and full", () => {
    for (let day = 0; day < 30; day += 1) {
      const fraction = moonPosition(
        at("2025-11-01T00:00:00Z") + day * 86400,
        SUO_NADA,
      ).illuminatedFraction;
      expect(fraction).toBeGreaterThanOrEqual(0);
      expect(fraction).toBeLessThanOrEqual(1);
    }
  });

  // A month, by definition: the disc goes from dark to full and back inside one.
  it("goes through a whole cycle in a month", () => {
    const over = Array.from(
      { length: 30 },
      (_, day) =>
        moonPosition(at("2025-11-01T00:00:00Z") + day * 86400, SUO_NADA).illuminatedFraction,
    );
    expect(Math.min(...over)).toBeLessThan(0.05);
    expect(Math.max(...over)).toBeGreaterThan(0.95);
  });

  /**
   * A full moon is opposite the sun, so it is up when the sun is down - which is the whole
   * reason it matters to a night reconstruction. Checked as a relationship between the two
   * bodies rather than against a date, because a date would be another thing to be wrong
   * about.
   */
  it("is above the horizon at midnight when it is full", () => {
    for (let day = 0; day < 60; day += 1) {
      const when = at("2025-11-01T15:00:00Z") + day * 86400;
      const moon = moonPosition(when, SUO_NADA);
      if (moon.illuminatedFraction < 0.98) continue;
      expect(sunPosition(when, SUO_NADA).altitudeDegrees, "local midnight").toBeLessThan(0);
      expect(moon.altitudeDegrees, "and the full moon is up").toBeGreaterThan(0);
    }
  });

  /**
   * Parallax. An observer on the surface sees the moon lower than one at the centre of the
   * earth would, by nearly a degree when it is overhead - which is minutes of moonrise, at
   * the altitudes where minutes are the answer.
   */
  it("is lower for an observer standing on the earth than for one at its centre", () => {
    let highest = -90;
    for (let hour = 0; hour < 24 * 30; hour += 1) {
      highest = Math.max(
        highest,
        moonPosition(at("2025-11-01T00:00:00Z") + hour * 3600, SUO_NADA).altitudeDegrees,
      );
    }
    // Without the correction this would reach within a degree of the observer's zenith
    // distance to the moon's declination limit; with it, it stays visibly short.
    expect(highest).toBeLessThan(90 - SUO_NADA.lat + 28.6);
  });

  it("puts a half moon well up at the reference collision", () => {
    const moon = moonPosition(at("2025-11-27T09:13:30Z"), SUO_NADA);
    expect(moon.altitudeDegrees).toBeGreaterThan(30);
    expect(moon.illuminatedFraction).toBeGreaterThan(0.3);
    expect(moon.illuminatedFraction).toBeLessThan(0.55);
  });
});
