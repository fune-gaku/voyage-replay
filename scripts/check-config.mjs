#!/usr/bin/env node
/**
 * Assert that the linter and the compiler are actually configured to look at the things
 * we think they look at.
 *
 * A missing rule reports nothing. Drop `projectService` from the ESLint config, or swap
 * `strictTypeChecked` back for `recommended`, and every type-aware rule silently stops
 * running: lint still exits 0, CI still goes green, and the only symptom is bugs that used
 * to be caught arriving in review instead. The same is true of a compiler flag deleted
 * from tsconfig.
 *
 * So this reads the EFFECTIVE configuration - what the tools resolved after every preset
 * and `extends` - rather than the files, and fails if something we rely on is not there.
 */

import { execFileSync } from "node:child_process";

const PROBE_FILE = "src/core/track.ts";

// Type-aware rules this codebase leans on. Each one is absent from `recommended` and from
// `strict`; they exist only in the *TypeChecked presets, and only run with projectService.
const REQUIRED_ESLINT_RULES = [
  "@typescript-eslint/no-floating-promises",
  "@typescript-eslint/no-misused-promises",
  "@typescript-eslint/await-thenable",
  "@typescript-eslint/consistent-type-assertions",
  "@typescript-eslint/no-unsafe-assignment",
  "@typescript-eslint/no-unsafe-member-access",
  "@typescript-eslint/no-unsafe-call",
  "@typescript-eslint/no-unsafe-return",
  "@typescript-eslint/no-unsafe-argument",
  "@typescript-eslint/restrict-template-expressions",
  "@typescript-eslint/no-unnecessary-condition",
];

// The three size limits, with the numbers they must still be set to.
//
// Repeated here so that relaxing one has to be done deliberately in two places, rather
// than nudged upward to make a single run pass. Checking that a rule is merely "on" would
// not catch that: max-lines-per-function reports nothing at max: 200 and would still be
// listed among the enabled rules below.
const REQUIRED_LIMITS = {
  // Lines of code per function, blank lines and comments not counted. This was 20 first,
  // and 20 was measured to be too tight - see docs/verifying-config.md.
  "max-lines-per-function": 30,
  // Cyclomatic complexity, at the limit McCabe published with the measure itself in 1976.
  complexity: 10,
  // Five parameters is where a signature stops being readable at the call site.
  "max-params": 4,
};

// The floors under vitest.config.ts. Same reasoning: a threshold is only a gate while it
// is above where the suite would otherwise sit, and lowering one to get a green run is the
// obvious move at exactly the moment it should not be made.
const REQUIRED_COVERAGE_THRESHOLDS = {
  lines: 98,
  functions: 99,
  branches: 83,
  statements: 95,
};

// Compiler flags NOT implied by `strict: true`. Losing one is invisible: the build stays
// green because the checker simply stops asking the question.
const REQUIRED_COMPILER_OPTIONS = [
  "strict",
  "noUncheckedIndexedAccess",
  "exactOptionalPropertyTypes",
  "noImplicitReturns",
  "noPropertyAccessFromIndexSignature",
  "noImplicitOverride",
  "noFallthroughCasesInSwitch",
  "noUnusedLocals",
  "noUnusedParameters",
];

const problems = [];

const eslintConfig = JSON.parse(
  execFileSync("npx", ["eslint", "--print-config", PROBE_FILE], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  }),
);

if (eslintConfig.languageOptions?.parserOptions?.projectService !== true) {
  problems.push("ESLint has no parserOptions.projectService, so no type-aware rule can run at all");
}

const enabled = new Set(
  Object.entries(eslintConfig.rules ?? {})
    .filter(([, setting]) => {
      const severity = Array.isArray(setting) ? setting[0] : setting;
      return severity !== 0 && severity !== "off";
    })
    .map(([name]) => name),
);

for (const rule of REQUIRED_ESLINT_RULES) {
  if (!enabled.has(rule)) problems.push(`ESLint rule is off: ${rule}`);
}

/** The rule's configured number, whether it is written bare or inside an options object. */
function configuredLimit(rule) {
  const setting = eslintConfig.rules?.[rule];
  const option = Array.isArray(setting) ? setting[1] : undefined;
  return typeof option === "object" && option !== null ? option.max : option;
}

for (const [rule, limit] of Object.entries(REQUIRED_LIMITS)) {
  if (!enabled.has(rule)) {
    problems.push(`ESLint rule is off: ${rule}`);
    continue;
  }
  const actual = configuredLimit(rule);
  if (actual !== limit) {
    problems.push(
      `${rule} allows ${actual ?? "an unstated number"}, not the ${limit} agreed on here`,
    );
  }
}

// Comments must stay outside the length count. This codebase pays for its explanations in
// lines, and a limit that charged for them would be settled by deleting them.
const lengthSetting = eslintConfig.rules?.["max-lines-per-function"];
const lengthOptions = Array.isArray(lengthSetting) ? lengthSetting[1] : undefined;
if (lengthOptions?.skipComments !== true) {
  problems.push(
    "max-lines-per-function counts comments, which prices the explanations this " +
      "codebase depends on and pays for them by deleting them",
  );
}

const tsconfig = JSON.parse(
  execFileSync("npx", ["tsc", "-p", "tsconfig.json", "--showConfig"], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  }),
);

for (const option of REQUIRED_COMPILER_OPTIONS) {
  if (tsconfig.compilerOptions?.[option] !== true) {
    problems.push(`tsconfig option is not on: ${option}`);
  }
}

// The coverage gate, read the same way: from the configuration Vitest actually resolved,
// not from the file. A deleted `thresholds` block is the failure to look for - coverage
// still gets measured and still gets printed, and the run simply stops failing.
let coverage;
try {
  const { resolveConfig } = await import("vitest/node");
  const resolved = await resolveConfig({ config: "vitest.config.ts", coverage: { enabled: true } });
  coverage = resolved.vitestConfig?.coverage;
} catch (error) {
  problems.push(`could not resolve the Vitest configuration: ${error.message}`);
}

if (coverage) {
  const thresholds = coverage.thresholds ?? {};
  for (const [metric, floor] of Object.entries(REQUIRED_COVERAGE_THRESHOLDS)) {
    if (typeof thresholds[metric] !== "number") {
      problems.push(`coverage threshold is not set: ${metric}`);
    } else if (thresholds[metric] < floor) {
      problems.push(
        `coverage threshold for ${metric} is ${thresholds[metric]}, below the agreed ${floor}`,
      );
    }
  }
  // Without an `include` glob over the source, coverage is measured only over the files
  // the tests happened to load. A module with no test is then not counted as untested but
  // left out altogether, so adding untested code makes the percentage go UP and the floors
  // above stop meaning anything.
  if (!(coverage.include ?? []).some((glob) => glob.startsWith("src/"))) {
    problems.push(
      "coverage.include does not cover src/, so a module with no test at all is left " +
        "out of the figures rather than counted as untested",
    );
  }
}

if (problems.length > 0) {
  console.error("Configuration has quietly lost coverage:\n");
  for (const problem of problems) console.error(`  - ${problem}`);
  console.error(
    `\nSee docs/verifying-config.md. Inspect with:` +
      `\n  npx eslint --print-config ${PROBE_FILE}` +
      `\n  npx tsc -p tsconfig.json --showConfig` +
      `\n  npx vitest run --coverage\n`,
  );
  process.exit(1);
}

console.log(
  `Config check passed: ${enabled.size} ESLint rules enabled ` +
    `(${[...enabled].filter((r) => r.startsWith("@typescript-eslint/")).length} from ` +
    `typescript-eslint), ${REQUIRED_COMPILER_OPTIONS.length} compiler options confirmed, ` +
    `size limits ${Object.entries(REQUIRED_LIMITS)
      .map(([rule, limit]) => `${rule} ${limit}`)
      .join(", ")}, ` +
    `coverage floors ${Object.entries(REQUIRED_COVERAGE_THRESHOLDS)
      .map(([metric, floor]) => `${metric} ${floor}%`)
      .join(", ")}.`,
);
