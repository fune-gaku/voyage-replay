import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

import schema from "../../spec/voyage.schema.json";
import type { Scenario } from "./types.js";

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const compiled = ajv.compile(schema);

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Validate against spec/voyage.schema.json - the same file that ships as the format's
 * contract, so a scenario that passes here passes for anyone else reading the spec.
 *
 * This checks shape only. Physical plausibility (a ship that does 40 knots, or turns
 * 180 degrees in ten seconds) is a separate pass: see checkPlausibility.
 */
export function validateScenario(value: unknown): ValidationResult {
  const valid = compiled(value);
  if (valid) return { valid: true, errors: [] };
  const errors = (compiled.errors ?? []).map(
    (e) => `${e.instancePath || "/"} ${e.message ?? "is invalid"}`,
  );
  return { valid: false, errors };
}

export function parseScenario(value: unknown): Scenario {
  const result = validateScenario(value);
  if (!result.valid) {
    throw new Error(`not a valid .voyage.json:\n  ${result.errors.join("\n  ")}`);
  }
  return value as Scenario;
}
