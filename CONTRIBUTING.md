# Contributing

Thanks for looking. This is a small project with one maintainer, so a little coordination saves
everyone time.

## Before writing code

**Open an issue with a plan for anything beyond a small fix.** A few paragraphs: what is wrong or
missing, the approach you have in mind, which files you expect to touch, and anything you are
unsure about. The files under [`plans/`](plans/) show the level of detail the project works at.

Typo fixes, obviously-correct one-liners and test additions can go straight to a pull request.

The issue is the entry point; [`plans/`](plans/) is where a design decision lives once it needs
more room than a comment thread. They are tied together by number:

- Anything needing a design decision gets `plans/<slug>-<issue number>.md` — what, why (above all,
  what a straightforward implementation would get wrong), which files, and the open questions.
- The pull request says `Closes #N`, and the plan moves to `plans/done/` when it merges.

The open questions are the reason a plan is a file rather than a comment: they get re-read every
time someone touches that area, and they belong in the diff where a reviewer will see them.

## The bar for correctness here is unusual

This tool makes claims about what happened. A reconstruction that looks plausible and is wrong is
worse than no reconstruction, so:

- **Anything from the COLREGs cites the rule.** Light arcs are Rule 21, ranges are Rule 22, which
  lights a vessel shows is Rule 23 and onward. Put the number in the comment.
- **Anything about a real case cites the report**, precisely enough to check by hand — document,
  table, page.
- **Do not invent a figure to fill a field.** If the source does not give a heading, the heading is
  absent. `undefined` is a fact; a plausible number is a fabrication that nothing downstream can
  detect.
- **New physical behaviour comes with a test against a real case,** not only a synthetic one.
  `test/examples.spec.ts` shows the shape.

If you find an error in the domain reasoning — a light arc, a manoeuvring assumption, a misread of
a report — that is a valuable issue even with no code attached. Say what is wrong and what it
should be.

## Running things

```bash
npm install
npm run check:config && npm run lint && npm run typecheck && npm test && npm run build
```

CI runs exactly those, so a green local run is a green CI run. `npm run format` runs Prettier;
Markdown is deliberately excluded.

`check:config` comes first on purpose. Linting is type-aware here, and a config that loses
`parserOptions.projectService` or drops back to a non-`TypeChecked` preset still exits 0 while
silently checking nothing — so the absence is asserted directly rather than assumed. If you
need an exception to a rule, put it in `eslint.config.js` with the reason, not in a scattered
`eslint-disable` comment. See [docs/verifying-config.md](docs/verifying-config.md).

## Two gates that will fail your first pull request

Neither is a style preference, and neither is enforced by asking. Both fail the build.

**Functions stay under three limits**, and they are deliberately different measures:

| | | |
|---|---:|---|
| `max-lines-per-function` | 30 | code only — blank lines and comments are not charged for |
| `complexity` | 10 | cyclomatic, the number McCabe proposed with the measure in 1976 |
| `max-params` | 4 | five is where a call site stops being readable |

Write the comments; they cost nothing against the length. The length limit is also what
protects the coverage figure below: one long function is entered by a single test and
reports as covered while most of its branches never run, where the same code as six named
pieces has to be reached on purpose. It does not apply under `test/`, where a `describe`
body is a list of cases rather than code.

When `max-params` fires, the move that works is almost never "pass fewer things". It is to
notice that some of them travel together and give that group a name. `Interval` in
`src/core/plausibility.ts`, `Encounter` in `src/ui/panels.ts` and `Report` in `src/main.ts`
all came from exactly that, and each ended up naming something the code had been carrying
around unnamed.

The length limit was 20 before it was 30, and the history is written down in
[docs/verifying-config.md](docs/verifying-config.md) because the measurement is more useful
than the number: 30 still catches every function that was genuinely hard to read, while 20
was mostly catching Prettier's line wrapping and pushing the complexity into parameter lists.

**New code comes with tests, and coverage cannot fall.** `npm test` measures it and fails
under the thresholds in `vitest.config.ts` (currently 90% lines and statements, 95%
functions, 80% branches). Raise a threshold when the real figure rises; do not lower one to
get a green run.

Do not assume rendering code is untestable. three.js builds scenes, hulls, light sectors and
cameras perfectly well in plain Node — only the renderer itself needs a GL context, so only
`player.ts`, `record.ts` and `main.ts` are excluded, and those are named in the config with
the reason. `test/scene.spec.ts` and `test/cameras.spec.ts` show the shape.

Tests here pin domain facts rather than implementation: that the arcs tile the horizon, that
a reconstructed stretch of track draws dashed, that an aspect read from a course rather than
a heading says so. `test/fixtures.ts` holds hand-built scenarios for that; `examples/` is a
real case and is not the place to add one.

## Data

Do not commit source PDFs, and do not commit scenario data whose origin you cannot cite. Every
example must name its source and carry a `derivation` on each track. Reports from investigation
bodies are public documents, but redistribution terms vary by body — check before adding an
example derived from a new source, and record what you found in the file's `meta.license`.

## Secrets

Two layers, and they catch different things.

**Before the commit.** [`.githooks/pre-commit`](.githooks/pre-commit) runs gitleaks over the
staged changes. `npm install` points git at that directory for you — the `prepare` script sets
`core.hooksPath` — so the only thing to do by hand is install gitleaks itself:

```bash
brew install gitleaks     # the hook refuses to run without it
npm run check:secrets     # scan history and working tree on demand
```

The hook lives under version control rather than in `.git/hooks` so that it is reviewable in a
pull request and identical on every machine.

**After the push.** CI scans the full history and the working tree. This is the backstop, not
the gate that matters: by the time it runs, the credential is on a server, and rotating it is
the only real remedy. `--no-verify` does not avoid the problem, it just moves the finding here.

False positives go in `.gitleaksignore` as a fingerprint, with a comment saying why.

Note for anyone testing the hook: **do not probe it with `AKIAIOSFODNN7EXAMPLE`.** gitleaks
allowlists the canonical AWS documentation key on purpose, so nothing fires and the hook looks
broken when it is not. Use a `ghp_`-shaped token or an RSA private key header.

## Style

Comments explain *why*, especially where the domain makes an obvious-looking implementation wrong.
The code is dense with those; match it rather than stripping them.
