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

## The sea, and what it hides

`core/seaway.ts` turns whatever a report says about the sea into figures; `core/visibility.ts`
asks whether those figures put a crest between two ships. Both exist because a flat sea is not
a neutral default — it is the claim that a target was in sight continuously, which is usually
the thing a collision report is arguing about.

### Significant wave height is the mean of the highest third

Not "the wave height", and treating it as such loses the tail that does the hiding. For a
narrow-band sea the individual heights are Rayleigh distributed, `P(H > h) = exp(−2h²/Hs²)`,
which fixes the ratios:

| | ÷ Hs |
|---|---:|
| mean wave | 0.63 |
| significant (highest third) | 1.00 |
| highest tenth | 1.27 |
| highest hundredth | 1.67 |
| largest in 87 minutes | ≈ 1.89 |

The surface itself is Gaussian with a standard deviation of **Hs/4**. That is not an
approximation layered on Hs; for a linear sea it is the definition, and it is what makes the
occlusion arithmetic closed-form.

### Sea state is a class, and a wide one

WMO code 3700. State 4 spans 1.25–2.5 m — a factor of two in height, which becomes a factor of
about fifty in how much of the time a low target is hidden. So `SeaEstimate` carries both ends
and never a midpoint. State 9 is open above 14 m, and that has to survive all the way to the
cell: the pair is a floor there, not an interval, so it reads "or more" rather than a range.

Taking the ends of a class is a bracket only because more sea means more hiding, and that is
not obvious — a taller sea comes with a longer assumed period, whose longer waves cross a sight
line *less* often, so the two effects pull opposite ways. The spread wins throughout the range
that matters, and `test/visibility.spec.ts` holds it: if it stopped winning, the interior of a
class could sit outside the pair.

### The occluding waves are not at the target, and not at one point

Two mistakes with the same cause. The clearance of a sight line above the mean surface is
**quadratic about its grazing point** — `c(x) = A + (x − x*)² / 2R` — so it takes kilometres to
rise by one standard deviation: 2.1 km at Hs 1.25 m, 3.0 km at 2.5 m. Hundreds of waves stand
within a whisker of the line, and the target is hidden if any one of them is over it.

Asking only about the closest point is wrong by one to two orders of magnitude, always the same
way. Measured on an 8 m eye looking at 1.5 m of freeboard at 13 km in a 1.25 m sea:

| | hidden |
|---|---:|
| probability at the grazing point | 0.1% |
| independent crests along the line | 9% |
| spectral Monte Carlo | **48%** |

The implementation integrates the level-crossing rate along the line instead (the Rice form),
which is closed-form and needs no random numbers.

Inside `d = sqrt(2R(h − f))` the grazing point falls beyond the target and clamps back onto it:
at short range what hides a low vessel is the wave in front of *her*, and the threshold is
simply her own height. When the target is taller than the eye the line rises the whole way and
the threshold is the observer's own eye height.

### A vessel floats, and which way that cuts reverses with range

Every height is above the *mean* surface, but a ship rides the sea: dropping into a trough hides
her, rising on a crest shows her. Near the horizon the rise wins; closer in the drop does. An
8 m eye on 1.5 m freeboard in a 2 m sea — what this code returns, and what a spectral Monte
Carlo on the same geometry gives:

| range | held rigid | riding | Monte Carlo, rigid / riding |
|---:|---:|---:|---|
| 8 km | 18.3% | 35.9% | 10.5 / 30.0 |
| 11 km | 82.2% | 63.9% | 63.0 / 52.8 |
| 13 km | 100% | 93.8% | 100 / 89.6 |

Both run high, for the reason in *Known biases* below. **The reversal is in both**, which is
what matters: it is a property of the problem and not of the approximation.

Neither is the conservative side, so neither can be picked. Both are returned. Which is nearer
the truth depends on her heave response, which needs a GM no report states — issue #32.

**A riding vessel cannot be hidden by the wave she is sitting on.** Where the sea is still the
same wave as the one under her, her height above it is her height whatever the sea is doing, and
treating that stretch as independent lets the arithmetic put her in a trough and raise a crest
beneath her at the same instant. It is excluded.

**The width of that exclusion is the correlation length, not the wavelength**, and the two are
not close. `k = ω²/g` squares the spread of the spectrum, so the wavenumber content is far
broader than the frequency content and the surface decorrelates within a fraction of a wave: the
autocorrelation falls to a half at **0.116 of the peak wavelength**, the same ratio for every
period, which is 5.5 m for a 5.5 s sea against a 47 m wavelength. Excluding a whole wavelength
instead throws away nine times as much sight line as the sea's coherence justifies, and with it
real crests.

Done correctly the correction is worth about two tenths of a point. It is in because the case it
removes is impossible rather than unlikely — which is a different argument from its being large.

### Known biases, in both directions

- **Counting crossings independently runs high.** They cluster, and Rice assumes they do not.
  Measured against the Monte Carlo, both bounds carry it in the same direction and by a similar
  margin — held rigid 18.3% against 10.5% at 8 km, riding 35.9% against 30.0% — so it shifts the
  pair rather than widening or narrowing it. This is much the largest of the modelling errors
  here, and far smaller than the width of a sea state class.
- **A long-crested sea runs low.** The calculation works along one line; real seas are short
  crested, which decorrelates the surface along it and makes blocking likelier.
- **The assumed period runs long.** With no stated period, Pierson-Moskowitz for a fully
  developed sea gives the longest waves that height can belong to. Fetch-limited water — the
  Inland Sea, where the reference case happened — is steeper, so its waves cross a sight line
  more often. The assumption errs towards saying she was visible.
- **Every height is a fraction of the beam.** `actors/vessel/heights.ts`, issue #8. This is the
  largest assumption in the chain after the wave height itself.

### The one constant that had to be chosen

The second spectral moment **in wavenumber** diverges logarithmically — `k²S(ω)` falls off as
`ω⁻¹` — so the root-mean-square wavenumber, and with it the crossing rate, depends on where the
tail is cut. `TAIL_CUTOFF_FRACTION_OF_PEAK = 0.35` is that choice, named for the same reason
`REFRACTION_COEFFICIENT` is. Widening it from 0.5 Tp to 0.175 Tp, nearly a factor of three,
moves one occlusion figure from 76% to 89% — real, and an order of magnitude smaller than the
width of a sea state class.

Frequency moments converge, so they are integrated out to forty times the peak instead. Cutting
them at the same place left the zero-crossing period six per cent long, against the published
JONSWAP ratio of 0.778 — an implementation detail passing itself off as a property of the sea.

### The wind, and the one thing it settles

A wind sea runs with the wind, and both are stated as the direction they come from, so a
stated wind gives a wave direction a sea state cannot. That is why `environment.wind` exists:
it is the figure a deck log always carries, where a wave height almost never is.

**It does not settle the sea.** Swell runs from wherever its own storm was, which is the
ordinary case and is what makes a real sea confused, so a stated wave direction still wins
over anything derived from the wind. Adding a wind does not remove the assumption about
direction; it puts a step in front of it.

**Fully developed is an upper bound, not a figure.** `Hs = 0.21 U^2/g` is the sea that wind
raises once it has stopped growing, which needs both fetch and duration. A sea under a rising
wind, or in enclosed water, is smaller. There is no bound the other way — which is why the
comparison between a stated sea and a stated wind is reported **only** when the sea is the
bigger of the two. A sea smaller than its wind supports is ordinary and says nothing; a
column that flagged it would teach a reader to ignore the column.

| | wind | Hs if fully developed | Tp |
|---|---:|---:|---:|
| BF 4 | 6.7 m/s | 0.96 m | 4.9 s |
| BF 5 | 9.3 m/s | 1.85 m | 6.8 s |
| BF 6 | 12.3 m/s | 3.24 m | 9.0 s |
| BF 7 | 15.5 m/s | 5.14 m | 11.3 s |

**A Beaufort force is a class**, exactly as a sea state is: 5 is 17 to 21 knots. It is kept as
one. A stated speed drives the period; a force alone does not, because taking a period from a
force means taking a speed out of the middle of a class, which is the invention the sea state
table refuses to make about heights. Force 12 is open above, and its two ends are the same
number — anything displaying it has to test for openness before testing them for equality.

The period now runs forwards from a wind where one is stated, rather than backwards out of a
height. **The round trip disappears; the bias does not** — both routes assume a sea that has
stopped growing, so both run long in enclosed water.

**A wind cannot supply a period for a sea it could not have raised — and the sea it has to be
able to raise is the ROUGHEST the file allows.** One period is worked out and then applied to
both ends of a class, so testing the wind against the calm end passes a sea state of 1.25 to
2.5 m at fourteen knots, which raises 1.44 m, and then labels a 2.5 m sea's period "from the
stated wind". The warning that compares a stated sea against its wind asks about the calm end
instead, and that is not an inconsistency: a warning should be hard to raise, and a derivation
has to hold everywhere it is used. Two questions, two ends. A stated calm beside a
stated two-metre swell is a valid file and an ordinary situation — the swell belongs to
another weather system. Running Pierson-Moskowitz forwards from that wind hits the period
clamp and returns half a second: a two-metre sea 0.4 m from crest to crest, drawn under a
panel reading "from the stated wind". So the wind supplies a period only where it passes the
same comparison the disagreement note reports, and the height route takes over otherwise.

**Sea state 9 has no ceiling, so no finite wind can supply its period.** The table's 14 m is a
sentinel and not a bound, and a derivation that has to hold across a class cannot hold across
an unbounded one. That is the third time an open end has been read as a bound in this
repository — the panel's own sea state 9, Beaufort force 12 in the wind's display, and this —
so anything with a class in it should be asked, once, whether its top is a number or a floor.

**A sea of no height has no period, and saying so takes three layers.** Sea state 0 is a flat
calm. Beside a calm wind it cleared "could this wind raise it" on nought against nought, took
the relation's own zero, and had it clamped straight back to the spectrum's floor — so the page
read "0.5 s (from the stated wind)" over water with no waves in it. Fixing the relation moved
the lie one step down; fixing the guard moved it into the clamp. It stops where a
`SeaEstimate` can say the period came from *nowhere*, and the page prints that instead of a
figure. The `Seaway` still carries numbers for period and direction, because its fields are
numbers — which is precisely why nothing may print them without asking first.

**A flat sea with a stated period is not a contradiction.** A decayed swell arriving from a
storm long gone has a period and a direction and a significant height that rounds to nothing,
and the format takes all three. The rule that a sea of no height has no period is about what
can be *derived*; it must not swallow what the file *states*. Nor may the absence of one figure
hide another — a stated bearing survives a missing period.

**Two Beaufort classes have an end that is not a number.** Force 12 is 64 knots and up, so its
top is a floor. Force 0 is "less than 1 knot" and not "nought to one" — a knot is already
force 1 — so its top is a limit the class stops short of. Both have been read as plain numbers
here at some point, which is why `forceClass` is the only thing that knows: scattering two
special cases is how the second one gets missed.

**A file may state both a speed and a force, and they may not be the same wind.** The speed is
used, being the narrower statement, but eighteen knots beside force 9 means one of them is
wrong and the page says so rather than choosing in silence. Which is right is not something
this tool can settle — but the sea drawn from one is not the sea drawn from the other.

## Sea marks

### A beacon is not a kind of buoy

They are drawn side by side and read as variants of one another, and almost nothing they
carry means the same thing.

| | buoy | beacon |
|---|---|---|
| what it is | a float on a chain | a structure on a foundation |
| the stated position | her **sinker's** | its own |
| how far it may be from it | the watch circle | nowhere |
| body shape | IALA, and it means something | engineering, and it means nothing |
| `heightMetres` measured from | the water | the water |
| in a sea | heaves and tilts with it | the sea runs past it |

**A shape is a statement in the buoyage** — a can is port hand, a cone starboard, a sphere
safe water — so a beacon has none to give, and a format that accepted one and then drew a
structure would have told whoever wrote it that it was understood. The schema refuses it.

### The height is above the water, for both, and that is not the obvious choice

A light list gives a beacon two heights: the light above mean sea level, and the structure
above its own base. The second is the natural reading of "how tall is it" and **cannot be
used here at all** — placing a top from it needs the depth of the ground under the
foundation, and nothing in this format states that. A renderer given 8 m from a foundation
and no sounding either invents the depth or ignores the datum.

So `heightMetres` is **above the water for both kinds**, which is the figure the picture needs
and the figure a sightline asks about. The consequence is that a beacon is drawn **taller than
its stated height**: the footing below the surface is proportional to the structure, is not a
sounding, and is not counted into what the mark reports back. The panel says so, because a
part of the picture that nobody stated has to be owned somewhere.

This was got wrong first time round. The schema and the panel said "above its foundation"
while `render/mark.ts` put the top at `heightMetres` above the **water** — a 6 m beacon
standing 8.1 m from its plinth with the page calling it 6 m. The page and the picture
disagreeing about the same mark, which is the failure this repository keeps returning to.

### A buoy is not at her charted position

The position a report gives is her sinker's. She lies somewhere on a circle about it of radius
`sqrt(scope^2 - depth^2)`, where scope is the chain as a multiple of the depth, and in a
stream on its downstream edge. At 20 m on three times scope that is **57 m** — against ships
of 49 m and 121 m in this project's reference case, a ship's length of slack, and "which side
of the mark did she pass" is regularly the question a report is answering.

**The renderer still draws her at the stated position**, because where in the circle she was is
not known and moving her would invent a placement — the same judgement
`plans/done/antenna-offset-6.md` reached about a hull and its antenna. The panel gives the
radius instead.

Three answers, not two: a beacon has **no** circle, a buoy with no stated mooring has one
whose size **nobody wrote down**, and a buoy with a mooring has a figure. A blank shared by
the first two would put a fact about the world and a gap in the file on the same footing.
