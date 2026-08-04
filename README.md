# voyage-replay

**Replay and reconstruct marine incidents in 3D — from overhead, from your own bridge, or from the other ship's.**

Give it a timestamped track for each vessel and it rebuilds the encounter: hulls at true scale,
navigation lights showing over their real arcs, and a camera you can put anywhere, including on
somebody's bridge.

> **Status: early.** The format, the geometry and the checks are in and tested. The 3D renderer
> is not written yet — `npm run dev` currently loads a scenario, validates it, and reports what each
> ship showed the other. See [Roadmap](#roadmap).

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

Requires Node 20 or later. Nothing else — npm ships with it.

```bash
npm install
npm run dev            # dev page: load a scenario, validate it, read off the aspects
npm test               # unit tests plus the reference case
npm run check:config   # asserts the linter and compiler are configured to see what we think
npm run lint && npm run typecheck && npm run build
```

`npm run dev` loads [`examples/suo-nada-2025-11-27.voyage.json`](examples/suo-nada-2025-11-27.voyage.json)
by default; pass another with `?scenario=/your-file.voyage.json`.

`check:config` exists because a rule that is not enabled reports nothing — see
[`docs/verifying-config.md`](docs/verifying-config.md).

## Use as a library

```ts
import {
  parseScenario, prepareActor, closestPointOfApproach,
  visibleLights, describeAspect, checkPlausibility,
} from "voyage-replay";

const scenario = parseScenario(JSON.parse(await readFile("case.voyage.json", "utf8")));
const [a, b] = scenario.actors.map((actor) => prepareActor(actor, scenario.origin));

closestPointOfApproach(a, b);                 // → { epochSeconds, metres }
checkPlausibility(a, scenario.actors[0].vessel); // → findings, empty if the data is sane
describeAspect(visibleLights(vessel, 45));    // → "starboard side visible"
```

## Roadmap

| | |
|---|---|
| **Done** | Format and schema, local-plane geodesy, track sampling, closest approach, COLREG Rule 21/22/23 light arcs, physical screening, one real reference case |
| **Next** | Ship motion model (first-order response, so a hull carries its turn instead of sliding sideways); 3D renderer with the three cameras; timeline with variable time compression |
| **After** | JTSB appendix-table extractor; digitiser for tracks that exist only as a plotted chart; radar/ARPA view; video capture |

Roughly a third of recent JTSB collision reports carry enough data to reconstruct — and among
reports of nine pages or more it is over 90%. [`docs/jtsb-extraction.md`](docs/jtsb-extraction.md)
has the measured numbers.

## Data and attribution

The example ships with this repository is derived from a public Japan Transport Safety Board
investigation report, cited in the file itself. Reports are public; check the terms of the issuing
body before redistributing derived data, and keep the citation attached — it is what makes a
reconstruction checkable.

No source PDFs are vendored here.

## Contributing

Please read [CONTRIBUTING.md](CONTRIBUTING.md) first — open an issue with a plan before writing code.

## License

MIT. See [LICENSE](LICENSE).
