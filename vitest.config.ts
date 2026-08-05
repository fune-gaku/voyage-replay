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
       * and the percentage RISES when untested code is added. Measured here: dropping this
       * line takes main.ts out of the report and moves the figure from 97.36% to 97.48%.
       */
      include: ["src/**/*.ts"],
      exclude: [
        // Needs a real browser, not a DOM shim: a WebGLRenderer wants a GL context, the
        // recorder wants MediaRecorder and canvas.captureStream, and main.ts is the DOM
        // wiring that hangs the two together. Everything they call - the geometry, the
        // arcs, the cameras, the panels - is covered below on its own. Closing this gap
        // means a headless browser run, which is a separate piece of work; until then it
        // is stated here rather than hidden inside a lower global threshold.
        "src/main.ts",
        "src/render/player.ts",
        "src/render/record.ts",
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
        lines: 90,
        functions: 95,
        branches: 80,
        statements: 90,
      },
    },
  },
});
