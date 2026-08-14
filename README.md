# voyage-replay

**Replay and reconstruct marine incidents in 3D — from overhead, from your own bridge, or from the other ship's.**

![From the tanker's bridge in the seven minutes before a collision: two masthead lights and a green
sidelight approach on a bearing that barely moves, growing into a hull that fills the
window.](docs/images/bridge-approach.gif)

*The reference case, from the bridge of the tanker, 18:06 to contact at 18:13:30. She reports her
heading, so the camera looks where her bow pointed. The pushing unit reports none — her simplified
AIS does not transmit it — so she is drawn along her course over ground, and the arcs her lights
show over follow from that rather than from a stated heading. On those terms she shows a white
light and a green one, which is what the report's own analysis records the officer of the watch
seeing, on a bearing that barely moves while the range falls. The swing at the end is the tanker's
own heading coming round, 272° to 300° in the last two minutes.*

Give it a timestamped track for each vessel and it rebuilds the encounter: hulls at true scale,
navigation lights showing over their real arcs, and a camera you can put anywhere, including on
somebody's bridge.

> **Status: early.** A scenario renders and plays back, from overhead or from either bridge, and
> records to video. What is not in yet is a ship motion model — between samples a hull still
> travels in a straight line.

## Why

Accident reports already contain the answer. This one, from a collision in the Suo-nada in
November 2025, prints an appendix table for each ship — time, position, course, heading, speed:

```
16:50:25   33-53-12.4   131-57-15.0    280.7    278    9.1
17:10:05   33-53-40.3   131-53-44.0    279.4    277    8.6
...
```

Anyone can read those columns. Almost nobody can *see* what they say. Rendered, the same numbers
show a green sidelight sitting on a bearing that does not change — 267.0°, 267.1°, 267.0°, 267.1° —
while the range falls from 3,400 m to 470 m over five minutes. That is a steady bearing with a
decreasing range, the classic signature of a collision course, and the report's own analysis
confirms the officer of the watch "saw a white light and a green light".

The numbers were always in the report. This is what they look like.

Roughly a third of recent JTSB collision reports carry enough data to reconstruct — and among
reports of nine pages or more it is over 90%. [`docs/jtsb-extraction.md`](docs/jtsb-extraction.md)
has the measured numbers.

### Why not AI video

A reconstruction has to be able to claim that the geometry is true. Generated video does not hold
relative positions between frames, so it cannot make that claim — the problem is not fidelity, it
is that nothing constrains frame *n+1* to agree with frame *n*. A scene driven by the data is
constrained by construction.

### Why not a simulator

A simulator predicts what *would* happen from a physical model. This replays what *did* happen
from a record, and is honest about the difference: every point carries where it came from —
measured, digitised off a plotted chart, inferred from testimony, or interpolated by this tool.
A renderer can and should draw the inferred parts differently.

## The format

One JSON file describes a scenario. The contract is [`spec/voyage.schema.json`](spec/voyage.schema.json);
[`docs/format.md`](docs/format.md) explains the parts that need explaining.

```json
{
  "formatVersion": "0.1",
  "meta": { "title": "…", "occurredAt": "2025-11-27T18:13:30+09:00", "timeZone": "Asia/Tokyo" },
  "origin": { "lat": 33.905, "lon": 131.7116667 },
  "environment": { "lightCondition": "night" },
  "actors": [
    {
      "id": "A",
      "kind": "vessel",
      "vessel": {
        "loaMetres": 49,
        "beamMetres": 9.4,
        "type": "tanker",
        "referencePointOffsets": {
          "fromBowMetres": 39, "fromSternMetres": 10,
          "fromPortMetres": 4, "fromStarboardMetres": 5
        }
      },
      "track": {
        "derivation": "measured",
        "positionAt": "gps-antenna",
        "points": [
          {
            "t": "2025-11-27T16:50:25+09:00",
            "lat": 33.8867778, "lon": 131.9541667,
            "cogDegreesTrue": 280.7, "headingDegreesTrue": 278, "sogKnots": 9.1
          }
        ]
      }
    }
  ]
}
```

Three things in there are load-bearing, and each exists because leaving it out produces a
reconstruction that looks fine and is wrong:

- **`derivation`** — what this figure rests on. It is required, not optional.
- **`headingDegreesTrue` separate from `cogDegreesTrue`** — where the bow points is not where the
  ship is going, and it is the heading that fixes the light arcs. It is frequently absent, because
  a Class B AIS transponder does not transmit it. This library leaves it absent rather than
  substituting the course.
- **`referencePointOffsets`** — a reported position is the GPS antenna, not the hull. On a 180 m
  ship the antenna can sit over 100 m from the bow, which is the difference between a near miss
  and contact.

## Install and run

Requires Node 20.19 or later, or 22.12 or later — the floor Vite sets, declared in
`package.json` so npm says so rather than the build failing obscurely. Nothing else; npm ships
with Node.

```bash
npm install
npm run dev            # dev server, then open http://localhost:5173/
npm test               # unit tests plus the reference case
npm run check:config   # asserts the linter and compiler are configured to see what we think
npm run lint && npm run typecheck && npm run build
```

`npm run dev` loads [`examples/suo-nada-2025-11-27.voyage.json`](examples/suo-nada-2025-11-27.voyage.json)
by default; pass another with `?scenario=/your-file.voyage.json`.

### Where scenarios live

Put your own in [`scenarios/`](scenarios/), which is untracked. The dev server serves and
watches it, so editing a scenario reloads the page — the loop that matters when you are
correcting an extraction:

```
http://localhost:5173/?scenario=/scenarios/your-case.voyage.json
```

They are kept out of the repository on purpose. Scenarios are data, not code: one per case,
each carrying its own attribution from whichever body published the source report, and some
belonging to a client rather than to the public. None of that belongs in the history of an
MIT-licensed tool, and the corpus will move to a repository of its own once it is large
enough to be worth managing.

The scenario under `examples/` is the exception, and it is a regression test rather than a
sample — `test/examples.spec.ts` pins the closest approach, the steady bearing as the range
closes, and the aspect each ship presented.

### One file you can just open

You do not have to keep a dev server running to look at a reconstruction:

```bash
npm run build:single -- examples/suo-nada-2025-11-27.voyage.json
# → dist/suo-nada-2025-11-27.html   (about 720 kB, self-contained)
```

Everything — the player, the styles, the scenario — is inside that one file. Double-click it,
attach it to an email, drop it into an article, or archive it beside the video it produced.
There is nothing left to fetch, so it will still open years from now, which is the property
worth having: a reconstruction whose viewer has rotted is not evidence of anything.

The cost is that three.js travels inside every file. That is accepted; a CDN reference would
be smaller and would trade away the only thing that makes the file worth keeping.

`check:config` exists because a rule that is not enabled reports nothing — see
[`docs/verifying-config.md`](docs/verifying-config.md).

## What you cannot do yet

**There is no CLI**, and the package **is not importable as a library**. `package.json`
declares no `bin`, `main`, `exports` or `types`, so `npx voyage-replay …` and
`import … from "voyage-replay"` both fail today. Working from a clone is the only route.

The pieces those would be built on exist and are tested — `src/index.ts` re-exports
`parseScenario`, `prepareActor`, `closestPointOfApproach`, `visibleLights`, `describeAspect`
and `checkPlausibility` — but nothing is wired up for consumption outside this repository yet.

## Data and attribution

The example that ships with this repository is derived from a public Japan Transport Safety Board
investigation report, cited in the file itself. The JTSB publishes under
[PDL1.0](https://jtsb.mlit.go.jp/cyo.html) (Public Data License 1.0), which permits reuse on three
conditions, all of which apply to anything you build from a report:

- **Cite the source** — report number, URL and page, so a reader can check the figures against the
  original.
- **Say that you edited it.** Transcribing an appendix table into a scenario, and interpolating
  between its rows, is processing. The example's `meta.license` records who did it.
- **Do not present the result as the issuing body's own.** A 3D reconstruction carries further than
  a table of numbers, and PDL1.0 explicitly forbids publishing processed information in a manner
  suggesting the government produced it. Neither this tool nor anything it renders is a JTSB
  product.

The report is an inquiry into cause, not into blame — the JTSB says so at the front of every one —
and a reconstruction should be read the same way.

Other issuing bodies publish under other terms. Check before adding an example from a new source,
and record what you found in that file's `meta.license`.

No source PDFs are vendored here.

## Contributing

An issue is the only way in. Bug reports, feature proposals and corrections to the domain
reasoning are all welcome; pull requests from outside the development team are not accepted, and
the reasoning is in [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT. See [LICENSE](LICENSE).
