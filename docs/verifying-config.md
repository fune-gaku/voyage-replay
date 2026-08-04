# Verifying that the linter and compiler are actually looking

A rule that is not enabled reports nothing. That is the whole problem: lint exits 0, the
build is green, CI is green, and the only evidence that a check is missing is the bugs it
would have caught arriving somewhere else.

So this project does not trust its own configuration files. It reads back the **effective**
configuration — what the tools resolved after every preset and `extends` — and fails if
something it relies on is absent. `npm run check:config` does that, and CI runs it before
lint, typecheck, test or build, because each of those reports only on what it was told to
look at.

## The three commands

```bash
npx eslint --print-config src/core/track.ts   # rules actually in force for that file
npx tsc -p tsconfig.json --showConfig         # compiler options after extends
npx tsc -p tsconfig.json --noEmit --<flag>    # violations if <flag> were on
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

## Where the exceptions are, and why

Three rules are relaxed, each in one place and each with the reason next to it in
`eslint.config.js`:

- **`restrict-template-expressions` allows numbers.** The rule's default refusal targets
  objects and arrays, whose stringification is a bug (`"[object Object]"`). A number has one
  obvious rendering, and this codebase formats distances, bearings and speeds constantly.
- **`no-non-null-assertion` and `no-unnecessary-condition` are off under `test/`.** Tests read
  JSON off disk and assert shapes the checker has no way to know. A non-null assertion in a
  test fails loudly and immediately, which is the wanted behaviour there.
- **Type-aware rules are off for `*.js` / `*.mjs`.** The config file and `scripts/` sit
  outside the TypeScript program, so the project service cannot type them.

An exception belongs in `eslint.config.js` with its reason. A scattered `eslint-disable`
comment is how a codebase loses a rule without noticing.

## Adding a rule to the guard

`scripts/check-config.mjs` holds two lists: type-aware ESLint rules that must be enabled,
and compiler options that must be `true`. Add to them when the project starts relying on
something new. The guard is only worth having if it can fail, so after adding an entry,
remove the corresponding setting once and confirm the check goes red.
