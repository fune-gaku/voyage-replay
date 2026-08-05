import { describe, expect, it } from "vitest";

import { parseScenario, validateScenario } from "../src/core/validate.js";
import { scenario } from "./fixtures.js";

/**
 * Validation is against spec/voyage.schema.json - the same file that ships as the format's
 * contract - so a scenario that passes here passes for anyone else reading the spec. What
 * matters as much as the verdict is the message: these files are transcribed by hand out
 * of a PDF, and "invalid" without a path is a half-hour of hunting.
 */
describe("validateScenario", () => {
  it("accepts a scenario that satisfies the schema", () => {
    expect(validateScenario(scenario())).toEqual({ valid: true, errors: [] });
  });

  it("rejects a missing required field, and says which one", () => {
    const withoutVersion: Record<string, unknown> = { ...scenario() };
    delete withoutVersion["formatVersion"];
    const result = validateScenario(withoutVersion);

    expect(result.valid).toBe(false);
    expect(result.errors.join(" ")).toContain("formatVersion");
  });

  it("points at the offending path rather than at the document", () => {
    const broken = scenario();
    broken.actors[0]!.track.points[1]!.lat = "33-53-12.4" as unknown as number;
    const result = validateScenario(broken);

    expect(result.valid).toBe(false);
    expect(result.errors.join(" ")).toContain("/actors/0/track/points/1/lat");
  });

  it("reports every error at once rather than one per run", () => {
    const result = validateScenario({ formatVersion: "nope", meta: {}, origin: {}, actors: [] });
    expect(result.errors.length).toBeGreaterThan(1);
  });

  it("rejects a value outside a closed set", () => {
    const broken = scenario();
    broken.actors[0]!.track.derivation = "guessed" as never;
    expect(validateScenario(broken).valid).toBe(false);
  });

  it("rejects things that are not scenarios at all", () => {
    for (const value of [null, undefined, 42, "a string", []]) {
      expect(validateScenario(value).valid, JSON.stringify(value)).toBe(false);
    }
  });
});

describe("parseScenario", () => {
  it("hands back the scenario when it validates", () => {
    const subject = scenario();
    expect(parseScenario(subject)).toBe(subject);
  });

  it("throws with every complaint in the message", () => {
    expect(() => parseScenario({ formatVersion: "0.1" })).toThrow(/not a valid \.voyage\.json/);
    expect(() => parseScenario({ formatVersion: "0.1" })).toThrow(/meta/);
  });
});
