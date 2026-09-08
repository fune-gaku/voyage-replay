# scenarios/

Put working `.voyage.json` files here. **Everything in this directory except this file is
untracked**, and that is deliberate.

Scenarios are data, not code. They accumulate one per case, each carries its own
attribution from whichever body published the source report, and some will belong to a
client rather than to the public. None of that belongs in the history of an MIT-licensed
tool — so this directory is a staging area, and the corpus will move to a repository of
its own once there is enough of it to be worth managing.

The one scenario that _is_ tracked lives in [`../examples/`](../examples/). It is a
regression test, not a sample: `test/examples.spec.ts` pins the closest approach, the
steady bearing as the range closes, and the aspect each ship presented. Do not delete it
to tidy up.

## Using what you put here

```bash
npm run dev
# then open http://localhost:5173/?scenario=/scenarios/your-case.voyage.json
```

The dev server serves this directory and watches it, so editing a scenario reloads the
page. That loop is the point: correcting an extraction means changing a number and seeing
whether the ship still does something a ship could do.

```bash
npm run build:single -- scenarios/your-case.voyage.json
# → dist/your-case.html, self-contained, opens on its own
```

`build:single` takes any path, inside this directory or outside it.

## marks-night / marks-day

**Invented, not a case.** Two ships and two marks in Suo-nada, made only to look at what the
renderer does with the water after #36, #37 and #39: the sea's own shape, the sky it hands
back, the body's path on it and the streaks the lamps lay.

Same geometry in both, eight hours apart:

| | night | day |
|---|---|---|
| clock | 19:40 JST | 11:40 JST |
| what is up | moon 34 deg on 215, 42 per cent lit | sun 35 deg on 174 |
| sea | Hs 2 m from 240, Tp 6.8 s | the same |

A runs north at 9 kn past both marks; B crosses from the north-east at 11 kn and passes 213 m
off at 19:44:30. The starboard-hand buoy (Fl G 4s, region B so green) is 284 m to starboard at
the same moment; the north cardinal beacon (Q W, lattice) is 364 m to port two minutes later.

Build one to look at:

```
npm run build:single -- scenarios/marks-night.voyage.json
```

`vite build` empties `dist/` first, so building the second overwrites the first - copy one
aside if both are wanted at once.
