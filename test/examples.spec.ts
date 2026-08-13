import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { describe, expect, it } from "vitest";

import { describeAspect, visibleLights } from "../src/actors/vessel/lights.js";
import { hullCentreOffset, offsetMetres } from "../src/actors/vessel/reference-point.js";
import {
  bearingDegrees,
  distanceMetres,
  normaliseDegrees,
  type LocalPosition,
} from "../src/core/geodesy.js";
import {
  closestPointOfApproach,
  prepareActor,
  sampleAt,
  type PreparedTrack,
} from "../src/core/track.js";
import { checkPlausibility } from "../src/core/plausibility.js";
import type { Actor, ReferencePointOffsets } from "../src/core/types.js";
import { parseScenario, validateScenario } from "../src/core/validate.js";

const examplesDir = join(dirname(fileURLToPath(import.meta.url)), "..", "examples");
const files = readdirSync(examplesDir).filter((f) => f.endsWith(".voyage.json"));

function load(name: string) {
  const raw: unknown = JSON.parse(readFileSync(join(examplesDir, name), "utf8"));
  return parseScenario(raw);
}

/*
 * Just enough plane geometry to ask whether one ship's stem is inside another ship's hull.
 *
 * Both are treated as rectangles, length overall by beam, about the centre the AIS offsets
 * give. A rectangle is a poor bow and a poor stern, but the question here is only which side
 * of a ship's side a point falls on, and for that it is the shape the offsets actually
 * describe. Length and beam come from the four offsets rather than from the particulars,
 * which is where they are most reliable - see docs/format.md.
 */

function halfLength(offsets: ReferencePointOffsets): number {
  return (offsets.fromBowMetres + offsets.fromSternMetres) / 2;
}

function halfBeam(offsets: ReferencePointOffsets): number {
  return (offsets.fromPortMetres + offsets.fromStarboardMetres) / 2;
}

/** A point a given distance from another, on a true bearing. */
function offsetPoint(from: LocalPosition, bearingDegreesTrue: number, metres: number) {
  const radians = (bearingDegreesTrue * Math.PI) / 180;
  return {
    east: from.east + Math.sin(radians) * metres,
    north: from.north + Math.cos(radians) * metres,
  };
}

/** The hull's centre, from the position her track reports. */
function placed(reported: LocalPosition, heading: number, offsets: ReferencePointOffsets) {
  const offset = offsetMetres(hullCentreOffset("gps-antenna", offsets));
  const forward = offsetPoint(reported, heading, offset.forwardMetres);
  return offsetPoint(forward, heading + 90, offset.starboardMetres);
}

/** The stem: the point of the bow, with the hull placed on her offsets or left as reported. */
function stemAt(track: PreparedTrack, ship: Actor, epochSeconds: number, place = true) {
  const state = sampleAt(track, epochSeconds);
  // Not a truthiness check: heading 000 is due north, and a ship heading north is a ship.
  if (state?.headingDegreesTrue === undefined) throw new Error("no heading at that instant");
  const offsets = ship.vessel?.referencePointOffsets;
  if (!offsets) throw new Error("no reference point offsets");

  const heading = state.headingDegreesTrue;
  const centre = place ? placed(state.position, heading, offsets) : state.position;
  return offsetPoint(centre, heading, halfLength(offsets));
}

/** Where a point falls in a ship's own frame: forward of her centre, and to starboard of it. */
function inHullFrame(centre: LocalPosition, heading: number, point: LocalPosition) {
  const relative = (normaliseDegrees(bearingDegrees(centre, point) - heading) * Math.PI) / 180;
  const range = distanceMetres(centre, point);
  return {
    forwardMetres: range * Math.cos(relative),
    starboardMetres: range * Math.sin(relative),
  };
}

describe("every example", () => {
  it("has at least one", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files)("%s satisfies the schema", (name) => {
    const raw: unknown = JSON.parse(readFileSync(join(examplesDir, name), "utf8"));
    const result = validateScenario(raw);
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it.each(files)("%s cites where its data came from", (name) => {
    const scenario = load(name);
    expect(scenario.meta.source?.url ?? scenario.meta.source?.citation).toBeTruthy();
    for (const actor of scenario.actors) {
      expect(actor.track.derivation).toBeTruthy();
      expect(actor.track.positionAt).toBeTruthy();
    }
  });
});

/**
 * The Suo-nada collision is the reference case. These assertions are not unit tests of a
 * function - they pin the whole chain, from the numbers transcribed out of the report to
 * the aspect a watchkeeper would have read off the other ship's lights. If one of them
 * moves, either the transcription changed or the geometry did, and both are worth stopping
 * for.
 */
describe("Suo-nada, 27 November 2025", () => {
  const scenario = load("suo-nada-2025-11-27.voyage.json");
  const [tanker, pushingUnit] = scenario.actors;
  if (!tanker || !pushingUnit) throw new Error("example is missing an actor");

  const a = prepareActor(tanker, scenario.origin);
  const b = prepareActor(pushingUnit, scenario.origin);

  it("carries both tracks in full", () => {
    expect(a.points).toHaveLength(29);
    expect(b.points).toHaveLength(30);
  });

  it("brings the two hulls together at the time the report gives", () => {
    const cpa = closestPointOfApproach(a, b);
    expect(cpa).not.toBeNull();
    // Antenna to antenna. The tanker's antenna sits 39 m from her bow, so 40 m between
    // antennae is contact, not a near miss.
    expect(cpa!.metres).toBeLessThan(60);
    const at = new Date(cpa!.epochSeconds * 1000).toISOString();
    expect(at).toBe("2025-11-27T09:13:35.000Z"); // 18:13:35 JST; the report says "about 18:13"
  });

  /**
   * Constant bearing, decreasing range. This is the whole reason the tool exists: the
   * numbers were in the report's appendix all along, and nobody reads a steady bearing
   * out of a column of figures.
   */
  it("holds a steady bearing while the range closes", () => {
    const window = [
      "2025-11-27T18:07:35+09:00",
      "2025-11-27T18:08:35+09:00",
      "2025-11-27T18:09:35+09:00",
      "2025-11-27T18:10:35+09:00",
      "2025-11-27T18:11:35+09:00",
    ].map((t) => Date.parse(t) / 1000);

    const bearings: number[] = [];
    const ranges: number[] = [];
    for (const t of window) {
      const pa = sampleAt(a, t);
      const pb = sampleAt(b, t);
      expect(pa && pb).toBeTruthy();
      bearings.push(bearingDegrees(pa!.position, pb!.position));
      ranges.push(distanceMetres(pa!.position, pb!.position));
    }

    expect(Math.max(...bearings) - Math.min(...bearings)).toBeLessThan(1);
    expect(ranges[0]!).toBeGreaterThan(3000);
    expect(ranges[ranges.length - 1]!).toBeLessThan(1200);
    for (let i = 1; i < ranges.length; i += 1) {
      expect(ranges[i]!).toBeLessThan(ranges[i - 1]!);
    }
  });

  /**
   * The report's own analysis records that the officer of the watch "saw a white light
   * and a green light" when he first sighted the pushing unit. The arcs reproduce it.
   */
  it("shows the tanker a white and a green light, as the report records", () => {
    for (const t of ["18:08:35", "18:10:35", "18:12:35"]) {
      const at = Date.parse(`2025-11-27T${t}+09:00`) / 1000;
      const pa = sampleAt(a, at);
      const pb = sampleAt(b, at);
      expect(pa && pb).toBeTruthy();

      // The pushing unit's Class B AIS transmits no heading, so its course over ground
      // stands in here. That substitution is the test's choice, made explicitly - the
      // library never makes it silently.
      const unitHeading = pb!.cogDegreesTrue;
      expect(unitHeading).toBeDefined();

      const bearingOfTankerFromUnit = normaliseDegrees(
        bearingDegrees(pb!.position, pa!.position) - unitHeading!,
      );
      const seen = visibleLights(pushingUnit.vessel!, bearingOfTankerFromUnit);
      const colours = new Set(seen.map((l) => l.colour));

      expect(colours.has("white"), `at ${t}`).toBe(true);
      expect(colours.has("green"), `at ${t}`).toBe(true);
      expect(colours.has("red"), `at ${t}`).toBe(false);
      expect(describeAspect(seen)).toBe("starboard side visible");
    }
  });

  /**
   * Which way the antenna offset goes, pinned against the one fact that can tell the right
   * sign from its opposite: these two ships hit each other.
   *
   * Both antennae sit well aft - 39 m from a 49 m bow on the tanker, 104 m from a 121 m bow
   * on the pushing unit - so each hull's centre lies FORWARD of the position her track
   * reports, and a hull drawn at the antenna is drawn astern of where the ship was. Put the
   * offsets on that way round and at the moment of closest approach the tanker's stem sits
   * 57.0 m abaft the unit's centre and 3.5 m to port of her centreline: inside a hull that
   * is 121 m by 19 m, three and a half metres from her stern. Leave the offsets out, as the
   * renderer did until now, and the same stem is 13.5 m off her centreline - four metres
   * clear of her side, and no collision. Reverse them and it is twenty-one metres clear.
   *
   * All three pictures look like two ships passing close. Only one of them is the accident.
   */
  it("brings the tanker's stem inside the pushing unit, once each is put on her offsets", () => {
    const contact = closestPointOfApproach(a, b)!.epochSeconds;
    const stem = stemAt(a, tanker, contact);
    // No heading is transmitted by this unit's Class B AIS, so her course over ground stands
    // in. The substitution is this test's, made out loud; the library never makes it.
    const unit = sampleAt(b, contact)!;
    const unitHeading = unit.cogDegreesTrue!;
    const offsets = pushingUnit.vessel!.referencePointOffsets!;

    const struck = inHullFrame(placed(unit.position, unitHeading, offsets), unitHeading, stem);
    expect(Math.abs(struck.forwardMetres)).toBeLessThan(halfLength(offsets));
    expect(Math.abs(struck.starboardMetres)).toBeLessThan(halfBeam(offsets));

    // The same stem against the unit as she was drawn before this was fixed: past her side.
    const asDrawn = inHullFrame(unit.position, unitHeading, stemAt(a, tanker, contact, false));
    expect(Math.abs(asDrawn.starboardMetres)).toBeGreaterThan(halfBeam(offsets));
  });

  /**
   * The screening finds the impact and nothing else. Every remaining complaint sits
   * inside the seconds around contact, where a hull really is being struck.
   */
  it("flags the impact and leaves the rest of the track alone", () => {
    const findings = checkPlausibility(a, tanker.vessel);
    const contact = Date.parse("2025-11-27T18:13:35+09:00") / 1000;
    for (const finding of findings) {
      expect(
        Math.abs(finding.fromEpochSeconds - contact),
        `${finding.kind} at ${new Date(finding.fromEpochSeconds * 1000).toISOString()}: ${finding.message}`,
      ).toBeLessThan(90);
    }
  });
});
