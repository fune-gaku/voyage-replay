// @ts-check
import js from "@eslint/js";
import tseslint from "typescript-eslint";

/**
 * Type-aware linting is on deliberately.
 *
 * `tseslint.configs.recommended` - and `strict` too - contains no rule that consults the
 * type checker. Every `no-unsafe-*`, `no-floating-promises`, `await-thenable` and
 * `consistent-type-assertions` lives only in the `*TypeChecked` presets, and those do
 * nothing without `parserOptions.projectService`. A config missing either half still lints
 * clean, which is the problem: it reports what it looked at, never what it could not see.
 *
 * Verify rather than trust this comment:
 *   npx eslint --print-config src/core/track.ts
 */
export default tseslint.config(
  { ignores: ["dist/**", "node_modules/**", "coverage/**"] },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],

      // A cast asserts something the checker cannot see, which in this codebase means
      // asserting something about data that came out of a PDF. Where one is genuinely
      // needed - immediately after schema validation, say - it is written `as` with the
      // reason next to it, not spread through the code.
      "@typescript-eslint/consistent-type-assertions": [
        "error",
        { assertionStyle: "as", objectLiteralTypeAssertions: "never" },
      ],

      // Numbers are allowed in template literals. The rule's default refusal is aimed at
      // objects and arrays, whose stringification is a bug ("[object Object]"); a number
      // has one obvious rendering, and this codebase formats distances, bearings and
      // speeds into strings constantly.
      "@typescript-eslint/restrict-template-expressions": ["error", { allowNumber: true }],

      /**
       * Three limits, and they are deliberately not the same kind of thing. Length catches
       * a function that sprawls; complexity catches one that branches; the parameter count
       * catches the place the other two push the mess when they are applied on their own.
       *
       * Thirty lines of code per function, blank lines and comments not counted.
       *
       * Comments are excluded on purpose: this codebase carries long explanations of why
       * an obvious-looking implementation would be wrong, and a limit that counted them
       * would pay for each one by deleting it. What is capped is how much a reader holds
       * in their head at once, and a comment reduces that rather than adding to it.
       *
       * It was 20 first, and 20 was measured to be too tight. The functions that were
       * genuinely hard to read were 47 to 68 lines - `checkPlausibility` at 68,
       * `wireControls` at 66, `buildScene` at 50 - and 30 still catches every one of them.
       * What the 20-to-30 band caught instead was Prettier's wrapping: a `return` object
       * spread over nine lines is one statement, not nine. Eleven of the nineteen splits
       * that limit forced were of that kind, and four of the functions it produced needed
       * five parameters where nothing in the codebase had needed five before. That is not
       * complexity removed, only complexity moved into the call.
       *
       * Length also keeps the coverage threshold honest: one long function is entered by
       * a single test and reports as covered while most of its branches never run.
       */
      "max-lines-per-function": ["error", { max: 30, skipBlankLines: true, skipComments: true }],

      // Cyclomatic complexity, at the limit McCabe proposed with the measure itself in
      // 1976. Measured maximum here is 8, so this is not a ratchet fitted to the current
      // code - it is the published number, which this codebase happens to sit under.
      complexity: ["error", 10],

      // Four parameters. ESLint's own default is 3, which is tight for a codebase that
      // passes geometry around, but 5 is where a signature stops being readable at the
      // call site - and where a caller starts getting the order wrong silently, because
      // these arguments are so often several numbers in a row.
      //
      // The fix when this fires is almost never "pass fewer things". It is to notice that
      // some of them travel together and give that group a name: `Interval` in
      // core/plausibility.ts and `Encounter` in ui/panels.ts both came from this rule.
      "max-params": ["error", 4],
    },
  },
  {
    // This config and the scripts are JavaScript, outside the TypeScript program, so the
    // project service cannot type them and every type-aware rule errors on the parse.
    files: ["**/*.js", "**/*.mjs", "**/*.cjs"],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: {
      globals: { console: "readonly", process: "readonly", Buffer: "readonly" },
    },
  },
  {
    // Tests read JSON off disk and poke at the schema as plain data, so they assert
    // shapes the checker has no way to know. Non-null assertions in a test fail loudly
    // and immediately, which is the behaviour wanted there.
    files: ["test/**/*.ts"],
    rules: {
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/no-unnecessary-condition": "off",

      // The length limit is off here, and the reason is that the rule cannot tell a
      // `describe` body from a function. A `describe` is a list of cases, not code: its
      // length says how many things are being checked, and capping it would split suites
      // by line count rather than by subject - which reads as a suite with a case missing.
      // The limit's purpose, keeping one unit of behaviour in one head, is served in a
      // test by one `it` making one claim. That is a review question, not a countable one.
      "max-lines-per-function": "off",
    },
  },
);
