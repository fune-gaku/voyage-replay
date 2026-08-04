# The `.voyage.json` format

The normative contract is [`spec/voyage.schema.json`](../spec/voyage.schema.json). This page
explains the parts whose reasons are not obvious from the schema.

**Format version 0.1 is unstable.** It will change without a migration path until it reaches 1.0.

## Shape

```
scenario
├── formatVersion
├── meta            title, when, where, source, licence
├── origin          geodetic origin of the local plane
├── environment     light condition, visibility, current
└── actors[]
    ├── id, kind, name
    ├── vessel      dimensions, type, reference-point offsets
    └── track
        ├── derivation, positionAt, source, note
        └── points[]  t, lat, lon, cog, heading, sog, derivation
```

## `origin` — why there is a local plane

Everything downstream works in metres east and north of `origin`. A scenario spans a few
kilometres at most, so projecting once onto a flat plane and forgetting the curvature of the earth
costs centimetres — orders of magnitude below the precision of the source, which is typically a
tenth of a second of arc, about 3 m.

Put the origin near the action. It is not a datum; it is a convenience.

## `derivation` — the claim the reconstruction rests on

Every track carries one, and any point may override it:

| value | meaning |
|---|---|
| `measured` | From a recording — AIS, VDR, a data logger |
| `digitised` | Read off a plotted chart in a report, by clicking points on the figure |
| `inferred` | Reconstructed from narrative or testimony: "he saw her about 20 degrees on the starboard bow" |
| `interpolated` | Synthesised by this tool between other points |

This is required rather than optional because it is the difference between a reconstruction and an
animation. A renderer is expected to draw the last two differently from the first — the Japan
Transport Safety Board does exactly this in its own track charts, drawing a measured track solid
and an inferred one dashed, so this is a convention to follow rather than one to invent.

## `cogDegreesTrue` and `headingDegreesTrue` are separate, and heading is often missing

Course over ground is where the ship is going. Heading is where the bow points. The angle between
them is the drift angle, and in a tideway it is large enough to see.

Heading is what fixes the light arcs and how the hull is drawn, and it is the one more often
absent: a Class B AIS transponder does not transmit heading at all, so in a two-ship reconstruction
it is normal for one vessel to have course throughout and heading nowhere.

**Leave it absent.** Substituting the course produces a hull that never crabs and light arcs that
are quietly wrong. If a consumer wants to stand the course in for the heading, that is its decision
to make and to show.

## `positionAt` and `referencePointOffsets`

A reported position is where the antenna is, not where the ship is. AIS message 5 carries four
distances — antenna to bow, to stern, to port side, to starboard side — and investigation reports
restate them in a footnote to the track table.

Two consequences:

1. **Length and beam fall out of the offsets.** Bow + stern is length overall, port + starboard is
   beam. This is often better than the particulars table in the report, whose length may be a
   *registered* length, which is shorter than length overall.
2. **Range between two tracks is antenna to antenna.** On a large ship the antenna can sit over
   100 m from the bow, so a closest approach of 40 m between antennae is contact between hulls.

## `t` is a full timestamp

Verbose on purpose. A reconstruction is checked by a human against a report that prints wall-clock
times, and seconds-from-an-epoch makes that check harder for no benefit at this scale.

Use an offset (`+09:00`), not `Z` and not a bare local time. `meta.timeZone` names the zone the
report's own clock refers to.

## `actors[].kind`

Only `vessel` exists. The discriminator is there so another kind of actor can be added later
without breaking files that already exist — not because anything else is planned for now.

## Validating

```ts
import { validateScenario, parseScenario } from "voyage-replay";

validateScenario(json);  // → { valid, errors[] }
parseScenario(json);     // → Scenario, or throws
```

Schema validation checks shape only. Whether a ship could physically have done what the data says
is a separate pass — see `checkPlausibility` and [domain-notes.md](domain-notes.md).
