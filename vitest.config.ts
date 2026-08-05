import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    include: ["test/**/*.spec.ts"],

    coverage: {
      provider: "v8",
      /**
       * `include` is the setting that makes this number mean anything, and it is easy to
       * mistake for a convenience.
       *
       * Without it, coverage is measured over the files the tests happened to load - so a
       * module with no test at all is not counted as untested, it is not counted at all,
       * and the percentage RISES when untested code is added. The effect is small while
       * everything happens to be imported (98.22% with it, 98.28% without) and unbounded
       * the moment someone adds a file nobody tests, which is exactly when the number
       * needs to move the other way.
       */
      include: ["src/**/*.ts"],
      exclude: [
        /**
         * One module, and the reason is this repository's own shape rather than the browser.
         *
         * `main.ts` runs on import - `void main()` sits at the top level - and not one of
         * its nine wiring functions is exported. There is no way to reach a part of it
         * without running the whole thing against a real page, so covering it means giving
         * the module a seam first. That is a change to the code, not a test to write.
         *
         * This list held two more files for a while, on the stated grounds that they
         * needed a real browser. They did not. `render/player.ts` needed one class of
         * three.js stood in for and `render/record.ts` needed one browser API stood in
         * for; both are covered now, at 100% and 97%, with no new dependency and no
         * headless browser. An exclusion is for code that cannot be measured. It is not
         * for code that has not been.
         */
        "src/main.ts",
        // Re-export barrel and type declarations. Neither has behaviour to exercise, and
        // both would otherwise be counted as untested code that cannot be tested.
        "src/index.ts",
        "src/core/types.ts",
      ],
      reporter: ["text", "html"],
      // Report the fully-covered files too. The interesting question when reading this is
      // "what is not covered", but the answer is only trustworthy if the whole list is there.
      skipFull: false,

      /**
       * Thresholds fail the run rather than colouring a report.
       *
       * They are set just under where the suite actually stands, so an honest refactor
       * has room to move while a new untested branch pushes it back through the floor.
       * Raise them when the real figure rises; do not lower them to make a run pass.
       */
      thresholds: {
        lines: 95,
        functions: 98,
        branches: 82,
        statements: 93,
      },
    },
  },
});
