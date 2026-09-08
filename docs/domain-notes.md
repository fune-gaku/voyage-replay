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
| 8 km | 25.2% | 40.5% | 10.5 / 30.0 |
| 11 km | 91.7% | 68.3% | 63.0 / 52.8 |
| 13 km | 100% | 95.4% | 100 / 89.6 |

**The first two columns were re-measured after the band was widened (#36); the third was
not.** Those Monte Carlo figures were taken at the old cut of 0.35 Tp and are left as they
were rather than moved to numbers from a different experiment. Anyone re-taking them should
know two things that cost an afternoon here:

- **The lowest clearance is at the far END of the line** whenever the grazing point clamps
  onto the target, which is every range inside `sqrt(2R(h − f))`. A walk that stops one step
  short of her misses the wave that actually hides her, and reports nought per cent.
- **Random phases are not enough.** A sum of fixed-amplitude sinusoids has the right variance
  and a tail far thinner than Gaussian — its maximum is bounded by the sum of the amplitudes —
  so at three standard deviations it under-counts extremes by orders of magnitude. The
  component energies have to be randomised too (Rayleigh amplitudes) before the surface is the
  Gaussian one the level-crossing arithmetic assumes.

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
tail is cut. `TAIL_CUTOFF_FRACTION_OF_PEAK = 0.12` is that choice, named for the same reason
`REFRACTION_COEFFICIENT` is. Widening it from 0.5 Tp to 0.175 Tp, nearly a factor of three,
moves one occlusion figure from 76% to 89% — real, and an order of magnitude smaller than the
width of a sea state class.

**Where it is cut, and why not further.** The slope lives in the short waves, and the drawn
band's rms slope depends only on the cut — not on the sea's height, since the wavelengths grow
with it. Measured over this spectrum at Hs 3 m:

Taken at the period `assumedPeakPeriodSeconds` gives a 3 m sea — 8.65 s — because the same
integral at any other period describes a sea this tool never draws:

| cut | shortest wave | rms slope | k_rms |
|---|---|---|---|
| 0.35 (was) | 14.3 m | 4.1° | ×1.00 |
| 0.175 | 3.6 m | 5.4° | ×1.30 |
| **0.12** | **1.7 m** | **6.0°** | **×1.44** |
| 0.05 | 0.29 m | 7.1° | ×1.72 |
| 0.03 | 0.11 m | 7.7° | ×1.87 |

**Cox and Munk's measured slope for the wind that raises a 3 m sea is 14.2°** — `mss = 0.003 +
0.00512 U` — and the table says plainly that widening this band cannot reach it: eleven
centimetre waves get to eight degrees. The rest of a real sea's slope is in capillary–gravity
ripples, which a JONSWAP gravity spectrum has no business describing and no renderer can draw.

**The drawn slope is lower again than the band's** — 5.4° against 6.0° — because the components
are equal-energy bins: each carries its bin's height variance exactly and its slope variance
only approximately, one frequency standing for a range over which `k²` varies by a factor of a
few. More components narrow that gap; nothing closes it.

**And equal-energy binning puts almost nothing in the widened part.** Counted on a 3 m sea:
38 of the 40 components fall between 23 m and 174 m of wavelength, one falls at 1.9 m, and one
comes out with no amplitude at all. The short one carries 0.07 per cent of the height and
**half of the slope**; the dead one is the lowest bin, which runs from a sixth of the peak
frequency — four kilometres of wavelength — where a JONSWAP spectrum holds nothing, sampled
somewhere inside itself.

That the slope survives on one sample is not luck: the slope density `k²S(ω)` falls as `ω⁻¹`,
so every octave of the tail contributes about the same, and where in the bin the sample lands
hardly matters. What does not survive is the TEXTURE — one sinusoid at one wavelength and one
bearing is a regular ripple, not a chop. The page prints the wavelengths that carry the sea
rather than the bins' own edges, because a component of no amplitude is not a wave the picture
has. Binning that gives the tail more than one component is issue #50.

So the band is cut where waves stop being drawable rather than where the slope comes right, and
**what is missing is named on the page rather than quietly integrated for**. A glitter path
(#37) measures the full slope including those ripples, so its width has to come from the
measured relation and not from the drawn surface — which is a different statement from letting
the drawn band and the analysed one drift apart, and has to be made deliberately.

The shading's own limit is a pixel of the **drawing buffer**, not of the CSS box: a retina
screen puts two device pixels in each layout one, and taking the layout height would drop
every component at half the range it should — making the sea's drawn steepness a property of
the reader's display, with nothing on screen to say so.

**The picture then draws that band twice, and only one of the two can float anything.** The
geometry carries a component while the mesh has vertices for it — the disc's rings grow 8.73
per cent of their radius, so eight samples to a wavelength runs out at 12 m of wave near the
eye and at 170 m of wave by 250 m out — while the shading carries one while it covers more
than a few pixels. Neither fade can be dropped: aliasing in the normals is a sparkle, and
aliasing in the geometry is a slow false swell that moves the horizon and the hulls standing
on it. But the two disagree by construction, and what floats has to be given the geometry:

| From the eye | Height variance the mesh carries | Slope variance | rms slope |
|---:|---:|---:|---:|
| 20 m | 99.9% | 51% | 3.8° |
| 100 m | 91% | 29% | 2.9° |
| 250 m | 42% | 8% | 1.5° |
| 600 m | 3% | 0.5% | 0.4° |

**Nearly all of the height and half of the slope**, and that split is the spectrum's own: the
components are equal-energy, so each carries the same height variance and the short ones carry
almost all of the slope. So a buoy alongside heaves to essentially the whole sea and leans to
about two thirds of its steepness, and one at 250 m — where the range fade has not yet begun —
rides less than half of it. `render/scene.ts` gives her that sea, and the rule is mirrored in
`render/waves.ts` because nothing in Node can compile a shader to ask it. Handing her the
undrawn spectrum instead is #34's hovering buoy arriving by a second route.

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

### The rhythm is the mark

A light on a sea mark is not decoration and not a colour: **its rhythm is what identifies
it**. Under IALA the four cardinal marks are told apart by nothing else, and the quadrant a
ship must pass on is carried in the count of the flashes.

| mark | rhythm |
|---|---|
| North cardinal | VQ, or Q |
| East cardinal | VQ(3) 5s, or Q(3) 10s |
| South cardinal | VQ(6)+LFl 10s, or Q(6)+LFl 15s |
| West cardinal | VQ(9) 10s, or Q(9) 15s |
| Isolated danger | Fl(2) 5s or 10s, white |
| Safe water | LFl 10s, Iso, Oc, or Mo(A), white |
| Special | Fl Y, Fl(4/5/6) Y, Oc Y, Mo Y — never A or U |
| Preferred channel | Fl(2+1), red or green |
| Emergency wreck | OcAl BuY 3s |

Source for that table and everything below: **IALA Recommendation E-110, "Rhythmic Characters
of Lights on Aids to Navigation", Edition 4.0, December 2016**, Table 3.

### The abbreviation does not fix the sequence

`Fl 4s` says one flash in every four seconds. **It does not say how long the flash is.** E-110
gives bounds and worked examples, not a function: a flash under two seconds (that is the
definition of a *long* flash), darkness at least three times the flash, the eclipse between
groups at least three times the eclipse within one. The actual split comes from the Light List
entry for that particular light.

So a sequence worked out from an abbreviation is **`inferred`, never `measured`**, and
anything drawing or printing one has to say so. Where a scenario states the durations they are
used instead, and the page says which it had.

The rates are the part that *is* fixed, and they are what make a class that class:

| class | rate | E-110's specified rate |
|---|---|---|
| Flashing (Fl) | under 50 a minute | — |
| Quick (Q) | 50 to 79 a minute | 60 |
| Very quick (VQ) | 80 to 159 a minute | 120 |
| Ultra quick (UQ) | 160 to 300 a minute | 240 |

**Take the rate band, not the period bounds printed beside it.** The very quick row of Table 2
reads "0.5 s ≤ p ≤ 1.6 s" in the published PDF, and 80 flashes a minute is 0.75 s. The band is
stated twice and unambiguously; that column is not, and a PDF's layout is not a source.

Building the sequence from the specified rate reproduces **every worked example in Table 2
exactly** — Q(3) with 7.5 s of darkness, Q(9) with 6.5 s, Q(6)+LFl with 7 s, VQ(3) with 3.75 s,
VQ(9) with 5.75 s, VQ(6)+LFl with 5 s, Fl(2+1) 16s as 1/1/3/9. That agreement is the check that
the rule has a source rather than a preference, and `test/light-character.spec.ts` holds it.

**Table 3's per-mark remarks are a separate question.** Some of them tighten the timings for
one kind of mark — an isolated danger's flash plus the eclipse within its group is to be 1 to
1.5 s in a 5 s period — and applying one means knowing what the mark *means*, which the format
cannot state yet (#42). What this tool generates conforms to Table 2, which binds every
character whatever is carrying it.

### Where the sequence can go wrong quietly

- **Level the eclipse between groups** and Fl(2+1) shows as Fl(3): a preferred-channel mark
  reads as an ordinary lateral one. The separation is three to one, and it is what makes a
  group a group.
- **Fall back to something plainer when a character cannot be read** and an isolated danger
  (Fl(2)) becomes a special mark (Fl). Nothing is drawn for a character that did not parse.
- **Read silence as darkness** and every unlit-in-the-file mark becomes an unlit mark. A buoy
  and a lighted buoy are different marks; a report that does not mention the light is the
  ordinary case, not a statement that there was none.
- **Flash in the plan view** and a chart starts claiming a moment. A light is drawn from a
  bridge at night and nowhere else — the judgement `setDiagramView` already makes about
  lighting and the map.

### Where a scenario states the timings itself

A source that gives the actual on/off durations beats anything worked out from the
abbreviation — and then the two can disagree, which is the same failure from the other side.
`Fl(2) R 10s` with one ten-second green phase is a red group-flashing light on the page and a
steady green one in the picture.

What has to agree, and what does not:

| checked | not checked |
|---|---|
| how long the sequence runs | how long each ordinary phase lasts |
| the order of the phases, and which are lit | |
| the colours, **both ways round** | |
| the light-to-dark ratio, which *is* the class | |
| a long flash of two seconds or more | |
| the separating phase, three times the ones inside a group | |
| the rate inside a group, for the quick classes | |
| a dash of three times a dot | |

The last four are per-phase, so the generated sequence carries **what each phase is for** — a
flash, a long flash, a dot, a dash, the phase that separates the groups. Working those out
again in the checker would be a second copy of the generation rules, and the two would drift.

Three of these are less obvious than they look. `Fl(2+1)` with evenly spaced flashes is
`Fl(3)`: a preferred-channel mark drawn as an ordinary lateral one. Half a second of red, nine
of darkness and half a second of red has two appearances and joins its two ends into one flash
as it repeats. And dot-then-dash is A while dash-then-dot is N — a safe-water mark shows
Mo(A).

### One fact, said three ways

A mark says what it is three times over. A north cardinal says "north" in black above yellow,
in two cones point-up, and in a light showing VQ or Q. An isolated danger says its own thing
in black and red bands, in two spheres, and in Fl(2).

**That redundancy is the design.** The pattern is for daylight, the topmark for when the
colours are hard to read, the rhythm for the dark — so that losing one still leaves the mark
identifiable. Which is why the format carries the *meaning* and generates the three: three
independent fields would let a scenario state black-and-yellow bands with two spheres and
Fl(2), a chimera nobody could identify, drawn without complaint.

From **IALA Recommendation R1001, "The IALA Maritime Buoyage System", Edition 2.0**, Tables 1
to 11:

| mark | colours | topmark | rhythm |
|---|---|---|---|
| Port hand (Region A) | red | red can | any but (2+1) |
| Starboard hand (Region A) | green | green cone, point up | any but (2+1) |
| Port hand (Region B) | **green** | green can | any but (2+1) |
| Starboard hand (Region B) | **red** | red cone, point up | any but (2+1) |
| Preferred channel | own colour with a broad band of the other | own colour, own shape | Fl(2+1) |
| North cardinal | black over yellow | 2 black cones, points up | VQ or Q |
| East cardinal | black, one broad yellow band | 2 black cones, base to base | VQ(3) 5s or Q(3) 10s |
| South cardinal | yellow over black | 2 black cones, points down | VQ(6)+LFl 10s or Q(6)+LFl 15s |
| West cardinal | yellow, one broad black band | 2 black cones, point to point | VQ(9) 10s or Q(9) 15s |
| Isolated danger | black, one or more broad red bands | 2 black spheres | Fl(2) |
| Safe water | red and white **vertical stripes** | one red sphere | Iso, Oc, LFl 10s or Mo(A) |
| Special | yellow | yellow X | any not reserved above |
| Emergency wreck | blue and yellow vertical stripes | yellow cross | blue 1 s, yellow 1 s, 0.5 s eclipse |

### Japan is Region B, and that reverses the lateral colours

R1001 2.1.1: Region A uses "red and green colours ... to denote the port and starboard sides
of channels, respectively. However, in Region B ... these colours are reversed with red to
starboard and green to port." Region B is the Americas, Japan, Korea and the Philippines.

**The region cannot be worked out from a position.** The boundary is a map, not a formula. A
tool that assumed Region A would paint every Japanese channel mark the wrong colour and put a
ship on the wrong side of the fairway — plausibly, and silently. So it is stated on the
scenario, and a lateral mark with no region stated gets no colours generated at all. The
cardinal, isolated danger, safe water and special marks are the same the world over.

### Where the three come apart if you are not careful

- **A colour is not enough to hold them.** Every cardinal mark is banded, safe water is
  striped, isolated danger is banded — a single-colour field leaves out most of the system.
  The pattern is carried as a kind and an ordered list, and the order is the message: black
  over yellow is north, yellow over black is south.
- **Four states, one field, three of them drawing nothing.** A topmark can be one that is
  drawn, one the file says was not there, one the file says WAS there whose shape cannot be
  worked out (no purpose stated, or a lateral mark with no region), and nothing known. The
  last three all draw the same picture. **"The picture is the same" does not mean "the report
  is the same."**
- **A stated absence is not a silence.** `topmark: false` and a file that says nothing draw
  the same picture — no topmark — and must not print the same words: the first is a fact the
  source gave, the second is the limit of the source. Collapsing them loses the only thing
  the source said. The same shape as the watch circle's three answers (#40), on a boolean.
- **"Topmark (if any)" is how R1001 heads that column, in every table.** The purpose says
  what a topmark would *be*; it does not say whether the mark had one — an authority may leave
  them off where weather or ice make them impractical. So a file can state that there was none,
  and where nothing states it, drawing one is this tool's decision rather than the buoyage's.
- **The origin of a drawn value has four states, not three.** Stated; fixed by the buoyage;
  *picked from the several the buoyage allows*; chosen with nothing to go on. A cardinal
  mark's colours are black over yellow and nothing else, but its body may be a pillar or a
  spar and R1001 does not choose — reporting the pillar as "from its purpose" would put this
  tool's pick behind IALA's authority, which is the same overclaim as calling an invented
  colour a stated one, one step further in.
- **Several rhythms are allowed for most marks, and choosing one is unavoidable.** A north
  cardinal may be VQ or Q; a safe-water mark may be isophase, occulting, a long flash every
  ten seconds or Morse A. The one taken is the one the source pins completely — only LFl comes
  with its period attached — and the page says it was chosen.
- **A lateral mark and a special mark have no rhythm of their own**, by design: "any character
  other than those reserved". Generating one would put a light on the water that identifies
  nothing while looking as though it identified something.
- **How a beacon is built means nothing.** A lattice tower and a concrete column can both be a
  north cardinal, so construction is a field of its own, independent of the meaning. The
  buoy's counterpart is the IALA body shape, and *that* one is partly meaning — a can is port
  hand where a cone is starboard — which is why the two live on different kinds (#40).

### A buoy answers the sea; she does not trace it

The renderer used to take the water's height for a buoy's waterline and the water's slope for
her deck. That is the small-body limit, and half of it is defensible.

**Heave.** A float is a spring and a mass: the spring is the water it displaces when it dips,
the mass is the water it displaced already. So `ω² = ρgA / ρAd = g/d` — **the waterplane area
cancels** — and

```
T = 2π √(d / g)
```

comes out of the draught and nothing else.

| | draught | T |
|---|---:|---:|
| pillar, 3.2 m body | 1.6 m | 2.5 s |
| spar | 3.5 m | 3.8 s |
| can | 1.4 m | 2.4 s |
| large light buoy | 4.8 m | 4.4 s |

Against an 8.6 s swell the period ratio is 0.3 and the response is within a tenth of one —
**she really does follow the surface, which is why tracing it looked right**. Against a three
second chop the same buoy is near her own period and moves half again as far as the water.

**This is computable for a buoy where a ship's roll is not.** A ship's roll needs her
metacentric height, which no report carries, and that is why `plans/ship-motion-model.md` is
still a plan. A buoy's heave needs her draught, which is her geometry. Borrowing the ship's
argument here would be borrowing a reason that does not apply.

**Tilt.** A spar buoy exists to stay upright — ballast low, little waterplane — and drawing her
leaning to every slope draws away the one thing the shape was chosen for. How far each shape
leans is carried as a class rather than a calculation: the pitch period needs ballast, and
nothing states it, but the shape implies the class.

**"Computable" is not "computed".** The period rests on the draught alone, so where the file
states no draught — and it usually does not — the proportion taken for her shape is a model of
what a buoy of that shape looks like, and the whole period becomes this tool's figure rather
than the source's. `marks[].draughtMetres` exists for the sources that do give it, and the page
says which it had.

### The lag is the part that cannot be skipped

A damped body's answer has two numbers, and taking only the gain leaves every motion peaking at
the same instant as every other. Heave and tilt have different natural periods, so **falling out
of step is most of what makes a real buoy's motion look irregular** rather than metronomic.
Applied per component — gain on the amplitude, lag on the phase — it comes out on its own.

At resonance the gain is `1/(2ζ)` and the lag is exactly a quarter cycle; above it the lag goes
on towards half a cycle, which is why it is computed with `atan2` and not `atan`. Folded back
by `atan`, a body above its own period would be drawn early rather than late: plausible, and
upside down.

**And it is added to the phase, not subtracted.** The travelling wave runs `kx − ωt`, so its
phase *decreases* with time: a body that answers late reaches a given phase later, which is a
larger phase. Subtracting draws a resonant buoy a quarter cycle *ahead* of the water — which
still looks like a buoy moving in a sea, and is the motion running backwards. The test for it
counts the seconds between the water's crest and the body's, round the cycle, rather than
recomputing the arithmetic that produced it.

### The damping is the one figure with no source

A buoy's heave damping is not a constant of nature. It depends on her hull and on whether she
carries a heave plate, and the literature reports it per vessel rather than in general. Thirty
per cent of critical is a middling figure for a small float without one, it is **chosen**, and
the page says so.

It weighs most at resonance, where the response goes as one over twice it — which is to say
**the choice matters most exactly where a one-degree-of-freedom model is least trustworthy**.

## The sky, and the path a body lays on the water

The water reflects the sky — Schlick's approximation of Fresnel, about two per cent head-on and
one at a graze — and that reflection is most of why a sea looks like a sea. Until #37 it
reflected **one colour**, so it made the waves visible and said nothing about the sky or where
the moon was.

There is no sky in this scene: no dome, no environment map, no extra pass. **The only place a
sky appears is in the water**, so a body shows up in the reflection and never above the horizon,
and `ui/panels.ts` says so rather than leaving a reader to wonder.

### The path is evidence; the brightness is not

Where a body is reflected off a wavy sea it lays a lane of light, and the lane is directional: a
target on its bearing is seen against it or lost in it, which is the kind of thing a report
argues about.

- **Where it lies** is the body's own azimuth, computed from the clock and the position.
- **How wide it is** is about twice the sea's rms slope — tilt a facet by an angle and the ray
  it reflects turns by twice that — so a glitter path is a direct measurement of the surface.
- **How bright it was** is not computable from anything in a report. Cloud decides it and no
  source this project has met states it, and this renderer is not photometrically calibrated
  anyway. What carries is the RATIO: one phase of the moon against another, and either against
  the sun.

### A half moon is a ninth of a full one, not half

The lit fraction is geometry and the brightness is not. At full the moon is seen at zero phase
angle, where the shadows between the regolith grains hide behind the grains casting them and the
disc surges — the opposition effect. Allen's relation, as fitted by Krisciunas and Schaefer
(*PASP* 103, 1991, 1033), adds `0.026 a + 4e-9 a⁴` magnitudes at phase angle `a`:

| lit | phase angle | against a full moon |
|---:|---:|---:|
| 100% | 0° | 1.00 |
| 50% | 90° | 0.091 |
| 41% | 100° | 0.062 |
| 25% | 120° | 0.026 |
| 10% | 143° | 0.007 |

Scaling light by the lit fraction is out by an order of magnitude at the crescent.

### The width is declared, not read off the drawn sea

This is why #37 waited for #36, and why widening the band was not enough on its own. Cox and
Munk photographed sun glitter off Maui in 1951–52 and fitted `mss = 0.003 + 0.00512 U` (*JOSA*
44, 1954, 838) — the whole surface's slope, capillary-gravity ripples included.

| Hs | wind that raises it | mss | rms slope | path width |
|---:|---:|---:|---:|---:|
| 1 m | 6.8 m/s | 0.038 | 11.0° | 22.1° |
| 2 m | 9.7 m/s | 0.053 | 12.9° | 25.8° |
| 3 m | 11.8 m/s | 0.064 | **14.2°** | **28.3°** |
| 5 m | 15.3 m/s | 0.081 | 15.9° | 31.8° |

The drawn sea's slope is 5.4° at Hs 3 after #36, so reflecting a point body off the drawn
normals alone lays a path 11° wide where the sea lays one of 28: **water sharper than any that
exists, asserted by a picture**. So the missing roughness goes into the body's own lobe.
Slopes add in quadrature, so what is missing is `measured − drawn` as variances and the extra
spread of the reflected ray is twice its root — 26.3° for a 3 m sea, which convolved with what
the normals already do comes out at the measured width.

**Shading in roughness a mesh cannot carry is ordinary practice. Declaring it is not**, and the
alternative is a number tuned until the picture looks right.

### The ray has to leave the water that is drawn

The reflection starts from the fragment's world position, and that position is moved twice:
the waves lift it and `curvature.ts` sinks it by the drop that puts a horizon in the picture.
Taken before either — which is where the varying was first assigned, at the top of the vertex
chunk — the ray leaves the MEAN sea while the normal it bounces off belongs to the drawn one.

The angles are small (about half a degree from a metre of wave height at a hundred metres, and
under a tenth near the horizon, against a lobe tens of degrees wide) and that is not the
point: it is a plausible pattern computed off a surface the picture does not have, which is
this project's whole failure mode in miniature. The position is therefore taken again at
`project_vertex`, after everything that moves it — rather than recomputing the drop, which
would put the curvature's formula in a second file.

Only the vertical part changes, so the wave phases, which read `.xz`, are untouched.

### Where a sea is not stated, no path is drawn

No sea, no slope, no width — and a mirror-sharp body on dead flat water would assert a calm
nobody recorded, which is the same failure as drawing a flat sea in the first place. The
gradient stays and the lane does not appear; the page says why.

### One direction for the whole frame

The key light was fixed at an arbitrary `(1, 2, 1)` and deliberately so, with the reasoning
recorded and issue #15 named. A sea handing back a moon on 191° while the hulls are lit from
somewhere else is one picture making two claims, so #37 takes that piece of #15 with it: the sky
and the key light are driven from the same computed direction.

**Which body may light the picture follows the picture, not the almanac.** The renderer draws
night or day from the light condition the FILE states, because that is a witness's word about
the dark. Where the two disagree — a file saying night with the sun computed above the horizon,
which is what a mistyped date or time zone looks like — the water must not hand back a sun over
a night palette. That would report the disagreement wordlessly, in a picture, where the panel
reports it in a sentence a reader can check.
