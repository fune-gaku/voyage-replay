import { describe, expect, it } from "vitest";

import schema from "../spec/voyage.schema.json";
import { DERIVATIONS, SOURCE_KINDS, VESSEL_TYPES } from "../src/core/types.js";

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
