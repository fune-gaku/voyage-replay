# Domain notes

What a contributor needs to know about ships to work on this without producing something that
looks right and is not. Rule numbers refer to the COLREGs (Convention on the International
Regulations for Preventing Collisions at Sea, 1972, as amended).

## Navigation lights

### The arcs (Rule 21)

| Light | Arc | Fixed so that it shows |
|---|---|---|
| Masthead | 225° | From right ahead to 22.5° abaft the beam on either side |
| Sidelights | 112.5° each | From right ahead to 22.5° abaft the beam on its own side. Green to starboard, red to port |
| Sternlight | 135° | 67.5° from right aft on each side |
| Towing light | 135° | As the sternlight, but yellow |
| All-round | 360° | — |

225 + 135 = 360. The arcs tile the horizon exactly: from any bearing you see something, and you
never see both sidelights unless you are inside the narrow sector right ahead where the two arcs
meet. `src/actors/vessel/lights.ts` implements them as half-open ranges so the partition is exact,
and `test/lights.spec.ts` checks it every tenth of a degree.

### What the arcs are for

This is why the tool exists. A watchkeeper does not read a bearing off an instrument at night; they
see lights, and *which* lights tells them the aspect of the other vessel:

- **Green only** — you are looking at her starboard side; you are somewhere on her starboard bow or quarter.
- **Red only** — her port side.
- **Both sidelights** — end-on, or nearly so.
- **Sternlight only** — you are astern of her and overtaking.

Get the arcs right and the bridge view answers "why did nobody act" on its own. Get them backwards
and the picture is wrong by exactly 180°, which still looks entirely plausible.

### Ranges (Rule 22)

Minimum ranges at which a light must be visible, by length of vessel:

| Length | Masthead | Sidelights | Sternlight |
|---|---|---|---|
| 50 m and over | 6 NM | 3 NM | 3 NM |
| 20 m to under 50 m | 5 NM | 2 NM | 2 NM |
| 12 m to under 20 m | 3 NM | 2 NM | 2 NM |
| Under 12 m | 2 NM | 1 NM | 2 NM |

### Which lights (Rule 23 onward)

A power-driven vessel under way shows a masthead light forward, a second masthead light abaft of
and higher than the first, sidelights and a sternlight. The second masthead light is **required at
50 m and over** and optional below; the implementation omits it below 50 m, which is what the small
coasters in most collision cases actually carry.

A pushing vessel and a vessel being pushed ahead, rigidly connected, are regarded as one
power-driven vessel (Rule 24(b)) and show the same lights. Fishing vessels, vessels not under
command, vessels restricted in their ability to manoeuvre and vessels constrained by draught all
show something different, and none of them is implemented yet.

## Constant bearing, decreasing range

If the compass bearing of another vessel does not appreciably change as the range closes, you are
on a collision course (Rule 7(d)(i)). It is the single most useful thing a reconstruction can
show, and it is invisible in a table of numbers — the bearings simply sit there, all nearly the
same, looking like nothing at all.

The reference case in `examples/` is a clean instance: five consecutive minutes at 267.0°–267.1°
while the range falls from 3,400 m to 470 m.

## How a ship actually moves

A ship is not a point that changes velocity. Three things a straight line between two samples gets
wrong:

- **She does not respond immediately.** Put the rudder over and the turn builds; centre it and the
  turn decays. A first-order (Nomoto) response, `T·ṙ + r = K·δ`, captures enough of this for a
  reconstruction.
- **She carries her turn.** A merchant ship at full rudder turns in roughly 2.5 to 5 ship lengths,
  and travels 3 to 5 lengths along her original heading before the turn takes effect (advance).
- **Her bow points off her track.** In a turn, and in any current, heading and course over ground
  differ by the drift angle. Draw the hull along the course and it looks like it is on rails.

None of this is implemented yet. `sampleAt()` interpolates straight lines and labels everything it
synthesises as `interpolated`; replacing it is the next substantial piece of work.

## Screening data for transcription errors

`checkPlausibility` asks whether a ship could have done what the data says. Three checks:

1. **Implied speed against reported speed.** Distance between two positions over the interval
   should match the reported speed over ground.
2. **Absolute speed.** Above about 40 knots, no merchant ship.
3. **Rate of turn against length.** At speed *V* and a tactical radius of about 2.5 ship lengths,
   the tightest sustainable turn is roughly `V / (2.5 · L)` radians per second.

Two things about the first one:

- **The tolerance has to scale with the interval.** Reports print positions to the second of arc,
  and one second of longitude is about 26 m in mid-latitudes. Between samples 20 s apart, rounding
  alone shifts the implied speed by over a knot. The allowance therefore includes
  `quantisation / interval`, which vanishes over long intervals and dominates over short ones —
  exactly as the error does.
- **The impact itself trips every check.** A hull being struck genuinely does violate all three, so
  a cluster of findings within a few seconds is the collision, not a data problem. Findings spread
  across an otherwise quiet track are the ones worth reading.
