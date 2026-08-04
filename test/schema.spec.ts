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
  const defs = schema.$defs as Record<string, { enum?: readonly string[] }>;

  it.each([
    ["derivation", DERIVATIONS],
    ["source kind", SOURCE_KINDS],
    ["vessel type", VESSEL_TYPES],
  ] as const)("%s", (name, values) => {
    const fromSchema =
      name === "derivation"
        ? defs.derivation?.enum
        : name === "source kind"
          ? (defs.source as { properties?: { kind?: { enum?: readonly string[] } } } | undefined)
              ?.properties?.kind?.enum
          : (defs.vessel as { properties?: { type?: { enum?: readonly string[] } } } | undefined)
              ?.properties?.type?.enum;

    expect(fromSchema, `${name} enum is missing from the schema`).toBeDefined();
    expect([...fromSchema!].sort()).toEqual([...values].sort());
  });

  it("only knows about the vessel actor kind", () => {
    const actor = defs.actor as { properties?: { kind?: { enum?: readonly string[] } } };
    expect(actor.properties?.kind?.enum).toEqual(["vessel"]);
  });

  // 0.x means the format may change without a migration. When this becomes 1.0 the
  // promise changes, and that is a decision to make deliberately rather than by editing
  // a string - so make it fail here first.
  it("is still an unstable 0.x format", () => {
    expect(schema.description).toContain("UNSTABLE");
  });
});
