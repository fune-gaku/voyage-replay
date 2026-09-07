import { describe, expect, it } from "vitest";

import schema from "../spec/voyage.schema.json";
import {
  DERIVATIONS,
  MARK_COLOURS,
  MARK_CONSTRUCTIONS,
  MARK_KINDS,
  MARK_PURPOSES,
  MARK_SHAPES,
  SOURCE_KINDS,
  VESSEL_TYPES,
} from "../src/core/types.js";

/**
 * The schema is the contract; the TypeScript types are a mirror of it kept for our own
 * code. Nothing forces the two to agree - a value added to one and forgotten in the other
 * type-checks, validates, and passes every other test, and only shows up as a scenario
 * that one half of the codebase accepts and the other rejects.
 */
describe("the schema and the TypeScript types agree", () => {
  const defs: Record<string, unknown> = schema.$defs;

  /** Pull an `enum` out of the schema by path, so a moved definition fails loudly. */
  function enumAt(...path: string[]): readonly string[] {
    let node: unknown = defs;
    for (const key of path) {
      expect(node, `no ${path.join(".")} in the schema`).toBeTypeOf("object");
      node = (node as Record<string, unknown>)[key];
    }
    const values = (node as { enum?: readonly string[] } | undefined)?.enum;
    expect(values, `no enum at ${path.join(".")}`).toBeDefined();
    return values ?? [];
  }

  it("agrees on derivation", () => {
    expect([...enumAt("derivation")].sort()).toEqual([...DERIVATIONS].sort());
  });

  it("agrees on source kind", () => {
    expect([...enumAt("source", "properties", "kind")].sort()).toEqual([...SOURCE_KINDS].sort());
  });

  it("agrees on vessel type", () => {
    expect([...enumAt("vessel", "properties", "type")].sort()).toEqual([...VESSEL_TYPES].sort());
  });

  /**
   * The three closed sets a sea mark carries. The kind is the one that matters most: four
   * other fields mean different things depending on it, and two of them are refused outright
   * on a beacon - so a value the schema takes and the code does not know is not a cosmetic
   * drift but a mark whose shape and mooring nothing is checking.
   */
  it("agrees on mark kind", () => {
    expect([...enumAt("mark", "properties", "kind")].sort()).toEqual([...MARK_KINDS].sort());
  });

  it("agrees on mark shape, colour and construction", () => {
    expect([...enumAt("mark", "properties", "shape")].sort()).toEqual([...MARK_SHAPES].sort());
    expect(
      [...enumAt("mark", "properties", "pattern", "properties", "colours", "items")].sort(),
    ).toEqual([...MARK_COLOURS].sort());
    expect([...enumAt("mark", "properties", "construction")].sort()).toEqual(
      [...MARK_CONSTRUCTIONS].sort(),
    );
  });

  /**
   * The purpose is the one the rest is generated from - the colours, the topmark and the
   * rhythm all come off it - so a value the schema takes and the code has never heard of is
   * not a cosmetic drift but a mark drawn as something else entirely.
   */
  it("agrees on what a mark can be for", () => {
    expect([...enumAt("mark", "properties", "purpose")].sort()).toEqual([...MARK_PURPOSES].sort());
  });

  it("only knows about the vessel actor kind", () => {
    expect(enumAt("actor", "properties", "kind")).toEqual(["vessel"]);
  });

  // 0.x means the format may change without a migration. When this becomes 1.0 the
  // promise changes, and that is a decision to make deliberately rather than by editing
  // a string - so make it fail here first.
  it("is still an unstable 0.x format", () => {
    expect(schema.description).toContain("UNSTABLE");
  });
});
