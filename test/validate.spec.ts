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

/**
 * The two kinds of mark are not variants of one another, and the schema is where that is
 * enforced. A field the format accepts and the renderer then ignores is worse than one it
 * refuses: whoever wrote it has been told it was understood.
 */
describe("the schema keeps a beacon from being a kind of buoy", () => {
  const withMark = (mark: Record<string, unknown>): Record<string, unknown> => ({
    ...scenario(),
    marks: [{ id: "shoal", at: { lat: 33.9, lon: 131.7 }, ...mark }],
  });

  it("takes both kinds", () => {
    expect(validateScenario(withMark({ kind: "buoy" })).valid).toBe(true);
    expect(validateScenario(withMark({ kind: "beacon" })).valid).toBe(true);
  });

  it("insists a mark say which it is", () => {
    const result = validateScenario(withMark({}));
    expect(result.valid).toBe(false);
    expect(result.errors.join(" ")).toContain("kind");
  });

  /**
   * An IALA shape is a statement - a can is port hand, a cone starboard - and a beacon makes
   * none. Accepting one and drawing a structure anyway would put the file and the picture at
   * odds about the same mark.
   */
  it("refuses an IALA body shape on a beacon, and allows one on a buoy", () => {
    expect(validateScenario(withMark({ kind: "beacon", shape: "can" })).valid).toBe(false);
    expect(validateScenario(withMark({ kind: "buoy", shape: "can" })).valid).toBe(true);
  });

  /** A beacon stands on a foundation. A mooring on one would describe a chain that is not there. */
  it("refuses a mooring on a beacon, and allows one on a buoy", () => {
    const mooring = { depthMetres: 20, chainScope: 3 };
    expect(validateScenario(withMark({ kind: "beacon", mooring })).valid).toBe(false);
    expect(validateScenario(withMark({ kind: "buoy", mooring })).valid).toBe(true);
  });

  /** Scope is a multiple of the depth, so under one is chain shorter than the water is deep. */
  it("refuses a mooring that could not exist", () => {
    expect(
      validateScenario(withMark({ kind: "buoy", mooring: { depthMetres: 0, chainScope: 3 } }))
        .valid,
    ).toBe(false);
    expect(
      validateScenario(withMark({ kind: "buoy", mooring: { depthMetres: 20, chainScope: 0.5 } }))
        .valid,
    ).toBe(false);
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
