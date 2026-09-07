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

/**
 * The light a mark carries. The schema's job is the shape of the field; whether the character
 * inside it can be READ is `core/light-character.ts`'s, and the two are deliberately
 * separate - a file may carry an abbreviation this tool has not learned yet without being an
 * invalid file.
 */
describe("the schema on a mark's light", () => {
  const withLight = (light: unknown): Record<string, unknown> => ({
    ...scenario(),
    marks: [{ id: "no-1", kind: "buoy", at: { lat: 33.9, lon: 131.7 }, light }],
  });

  it("takes a character on its own, which is all a report usually gives", () => {
    expect(validateScenario(withLight({ character: "Fl(2) R 10s" })).valid).toBe(true);
  });

  /**
   * A light with no character used to be refused, on the grounds that a rhythm is what
   * identifies a mark. It is taken now, because `purpose` answers for it: a north cardinal
   * shows VQ because it is a north cardinal, and a report that says a mark was lit without
   * saying what it showed is the ordinary case rather than an invalid file.
   *
   * `test/mark-light.spec.ts` holds the other half - a light with neither a character nor a
   * purpose is readable as a file and still gets nothing drawn.
   */
  it("takes a light with no character, since the mark's purpose can answer for it", () => {
    expect(validateScenario(withLight({})).valid).toBe(true);
    expect(validateScenario(withLight({ phases: [{ seconds: 1 }, { seconds: 3 }] })).valid).toBe(
      true,
    );
  });

  it("takes stated timings, with darkness written as a phase of no colour", () => {
    const stated = withLight({
      character: "Fl R 4s",
      phases: [{ seconds: 0.3, colour: "red" }, { seconds: 3.7 }],
    });
    expect(validateScenario(stated).valid).toBe(true);
  });

  /**
   * A phase of no length is a step no clock can land on, and a negative one runs the light
   * backwards through its own period. `test/mark-light.spec.ts` holds the same bound in the
   * code, since a scenario reaches that function by roads other than this validator.
   */
  it("refuses a phase of no length, and a sequence with only one phase in it", () => {
    expect(
      validateScenario(
        withLight({ character: "Fl R 4s", phases: [{ seconds: 0 }, { seconds: 4 }] }),
      ).valid,
    ).toBe(false);
    expect(
      validateScenario(withLight({ character: "Fl R 4s", phases: [{ seconds: 4 }] })).valid,
    ).toBe(false);
  });

  it("refuses a colour the buoyage does not use", () => {
    const purple = withLight({
      character: "Fl R 4s",
      phases: [{ seconds: 1, colour: "purple" }, { seconds: 3 }],
    });
    expect(validateScenario(purple).valid).toBe(false);
  });
});

/**
 * The fields the buoyage generates from, and the two the schema keeps on their own kinds.
 */
describe("the schema on what a mark means", () => {
  const withMark = (mark: Record<string, unknown>): Record<string, unknown> => ({
    ...scenario(),
    marks: [{ id: "no-1", kind: "buoy", at: { lat: 33.9, lon: 131.7 }, ...mark }],
  });

  /**
   * R1001 heads that column "Topmark (if any)", and notes an authority may leave them off in
   * weather or ice. So "there was none" is a fact a report can state, not a gap in it.
   */
  it("takes a statement that a mark carried no topmark", () => {
    expect(validateScenario(withMark({ topmark: false })).valid).toBe(true);
    expect(validateScenario(withMark({ topmark: "none" })).valid).toBe(false);
  });

  /** A draught is what her natural period rests on, and a source sometimes gives it. */
  it("takes a stated draught, and refuses one that is not a depth", () => {
    expect(validateScenario(withMark({ draughtMetres: 2.4 })).valid).toBe(true);
    expect(validateScenario(withMark({ draughtMetres: 0 })).valid).toBe(false);
    expect(validateScenario(withMark({ draughtMetres: -1 })).valid).toBe(false);
  });

  it("takes a purpose, and refuses one that is not in the buoyage", () => {
    expect(validateScenario(withMark({ purpose: "north-cardinal" })).valid).toBe(true);
    expect(validateScenario(withMark({ purpose: "north-westerly" })).valid).toBe(false);
  });

  /**
   * One colour is what SOLID means. Two would be drawn as bands by the renderer and printed
   * as the first of them by the page - the same field read two ways, which is the fault the
   * whole pattern field exists to close. `test/mark.spec.ts` holds the code's own clamp.
   */
  it("holds a solid pattern to one colour and a banded one to more than one", () => {
    const solid = (colours: string[]): Record<string, unknown> =>
      withMark({ pattern: { kind: "solid", colours } });
    expect(validateScenario(solid(["red"])).valid).toBe(true);
    expect(validateScenario(solid(["red", "green"])).valid).toBe(false);

    const banded = (colours: string[]): Record<string, unknown> =>
      withMark({ pattern: { kind: "horizontal bands", colours } });
    expect(validateScenario(banded(["black", "yellow"])).valid).toBe(true);
    expect(validateScenario(banded(["black"])).valid).toBe(false);
  });

  it("takes a pattern of bands and stripes, which one colour could never state", () => {
    const banded = { kind: "horizontal bands", colours: ["black", "yellow"] };
    expect(validateScenario(withMark({ pattern: banded })).valid).toBe(true);
    expect(validateScenario(withMark({ pattern: { kind: "solid", colours: [] } })).valid).toBe(
      false,
    );
    expect(
      validateScenario(withMark({ pattern: { kind: "diagonal", colours: ["red"] } })).valid,
    ).toBe(false);
  });

  /**
   * How a mark is BUILT is a beacon's question - a tower, a lattice, a column, a pile - and
   * it means nothing. A buoy's counterpart is its IALA shape, which means a great deal. The
   * schema keeps each on its own kind so neither can be stated and then ignored.
   */
  it("puts construction on a beacon and shape on a buoy, and neither on the other", () => {
    const beacon = (mark: Record<string, unknown>): Record<string, unknown> => ({
      ...scenario(),
      marks: [{ id: "shoal", kind: "beacon", at: { lat: 33.9, lon: 131.7 }, ...mark }],
    });
    expect(validateScenario(beacon({ construction: "lattice" })).valid).toBe(true);
    expect(validateScenario(beacon({ shape: "can" })).valid).toBe(false);
    expect(validateScenario(withMark({ construction: "lattice" })).valid).toBe(false);
    expect(validateScenario(withMark({ shape: "can" })).valid).toBe(true);
  });

  /**
   * An empty light says the mark WAS lit without saying what it showed - which is what a
   * report usually gives, and what `purpose` then answers for.
   */
  it("takes a light with no character, since the purpose can answer for it", () => {
    expect(validateScenario(withMark({ purpose: "north-cardinal", light: {} })).valid).toBe(true);
  });

  it("takes the buoyage region on the scenario, and only A or B", () => {
    const inJapan = { ...scenario(), meta: { ...scenario().meta, buoyageRegion: "B" } };
    const nowhere = { ...scenario(), meta: { ...scenario().meta, buoyageRegion: "C" } };
    expect(validateScenario(inJapan).valid).toBe(true);
    expect(validateScenario(nowhere).valid).toBe(false);
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
