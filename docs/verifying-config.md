# Verifying that the linter and compiler are actually looking

A rule that is not enabled reports nothing. That is the whole problem: lint exits 0, the
build is green, CI is green, and the only evidence that a check is missing is the bugs it
would have caught arriving somewhere else.

So this project does not trust its own configuration files. It reads back the **effective**
configuration — what the tools resolved after every preset and `extends` — and fails if
something it relies on is absent. `npm run check:config` does that, and CI runs it before
lint, typecheck, test or build, because each of those reports only on what it was told to
look at.

## The four commands

```bash
npx eslint --print-config src/core/track.ts   # rules actually in force for that file
npx tsc -p tsconfig.json --showConfig         # compiler options after extends
npx tsc -p tsconfig.json --noEmit --<flag>    # violations if <flag> were on
npx vitest run --coverage                     # what the tests actually reach
```

The third is how to decide whether to adopt a flag: turn it on for one run and count.

## What was missing here, measured

This repository was set up with `tseslint.configs.recommended` and `strict: true`, which
reads like a strict configuration and is not one. Before the fix:

| | |
|---|---|
| ESLint rules in force | 67 (21 from typescript-eslint) |
| `parserOptions.projectService` | absent — **no type-aware rule could run at all** |
| `no-floating-promises`, `no-misused-promises`, `await-thenable` | off |
| `consistent-type-assertions` | off |
| every `no-unsafe-*` | off |

After switching to `strictTypeChecked` + `stylisticTypeChecked` with `projectService`:
**136 rules (90 from typescript-eslint), and 19 real violations appeared** in code that had
been linting clean — unchecked non-null assertions, an `any` from `JSON.parse` flowing into
a typed function, and template literals interpolating values the checker could not vouch for.

None of them were suppressed. They were fixed.

## `strict: true` is not the strict setting

`strict` switches on eight flags. It leaves these off, and each was checked here by running
the compiler with it and counting:

| Flag | Violations when enabled | Adopted |
|---|---:|---|
| `noUncheckedIndexedAccess` | (already on) | yes |
| `exactOptionalPropertyTypes` | (already on) | yes |
| `noImplicitReturns` | 0 | yes |
| `noPropertyAccessFromIndexSignature` | 4 | yes, after fixing them |
| `noUncheckedSideEffectImports` | 0 | yes |
| `allowUnreachableCode: false` | 0 | yes |
| `allowUnusedLabels: false` | 0 | yes |
| `erasableSyntaxOnly` | — | not available in TypeScript 5.7 |

## Two more gates: function size and test coverage

Both are ordinary settings in ordinary config files, and both would go quiet rather than
loud if deleted — which is the same failure mode as everything above, so both are checked
the same way.

### Size: three limits, measuring three different things

| Rule | Here | ESLint default | Catches |
|---|---:|---:|---|
| `max-lines-per-function` | 30 | 50 | a function that sprawls |
| `complexity` | 10 | 20 | a function that branches |
| `max-params` | 4 | 3 | where the other two push the mess |

Comments and blank lines do not count towards the length. This codebase pays for its
explanations in lines, and a limit that charged for them would be settled by deleting them.
`check:config` asserts each rule is on **and** that its number is unchanged — a cap relaxed
to 200 is still an "enabled rule" and still reports nothing.

The length rule is **off under `test/`**, because it cannot tell a `describe` body from a
function. A `describe` is a list of cases; its length says how many things are being
checked, and capping it would split suites by line count rather than by subject.

#### Why 30 and not 20, measured

The limit was 20 first — the number from *Clean Code*, which is a heuristic rather than a
measured threshold, and the strictest in circulation. Nineteen functions were split to meet
it. Reading the result back:

- The functions that were genuinely hard to read were **47 to 68 lines**: `checkPlausibility`
  at 68, `wireControls` at 66, `buildScene` at 50, the `Replay` constructor at 47. **30
  catches every one of them** — 8 of the 19 were over 30.
- The other **11 were between 20 and 30**, and what the limit caught there was Prettier's
  wrapping rather than complexity. `lampPosition` is the clearest: 20 lines, **2 statements**
  — a `switch` returning one tuple per Rule 21 light. A `return` object spread over nine
  lines is one statement, not nine.
- The splitting produced **four functions needing five parameters**, where nothing in the
  codebase had needed five before. That is not complexity removed, only complexity moved
  into the call — which is what `max-params` now catches, and what fixing those four
  produced `Interval`, `Encounter` and `Report` to hold.

Against the same code, every complexity measure was already comfortable: **cyclomatic
complexity 8**, **nesting depth 2**. So the length limit was the only one under pressure,
and it was under pressure from formatting.

For the record, the published numbers this was weighed against: ESLint's default 50;
McCabe (1976), which proposed **10** for cyclomatic complexity when it introduced the
measure; NASA/JPL's *Power of Ten* rule 4, one printed page (~60 lines); and the Linux
kernel's coding style, which sets no fixed number at all — it ties the maximum length to
complexity and says a simple function may be longer.

The code was **not** re-merged when the limit moved to 30. It is written, tested and reads
well; raising the ceiling is about removing future pressure, not a reason to churn.

### Coverage

**Coverage thresholds fail the run**, not a report (`thresholds` in `vitest.config.ts`, and
`npm test` measures coverage so the gate cannot be skipped). The load-bearing setting is
easy to miss: `coverage.include` over `src/**`. Without it, coverage is measured only over
the files the tests happened to load, so a module with no test at all is not counted as
untested — it is not counted at all, and **the percentage rises when untested code is
added**. Measured here: dropping that one line takes `src/main.ts` out of the report and
moves the figure from 97.36% to 97.48%.

Where it stands, and the floors it must not fall below:

| | Measured | Floor |
|---|---:|---:|
| Lines | 98.22% | 95% |
| Statements | 95.70% | 93% |
| Functions | 99.32% | 98% |
| Branches | 83.57% | 82% |

#### What is excluded, and the exclusion that was wrong

**`src/main.ts` only**, and the reason is this repository's own shape rather than the
browser: `void main()` sits at the module's top level, so importing it runs it, and not one
of its nine wiring functions is exported. There is no way to reach a part of it without
driving the whole thing against a real page. Covering it means giving the module a seam
first — a change to the code, not a test to write.

The list held **`src/render/player.ts` and `src/render/record.ts`** too, on the stated
grounds that they needed a real browser. That claim was written without being tested, and
it was wrong:

- `record.ts` never touches a GL context or the DOM. It asks the canvas for a stream and
  hands it to a `MediaRecorder`; standing in for that one API covers the file in plain Node.
- `player.ts` needs exactly one class of three.js stood in for. `WebGLRenderer` wants a GL
  context; scenes, geometry, cameras and all the arithmetic that puts a hull where the
  track says it was do not. Mocking that one class also makes the interesting question
  observable — recording what `render` was handed answers "which camera was the viewer
  looking through", which is what the class exists to decide.

Both are covered now, at **100% of lines each**, with no new dependency and no headless
browser. Excluding them had put **44% of `src/` outside the measurement**, so the figure
being reported was over little more than half the code. It is now over 82%.

The rule this settles: **an exclusion is for code that cannot be measured, not for code
that has not been.** Before adding one, try the cheap stand-in first — `test/record.spec.ts`
and `test/player.spec.ts` are the pattern, alongside `test/scene.spec.ts` and
`test/hull.spec.ts` for the parts that need no stand-in at all.

## Where the exceptions are, and why

Three rules are relaxed, each in one place and each with the reason next to it in
`eslint.config.js`:

- **`restrict-template-expressions` allows numbers.** The rule's default refusal targets
  objects and arrays, whose stringification is a bug (`"[object Object]"`). A number has one
  obvious rendering, and this codebase formats distances, bearings and speeds constantly.
- **`no-non-null-assertion`, `no-unnecessary-condition` and `max-lines-per-function` are off
  under `test/`.** Tests read JSON off disk and assert shapes the checker has no way to know.
  A non-null assertion in a test fails loudly and immediately, which is the wanted behaviour
  there. The length cap is off for the reason given above: a `describe` is a list, not code.
- **`max-statements` is not enabled at all**, and that is a decision rather than an
  oversight. It measures neither branching nor nesting, so it scores a linear run of
  assignments the same as a thicket — `main` is 14 statements and reads straight down the
  page. Cyclomatic complexity is the metric that literature actually converged on, and it
  is the one enabled above.
- **Type-aware rules are off for `*.js` / `*.mjs`.** The config file and `scripts/` sit
  outside the TypeScript program, so the project service cannot type them.

An exception belongs in `eslint.config.js` with its reason. A scattered `eslint-disable`
comment is how a codebase loses a rule without noticing.

## Adding a rule to the guard

`scripts/check-config.mjs` holds four things: type-aware ESLint rules that must be enabled,
compiler options that must be `true`, the three size limits and their numbers, and the
coverage floors. Add to them when the project starts relying on something new.

The guard is only worth having if it can fail, so after adding an entry, remove the
corresponding setting once and confirm the check goes red. Each of the current entries was
checked that way:

| Setting removed or relaxed | What `check:config` said |
|---|---|
| `max-lines-per-function` raised to 100 | `allows 100, not the 30 agreed on here` |
| `complexity` raised to 25 | `allows 25, not the 10 agreed on here` |
| `complexity` turned off | `ESLint rule is off: complexity` |
| `max-params` raised to 8 | `allows 8, not the 4 agreed on here` |
| `skipComments` turned off | `counts comments, which prices the explanations this codebase depends on` |
| `thresholds` block deleted | `coverage threshold is not set: lines` (and the other three) |
| `coverage.include` deleted | `does not cover src/, so a module with no test at all is left out` |
| `branches` floor raised to 99 | the test run itself: `Coverage for branches (83.57%) does not meet global threshold (99%)`, exit 1 |

And the coverage floors themselves fail the test run rather than the config check — raising
`branches` to 99 gives `ERROR: Coverage for branches (83.41%) does not meet global threshold
(99%)` and exit code 1.
