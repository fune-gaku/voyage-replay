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
