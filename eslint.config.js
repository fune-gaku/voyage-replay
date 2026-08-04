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
    },
  },
);
