# Contributing

Thanks for looking. This is a small project with one maintainer, so a little coordination saves
everyone time.

## Open an issue first — outside pull requests are not accepted

**Pull requests from outside the development team are not accepted, regardless of size. An issue
is the only way in** — bug reports, feature proposals, and corrections to the domain reasoning are
all welcome.

What is asked for:

1. **Open an issue saying what is wrong, or what is missing.** No implementation plan is needed;
   how to fix it is decided here. What helps is what looks wrong, how you know it (which row of
   which table in which report, which COLREG rule, which steps reproduce it), and what it should
   say instead. An approach, if you have one in mind, is welcome but not expected.
2. **The issue thread settles what to change.** Scope, overlap with work in flight, and the
   constraints that are hard to see from outside — how `derivation` has to be carried, the
   boundary that keeps vessel concepts out of `core/` — come from this side. It is usually a
   short exchange.
3. **A maintainer then implements it and writes the pull request.** Anything needing a design
   decision is written up as `plans/<slug>-<issue number>.md` first. You are welcome to follow
   the work and comment on it, and to say so if it departs from what was agreed.

**There is no small-diff exemption.** Typos and one-line corrections go through an issue too;
that is quicker than settling where "small" ends every time.

### Why outside pull requests are not accepted

This tool makes claims about what happened. A reconstruction that looks plausible and is wrong is
worse than no reconstruction — and **the mistakes in this field are wrong in a way that reads
correctly.** Using COG where the heading is meant, taking a light's relative bearing from the
wrong end and landing 180° out, flipping the sign on the antenna offset: each can be written as
straightforward code, can be written so the tests pass, and moves plausibly on screen. CI holds
the function limits and the coverage floor; it cannot tell whether a number agrees with the
appendix of a report. Only someone who has read that case can.

Diffs that look large and finished can now be produced in minutes, which widened the gap:
reviewing one cold, without having shaped the design, takes longer than writing it. This is not a
rule against AI-assisted work — this repository is itself written with an agent, and says so in
[CLAUDE.md](CLAUDE.md). The line it draws is that **what gets agreed is what is wrong, and the
code is owned by whoever lands it.**

### Writing the issue

- **Make the first three lines a summary.** Whether the issue gets picked up is decided from
  those lines. The background belongs after them.
- **Be specific.** Not "the lights look wrong", but which bearing, which light should be visible
  there, and which COLREG rule says so. For a real case, which row of which table.

### Issues and plans

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

## Two gates that will fail a pull request

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
under the thresholds in `vitest.config.ts` (currently 95% lines, 93% statements, 98%
functions, 82% branches). Raise a threshold when the real figure rises; do not lower one to
get a green run.

**Do not assume rendering or browser code is untestable — it is the mistake this project
has already made.** Three files were excluded from coverage on the stated grounds that they
needed a real browser. Two of them did not: `record.ts` needed one browser API stood in
for, `player.ts` needed one class of three.js stood in for, and both now sit at 100% of
lines in plain Node. The exclusion had quietly put 44% of `src/` outside the measurement.

three.js builds scenes, hulls, light sectors and cameras perfectly well without a GL
context; only `WebGLRenderer` needs one, and mocking it is four lines. `test/player.spec.ts`
and `test/record.spec.ts` show how, `test/scene.spec.ts` and `test/cameras.spec.ts` show the
cases that need nothing at all.

Only `main.ts` is excluded now, and for a structural reason rather than an environmental
one: `void main()` runs at import and none of its wiring functions is exported, so the
module has no seam to test through. **An exclusion is for code that cannot be measured, not
for code that has not been** — if you add one, say which it is.

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
