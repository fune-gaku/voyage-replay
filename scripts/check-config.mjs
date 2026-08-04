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

if (problems.length > 0) {
  console.error("Configuration has quietly lost coverage:\n");
  for (const problem of problems) console.error(`  - ${problem}`);
  console.error(
    `\nSee docs/verifying-config.md. Inspect with:` +
      `\n  npx eslint --print-config ${PROBE_FILE}` +
      `\n  npx tsc -p tsconfig.json --showConfig\n`,
  );
  process.exit(1);
}

console.log(
  `Config check passed: ${enabled.size} ESLint rules enabled ` +
    `(${[...enabled].filter((r) => r.startsWith("@typescript-eslint/")).length} from ` +
    `typescript-eslint), ${REQUIRED_COMPILER_OPTIONS.length} compiler options confirmed.`,
);
