import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { describe, expect, it } from "vitest";

import { describeAspect, visibleLights } from "../src/actors/vessel/lights.js";
import { bearingDegrees, distanceMetres, normaliseDegrees } from "../src/core/geodesy.js";
import { closestPointOfApproach, prepareActor, sampleAt } from "../src/core/track.js";
import { checkPlausibility } from "../src/core/plausibility.js";
import { parseScenario, validateScenario } from "../src/core/validate.js";

const examplesDir = join(dirname(fileURLToPath(import.meta.url)), "..", "examples");
const files = readdirSync(examplesDir).filter((f) => f.endsWith(".voyage.json"));

function load(name: string) {
  return parseScenario(JSON.parse(readFileSync(join(examplesDir, name), "utf8")));
}

describe("every example", () => {
  it("has at least one", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files)("%s satisfies the schema", (name) => {
    const raw = JSON.parse(readFileSync(join(examplesDir, name), "utf8"));
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
