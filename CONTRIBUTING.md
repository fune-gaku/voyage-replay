# Contributing

Thanks for looking. This is a small project with one maintainer, so a little coordination saves
everyone time.

## Before writing code

**Open an issue with a plan for anything beyond a small fix.** A few paragraphs: what is wrong or
missing, the approach you have in mind, which files you expect to touch, and anything you are
unsure about. The files under [`plans/`](plans/) show the level of detail the project works at.

Typo fixes, obviously-correct one-liners and test additions can go straight to a pull request.

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
