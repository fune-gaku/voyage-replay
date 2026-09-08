/**
 * The text under the picture.
 *
 * The 3D view shows what happened; these say what the data is and whether it can be
 * trusted - where each track came from, whether a heading was ever recorded, how close
 * the two actually came, and anything a ship could not physically have done. A
 * reconstruction without them is an animation.
 */

import { assumedHeights } from "../actors/vessel/heights.js";
import { describeAspect, visibleLights } from "../actors/vessel/lights.js";
import { hullDimensions } from "../actors/vessel/hull-shape.js";
import { hullCentreOffset } from "../actors/vessel/reference-point.js";
import { hullApproach, type Contact, type HullApproach } from "../actors/vessel/separation.js";
import { bearingDegrees, distanceMetres, normaliseDegrees } from "../core/geodesy.js";
import { conditionsAt, type Conditions } from "../core/conditions.js";
import { crestOcclusionMetres, type Sightline } from "../core/horizon.js";
import { checkPlausibility, type Finding } from "../core/plausibility.js";
import {
  CHOSEN,
  drawnAppearance,
  type DrawnMark,
  type From,
  type Origin,
} from "../actors/mark/appearance.js";
import type { BuoyageRegion } from "../actors/mark/buoyage.js";
import { lightOf } from "../actors/mark/light.js";
import { CHOSEN_DAMPING, ridingOf, type Riding } from "../actors/mark/riding.js";
import { watchCircleMetres } from "../actors/mark/mooring.js";
import { formatCharacter } from "../core/light-character.js";
import { ASSUMED_MARK } from "../render/mark.js";
import { lightingAt } from "../core/illumination.js";
import { lightsForVessel } from "../actors/vessel/lights.js";
import { SHADER_LAMPS } from "../render/lamps.js";
import { isNight } from "../render/scene.js";
import { drawable } from "../render/waves.js";
import {
  ASSUMED_DIRECTION_DEGREES_TRUE,
  coxMunkSlopeVariance,
  forceClass,
  fullyDevelopedHeightMetres,
  meanOfHighest,
  waveComponents,
  windRaisingMetresPerSecond,
  type SeaEstimate,
  type WaveComponent,
  type WindEstimate,
} from "../core/seaway.js";
import { occludedFractionBounds } from "../core/visibility.js";
import { formatClock } from "../core/time.js";
import {
  closestPointOfApproach,
  sampleAt,
  type PreparedTrack,
  type SampledState,
} from "../core/track.js";
import type { Actor, Mark, MarkPattern, Scenario, Vessel } from "../core/types.js";

export interface Prepared {
  actor: Actor;
  track: PreparedTrack;
}

export function renderPanels(scenario: Scenario, prepared: Prepared[]): string {
  const findings = prepared.flatMap((p) => checkPlausibility(p.track, p.actor.vessel));
  return [
    section("Scenario", overview(scenario)),
    section("Sky at the moment in question", sky(scenario)),
    section("Actors", actorTable(prepared)),
    section("Closest approach", approach(prepared, scenario)),
    section("What each ship showed the other", aspects(prepared, scenario)),
    section("The sea", seaSection(scenario)),
    section("Whether the sea was in the way", occlusion(prepared, scenario)),
    ...marksSection(scenario),
    section(`Plausibility screening (${findings.length})`, findingList(findings, scenario)),
  ].join("");
}

function overview(scenario: Scenario): string {
  return keyValueTable([
    ["Title", scenario.meta.title],
    ["Occurred", scenario.meta.occurredAt],
    ["Locality", scenario.meta.locality ?? "-"],
    ["Light condition", scenario.environment?.lightCondition ?? "unstated"],
    ["Source", scenario.meta.source?.citation ?? scenario.meta.source?.id ?? "-"],
  ]);
}

/**
 * Where the sun and the moon were, computed rather than transcribed.
 *
 * The scenario carries a hand-entered light condition - "night" - which cannot be checked,
 * cannot say how far below the horizon the sun was, and cannot mention the moon at all.
 * All three follow from the time and the place the file already gives, so they are worked
 * out here and printed beside what the file says, which is what makes the two comparable.
 */
function sky(scenario: Scenario): string {
  const at = Date.parse(scenario.meta.occurredAt) / 1000;
  const conditions = conditionsAt(scenario.origin, scenario.environment, at);
  const { sun, moon } = conditions;

  return (
    keyValueTable([
      ["At", `${formatClock(at, scenario.meta.timeZone)} local`],
      [
        "Sun",
        `${sun.altitudeDegrees.toFixed(1)} deg altitude, bearing ${sun.azimuthDegrees.toFixed(0)}`,
      ],
      ["Sun level", conditions.sunLevel],
      [
        "Lights required",
        conditions.navigationLightsRequired
          ? "yes - after sunset (COLREG Rule 20)"
          : "no - between sunrise and sunset (COLREG Rule 20)",
      ],
      [
        "Moon",
        `${moon.altitudeDegrees.toFixed(0)} deg altitude, bearing ${moon.azimuthDegrees.toFixed(0)}, ` +
          `${(moon.illuminatedFraction * 100).toFixed(0)}% lit`,
      ],
      ["Stated in the file", conditions.statedLight ?? "not stated"],
      ["Visibility", visibilityText(conditions)],
    ]) + notes([skyCaveat(conditions), pathNote(conditions), streakNote(scenario, conditions)])
  );
}

/**
 * The path a body lays on the water, which is the one part of the sky that is evidence.
 *
 * **A glitter path is directional.** A target on its bearing is seen against it or lost in
 * it, and that is the kind of thing a report argues about - so where it lies and how wide it
 * is are computed, from the clock, the place, and Cox and Munk's measured slope. What is not
 * computed is how bright it was: cloud decides that and no report states it, the same gap
 * this section already declares about moonlight.
 *
 * The body stands in the sky above the waterline as well, drawn from the same gradient, so the
 * path in the water lies under something a reader can see rather than under nothing.
 */
function pathNote(conditions: Conditions): string {
  const lit = lightingAt(conditions, isNight(conditions.statedLight));
  if (!lit) return noPathBecause(conditions);

  const drawn = conditions.sea
    ? drawable(
        waveComponents(
          conditions.sea.rough,
          conditions.sea.fromDegreesTrue ?? ASSUMED_DIRECTION_DEGREES_TRUE,
        ),
      )
    : [];
  const stands =
    `The ${lit.body} stands ${lit.altitudeDegrees.toFixed(0)} degrees up on ` +
    `${lit.azimuthDegrees.toFixed(0)} degrees`;
  // **Only claim the reflection where one is drawn.** Saying its reflection lies on a bearing
  // and then that no path is drawn is one paragraph contradicting itself.
  if (drawn.length === 0) {
    // A stated calm still draws the body, mirrored; a sea nobody stated draws nothing of it,
    // so the brightness caveat has nothing to be about.
    const drawsIt = conditions.sea ? ` ${BRIGHTNESS_IS_A_BOUND}` : "";
    return `${stands}. ${noSlopeFor(conditions)}${drawsIt} ${SKY_ONLY_IN_THE_WATER}`;
  }
  return (
    `${stands}, so its reflection lies on that bearing. ${widthOf(drawn)}` +
    `${BRIGHTNESS_IS_A_BOUND} ${SKY_ONLY_IN_THE_WATER}`
  );
}

/**
 * How wide the drawn path is, or why there is none.
 *
 * The width is the sea's own slope doubled - tilt a facet and the ray it reflects turns by
 * twice as much - so a path measures the surface directly. The drawn sea is flatter than a
 * real one, and what is missing is put into the body rather than left out, which is a
 * decision to declare rather than a number to tune.
 */
function widthOf(drawn: WaveComponent[]): string {
  const heights = drawn.reduce((total, wave) => total + wave.amplitudeMetres ** 2 / 2, 0);
  const measured = coxMunkSlopeDegrees(4 * Math.sqrt(heights));
  const across = laneWidthDegrees(4 * Math.sqrt(heights));
  return (
    `It is drawn about ${across.toFixed(0)} degrees across at half its brightness - a facet ` +
    "tilted by an angle turns the ray it reflects by twice that, so the lane measures the " +
    `sea's slope directly. The drawn surface is flatter than the measured one ` +
    `(${rmsSlopeDegrees(drawn).toFixed(1)} degrees rms against ${measured.toFixed(1)}), so ` +
    "the difference is put into the body's own spread rather than left out of the picture. "
  );
}

/**
 * How wide the lane is, **at half its brightness**, which is a definition rather than a
 * flourish.
 *
 * "About twice the rms slope" is the usual shorthand and it is not a width a reader can
 * check: it is a characteristic radius in two dimensions, and it is larger than the lobe's
 * own standard deviation by the root of two. The full width at half maximum is the one
 * figure that means the same thing on the page and in the shader - and the two ends of that
 * are 28 degrees against 48 for a 3 m sea, which is more than a quibble.
 */
function laneWidthDegrees(significantHeightMetres: number): number {
  const variance = coxMunkSlopeVariance(windRaisingMetresPerSecond(significantHeightMetres));
  return (GAUSSIAN_FULL_WIDTH * Math.sqrt(2 * variance) * 180) / Math.PI;
}

/** The width of a Gaussian at half its height, in standard deviations: `2 sqrt(2 ln 2)`. */
const GAUSSIAN_FULL_WIDTH = 2 * Math.sqrt(2 * Math.LN2);

/**
 * Why a body that is up still lays no lane - and **there are two of these as well.**
 *
 * A sea nobody states has no slope to take, and a body mirrored off water this tool decided
 * to draw flat would assert a calm nobody recorded. A sea stated flat is that calm on
 * somebody's authority, and calm water does mirror: the body is drawn at its own half degree
 * and no wider, which is a point of light rather than a lane. Calling the second one "nothing
 * states a sea" would report a figure the source gives as a figure it withholds.
 */
function noSlopeFor(conditions: Conditions): string {
  if (!conditions.sea) {
    return (
      "No path is drawn, because nothing states a sea: the width of one is the water's own " +
      "slope and there is none to take. A body mirrored off water this tool decided to draw " +
      "flat would assert a calm nobody recorded."
    );
  }
  return (
    "The file states a sea of no height, so the water is drawn flat and the reflection is a " +
    "mirror image rather than a lane: the body at its own half degree across, which is what " +
    "calm water gives. A lane is what slope makes, and a calm has none."
  );
}

/**
 * Why nothing lays a path - and **there are two different reasons, which must not be run
 * together.**
 *
 * The first is a fact about the watch: neither body is up, and a moonless night is darker
 * than a moonlit one by more than an order of magnitude. Saying nothing at all would leave a
 * reader to work that out from two altitudes in the table above.
 *
 * The second is a fact about the DRAWING. A body can be well up and still lay no path here,
 * because the picture is drawn night or day from the light condition the file states, and
 * only the matching body may light it. That happens exactly when the file and the sun
 * disagree - a mistyped date or time zone - and calling it "neither body is above the
 * horizon" would contradict the altitudes printed one line above and hide the real reason.
 */
function noPathBecause(conditions: Conditions): string {
  const { sun, moon } = conditions;
  if (sun.altitudeDegrees <= 0 && moon.altitudeDegrees <= 0) {
    return (
      "Neither the sun nor the moon is above the horizon at this moment, so nothing lays a " +
      "path on the water and the sea reflects only the sky's own colour. On a night that is " +
      "the whole difference between a hull seen against a lane of light and one seen against " +
      `nothing. ${LIT_FROM_NOWHERE}`
    );
  }
  const up = sun.altitudeDegrees > 0 ? "sun" : "moon";
  const drawnAs = isNight(conditions.statedLight) ? "night" : "day";
  return (
    `No path is drawn, and this one is about the picture rather than the sky: the ${up} is ` +
    `above the horizon, but the view is drawn as ${drawnAs} because that is what the file ` +
    `says, and a ${drawnAs} is not lit by the ${up}. The two disagree, which the line above ` +
    "says in words - putting it in the water instead would be a picture arguing with a " +
    `table, and only one of them can be checked. ${LIT_FROM_NOWHERE}`
  );
}

/**
 * With no body, the scene has no directional light either - which is the same claim, said
 * about the hulls rather than about the water.
 *
 * A key light left standing where the moon was before it set would light them from a bearing
 * nothing is at, and would make a frame depend on how the viewer got to it.
 */
const LIT_FROM_NOWHERE =
  "The hulls are lit without a direction as well: nothing has a lit side and a shaded one, " +
  "because there is nothing up there to cast one.";

/**
 * Said once, under every path. The renderer is not photometrically calibrated, so the only
 * honest brightnesses here are ratios: one phase of the moon against another, and either
 * against the sun.
 */
const BRIGHTNESS_IS_A_BOUND =
  "How bright it was is not drawn from anything: cloud decides that and the source does not " +
  "state it, so it is drawn at a readable brightness rather than a measured one - and at one " +
  "chosen for the condition, since a night and a day here are two hundred times apart and no " +
  "single exposure serves both. What does carry is the RATIO between phases: a half moon is " +
  "about a ninth of a full one, not half of it.";

/**
 * The streaks the lamps lay, which are the only reflection here that a reader can use.
 *
 * **Direction is the whole of it.** A hull reflected in daylight is a broken column of light
 * nobody reads anything off; a red sidelight laying a red path towards an observer says which
 * side of a ship they were on, and says it at a range where the lamp is a single point.
 *
 * Three things have to be said with it. The arc is answered at the water, so a lamp's colour
 * only reaches sea its own sector covers. The streak dies inside the lamp's Rule 22 range,
 * because a reflection that outlived its source would be inventing a detection. And the
 * brightness IS computed - Rule 22's range through Annex I section 8 - so what is left
 * declared is what the sea does with the light and what a lux draws as, not the lamp.
 */
function streakNote(scenario: Scenario, conditions: Conditions): string {
  if (!isNight(conditions.statedLight)) return "";
  // **No sea, no streak either** - and said, rather than left for a reader to notice that a
  // paragraph about lamps on the water sits over water with nothing on it. It is the same
  // reason the body lays no path: a reflection needs a surface with a slope to lie on.
  if (!conditions.sea) {
    return (
      "The lamps lay no streaks on the water for the same reason: a reflection needs a " +
      "surface with a slope to lie on, and nothing states a sea. On a night that is most of " +
      "what a lookout has to see a ship by, so the picture is quieter here than the night was."
    );
  }
  const lamps = scenario.actors.reduce(
    (total, actor) => total + (actor.vessel ? lightsForVessel(actor.vessel).length : 0),
    0,
  );
  const marks = (scenario.marks ?? []).filter((mark) => mark.light).length;
  const over =
    lamps + marks > SHADER_LAMPS
      ? ` More lamps can be lit at once here than the water can reflect - ${lamps + marks} against ${SHADER_LAMPS} - so some of them lay no streak.`
      : "";
  return WHAT_A_LAMP_DOES + LENGTH_RESTS_ON_HEIGHTS + markRange(marks) + over;
}

/**
 * **Where the computed chain stops being computed.**
 *
 * A ship's lamp brightness follows the whole way from Rule 22's range through Annex I's
 * relation, and the paragraph above says so. Rule 22 is about ships. Nothing in this format
 * states how far a buoy's or a beacon's light carries, and IALA's ranges are per light rather
 * than in general - so a mark's range is this tool's own figure, and it is that figure, not a
 * rule, that decides how brightly a mark draws on the water. Said only when a lit mark is
 * actually in the scene, because a sentence about marks over a picture with none in it is the
 * same overclaim in the other direction.
 */
function markRange(lit: number): string {
  if (lit === 0) return "";
  return (
    ` One thing in that chain is not computed. Rule 22 is about ships, and nothing here says ` +
    `how far a mark's light carries, so ${ASSUMED_MARK.lightRangeNauticalMiles} miles is ` +
    `assumed for each of the ${lit} lit ${lit === 1 ? "mark" : "marks"} - and since a range ` +
    `is what the candela is computed FROM, that assumption sets how bright they draw, both ` +
    `in the water and on it. Read a mark's lane for where it lies, not for how it compares ` +
    `with a ship's.`
  );
}

/**
 * The two things a lamp does to water, and what neither of them may claim.
 *
 * A reflection is directional by construction and light is not, which is the whole of why
 * both are drawn: the first alone makes a lamp look like it shines at whoever is looking.
 */
const WHAT_A_LAMP_DOES =
  "Each lamp does two things to the water and both are drawn. It lays a STREAK, its own image " +
  "in a rough mirror, which runs on the bearing it is reflected along and is the one " +
  "reflection in this picture a reader can take anything off. And it LIGHTS the sea around " +
  "it, which is not a reflection and is there from every bearing at once - a full circle " +
  "under an all-round light, a 112.5 degree wedge under a sidelight, which is where Rule 21 " +
  "becomes visible on the water rather than only in a sector diagram. Both are laid only over " +
  "sea inside the lamp's own arc, so a sidelight's colour never reaches water it does not " +
  "light, and both fade out inside the range Rule 22 gives that light, because a reflection " +
  "is dimmer than its source and one that outlived the lamp would be inventing a detection. " +
  "They fade over different distances though, and the difference is the point: the streak " +
  "over the whole way round, lamp to water to eye, so that it goes out before the lamp it " +
  "reflects; the light on the sea over the lamp's own leg alone, because where an observer " +
  "stands decides how much of it comes back to them and never how much arrived. " +
  "**How much light a lamp puts on the water IS computable**, and it is computed: Rule 22 " +
  "gives each light a range, Annex I section 8 gives the minimum candela that range was set from, " +
  "and the rest is the inverse square with the incidence angle and the vertical spread of " +
  "the fitting - a navigation light points at the horizon, not at the water. Annex I " +
  "section 10 fixes that spread only at two depressions, full intensity to 5 degrees and 60 " +
  "per cent at 7.5; below that the rule requires nothing and the fall-off drawn here is " +
  "THIS TOOL'S, not the rule's. With it in, a six mile masthead light twenty metres up lays " +
  "about 0.0005 lux on the sea a hundred metres off - a quarter of what the stars do, and a " +
  "fortieth of what the moon did - and its brightest patch of sea is under 80 metres away. " +
  "Without the spread it would be four times that, which is the figure to be careful of: it " +
  "is the beam pointed where it is not pointed. What stays chosen besides the tail is one " +
  "figure per condition saying what a lux draws as, set so that a lamp and the moon are on " +
  "one scale. " +
  "**Two different things there, and only one of them is a bound.** Section 8 computes the " +
  "MINIMUM intensity a light must have to comply. A real fitting is at least that bright " +
  "and may be a good deal brighter - the annex asks only that the maximum be limited to " +
  "avoid undue glare, and puts no figure on it, so how far above the minimum a particular " +
  "lamp sat is not bounded here or stated in any report. The 94-to-12 between a masthead " +
  "and a sidelight is therefore the ratio of two legal minima rather than of two fittings. " +
  "The vertical spread is weaker still, and which water it " +
  "binds depends on how far off that water is. Section 10 requires the full intensity only " +
  "within 5 degrees of the horizontal and 60 per cent of it within 7.5, and nothing below - " +
  "and for a masthead twenty metres up those two angles fall on the sea at 229 and 152 " +
  "metres, which makes three zones rather than two. Beyond 229 m the drawn value IS the full " +
  "floor, so that faint water is a bound on a real lamp. Between 152 and 229 m the rule asks " +
  "for 60 per cent and this curve draws more, so a complying lamp may be dimmer there than " +
  "the picture. Inside 152 m no floor applies at all - and that is where the light is: the " +
  "brightest patch, at 78 m, sits 14 degrees under the beam and is 3.4 times the sea at 229 " +
  "where the full floor starts. **The lit patch anyone would notice is this tool's curve**, " +
  "and the real lamp may have been brighter or dimmer than what is drawn there. ";

/**
 * **Read the bearing off a streak and not the length.**
 *
 * Where a streak lies follows from the clock, the positions and Rule 21, all of which the
 * source gives or the arithmetic settles. How FAR it runs is the specular geometry of two
 * heights - the lamp's above the water and the eye's - and neither is recorded: both are made
 * from the ship's beam, which is issue #8. Saying only the first would put a figure that rests
 * on an assumption beside one that rests on the record, at the same apparent confidence.
 */
const LENGTH_RESTS_ON_HEIGHTS =
  "And read a bearing off a streak rather than a length: where it lies follows from the " +
  "positions and Rule 21, but how far it runs is set by how high the lamp is and how high " +
  "the eye is, and neither of those is recorded - both are made up from the ship's beam " +
  "(issue #8).";

/**
 * What the drawn sky is, said wherever a body is up.
 *
 * Above the waterline and in the water it is one gradient drawn twice, so the body stands
 * where the almanac puts it and is reflected beneath it. **The gradient itself is chosen**,
 * which is worth saying beside a position that is not: a clear sky's own gradient needs a
 * turbidity no report carries, so two colours and a curve between them is what there is.
 */
const SKY_ONLY_IN_THE_WATER =
  "The sky above the waterline and the sky in the water are the same one, so the body stands " +
  "where it is computed to stand and is reflected under it. Its position is arithmetic; the " +
  "colours of the sky are not - a clear sky's own gradient needs a turbidity no report " +
  "carries, so what is drawn is a horizon colour, a zenith colour and a curve between them.";

/**
 * What sky the view put over this scenario, which is a claim of its own.
 *
 * A day is drawn clear: the light then comes mostly from one direction, so a sea has a lit
 * face and a shaded one and a swell has shape. An overcast sky lights both alike and
 * flattens it. Cloud is what decides, and no report this project has met states it.
 *
 * A night is not drawn clear or cloudy - it is drawn dark, and the dark is the evidence -
 * so the sentence belongs only over a day. It asks the renderer which it drew rather than
 * working it out again, because two answers to that question is how a page ends up
 * declaring a fine day over a night.
 */
function drawnSky(conditions: Conditions): string {
  if (isNight(conditions.statedLight)) {
    return (
      "The view draws this as night, as it does an unstated condition and a stated " +
      "twilight; from a wheelhouse the dark is the evidence. "
    );
  }
  if (conditions.statedLight === "restricted-visibility") return restrictedSky(conditions);
  return (
    "The view draws a fine day, because a sky has to be drawn and cloud is the one thing " +
    "that would decide it - which nothing states. "
  );
}

/**
 * Restricted visibility is a statement about the air, not about the sun.
 *
 * `lightCondition` mixes two axes and this is the value that shows it: a fog at noon and a
 * fog at midnight are both "restricted-visibility", and the enum cannot tell them apart. The
 * view has to pick, and it picks a day - so a scenario that was foggy in the dark is drawn
 * wrongly, and this is the sentence that says so rather than letting the picture pass.
 */
function restrictedSky({ visibilityMetres }: Conditions): string {
  const fog =
    visibilityMetres === null
      ? "no distance is given, so no fog is drawn - only the word"
      : `fog is drawn out to the stated ${visibilityMetres} m, though not over the sky: a fog ` +
        "you can see a clear sky above is not a fog, and this one draws the gradient anyway";
  return (
    `The file says restricted visibility, which is a statement about the air and not about ` +
    `the sun. The view therefore draws this as a day, and ${fog}. A fog in the dark carries ` +
    "the same word and would be drawn wrongly here; the field cannot tell the two apart. "
  );
}

function visibilityText({ visibilityMetres }: Conditions): string {
  if (visibilityMetres === null) return "not stated";
  return `${visibilityMetres} m (${(visibilityMetres / 1852).toFixed(1)} NM)`;
}

/**
 * What the computed sky is, and what it is not.
 *
 * It is geometry, so it is as good as the clock and the position. It is not a brightness:
 * cloud is what decides whether a half moon forty degrees up lights the sea or nothing at
 * all, and no report this project has met states it. Saying so is the difference between
 * a figure and a claim.
 */
function skyCaveat(conditions: Conditions): string {
  const disagreement =
    conditions.statedLightAgrees === false
      ? ` The file says "${String(conditions.statedLight)}", which the sun's altitude does not support - check the date, the time zone and the position.`
      : "";
  return (
    drawnSky(conditions) +
    "Computed from the time and the origin, to about a hundredth of a degree for the sun " +
    "and a third of a degree for the moon. How much light actually reached the sea also " +
    "depends on cloud, which the source does not state." +
    disagreement
  );
}

function actorTable(prepared: Prepared[]): string {
  const head = [
    "id",
    "name",
    "LOA",
    "beam",
    "points",
    "derivation",
    "position at",
    "hull offset",
    "heading?",
    "hull",
  ];
  const rows = prepared.map(({ actor, track }) => {
    const withHeading = track.points.filter((p) => p.headingDegreesTrue !== undefined).length;
    return [
      actor.id,
      actor.name ?? "-",
      actor.vessel ? `${actor.vessel.loaMetres} m` : "-",
      actor.vessel ? `${actor.vessel.beamMetres} m` : "-",
      String(track.points.length),
      actor.track.derivation,
      actor.track.positionAt,
      hullOffsetCell({ actor, track }),
      `${withHeading}/${track.points.length}`,
      hullShapeCell(actor.vessel),
    ];
  });
  return dataTable(head, rows);
}

/**
 * How far the hull in the view was moved off the position the source reports.
 *
 * A reader checking the reconstruction has to be able to tell a ship that was put where her
 * offsets say from one drawn at her antenna because nobody wrote the offsets down. The two
 * look identical on screen and are a ship's length apart in what they claim.
 *
 * Having the offsets is not enough to have used them. The offset runs along the ship's
 * heading, so the renderer declines to apply it at an instant where the source states no
 * heading and no course, and a cell that reported the arithmetic alone would say a hull had
 * been placed that was in fact drawn exactly where it was before.
 */
function hullOffsetCell(prepared: Prepared): string {
  const { actor, track } = prepared;
  const offset = hullCentreOffset(actor.track.positionAt, actor.vessel?.referencePointOffsets);
  if (offset.kind === "already-the-hull") return "none: already the hull";
  if (offset.kind === "not-stated") return "not stated: drawn as reported";

  const moved = `${offset.forwardMetres.toFixed(1)} m fwd, ${offset.starboardMetres.toFixed(1)} m stbd`;
  const stated = statedDirectionCount(track);
  if (stated === 0) return `${moved}, never applied: no direction stated`;
  if (stated < track.points.length) {
    return `${moved}, applied where she states a direction (${stated}/${track.points.length})`;
  }
  return moved;
}

/**
 * What the drawn hull rests on, which is not the same for every ship.
 *
 * The shape is generated from length and beam - it is the right SIZE and a generic form, not
 * this ship's lines - and everything vertical is still a fraction of the beam rather than a
 * class's depth (issue #8). The one part that can be measured is where the bridge sits: a
 * ship that transmits her four AIS dimensions has said where her antenna is, and that is the
 * wheelhouse. A reader has to be able to tell that ship from one whose bridge was put at a
 * fraction of her length because nothing said otherwise, because on screen they look alike.
 */
function hullShapeCell(vessel: Vessel | undefined): string {
  if (!vessel) return "-";
  const bow = vessel.type === "pushing-ahead" ? "box bow" : "generic";
  return vessel.referencePointOffsets ? `${bow}, bridge measured` : `${bow}, bridge assumed`;
}

/**
 * Whether the view really moved this hull off the position her track reports, AT ONE INSTANT.
 *
 * The instant is the whole point. Placement is not a property of a ship, or even of a track:
 * the renderer decides it from the sample it is drawing, and declines wherever that sample
 * states no heading and no course. A track that says which way she points at some points and
 * not at others is placed for part of its length and not for the rest, so a sentence about
 * one moment - the closest approach - has to be answered for that moment. Answering it from
 * the track as a whole says "placed" over a hull sitting on its antenna.
 */
function isPlacedAt({ actor, track }: Prepared, epochSeconds: number): boolean {
  const offset = hullCentreOffset(actor.track.positionAt, actor.vessel?.referencePointOffsets);
  if (offset.kind !== "offset") return false;

  // An antenna stated as being exactly amidships is a real arrangement, not a missing value,
  // and it moves the hull nowhere. Having done the arithmetic is not having moved anything.
  if (offset.forwardMetres === 0 && offset.starboardMetres === 0) return false;

  const state = sampleAt(track, epochSeconds);
  return state !== null && (state.headingDegreesTrue ?? state.cogDegreesTrue) !== undefined;
}

function statedDirectionCount(track: PreparedTrack): number {
  return track.points.filter((p) => (p.headingDegreesTrue ?? p.cogDegreesTrue) !== undefined)
    .length;
}

function pair(prepared: Prepared[]): [Prepared, Prepared] | null {
  const [first, second] = prepared;
  return first && second ? [first, second] : null;
}

function approach(prepared: Prepared[], scenario: Scenario): string {
  const both = pair(prepared);
  if (!both) return "<p>Needs two actors.</p>";
  const [first, second] = both;

  const cpa = closestPointOfApproach(first.track, second.track);
  if (!cpa) return "<p>The two tracks do not overlap in time.</p>";
  const hulls = hullApproach2(both);
  const zone = scenario.meta.timeZone;

  return (
    keyValueTable([
      ["Between", `${first.actor.id} and ${second.actor.id}`],
      ["Reported positions", `${cpa.metres.toFixed(0)} m (${(cpa.metres / 1852).toFixed(2)} NM)`],
      ["...at", `${formatClock(cpa.epochSeconds, zone)} local`],
      ...hullRows(hulls, zone),
    ]) +
    note(approachCaveat(both, cpa.epochSeconds)) +
    note(hullNote(both, hulls, cpa.epochSeconds))
  );
}

/**
 * The same question asked of the hulls, where both ships carry the particulars to draw one.
 *
 * `core/track.ts` cannot answer it - a range between hulls needs their shapes, and `core/` is
 * not allowed to know what a ship is - so it comes from `actors/vessel/separation.ts`, off the
 * outline the renderer draws.
 */
function hullApproach2(both: [Prepared, Prepared]): HullApproach | null {
  const ships = both.map(({ actor, track }) =>
    actor.vessel ? { track, vessel: actor.vessel, positionAt: actor.track.positionAt } : null,
  );
  const [first, second] = ships;
  return first && second ? hullApproach(first, second) : null;
}

/** What the hulls did, as rows: a gap and its moment, or every spell of contact. */
function hullRows(hulls: HullApproach | null, timeZone: string): [string, string][] {
  if (!hulls) return [["Between hulls", "-, needs both ships' particulars"]];
  const [first, ...rest] = hulls.contacts;
  if (!first) {
    return [
      ["Between hulls", `${hulls.metres.toFixed(1)} m`],
      ["...at", `${formatClock(hulls.epochSeconds, timeZone)} local`],
    ];
  }
  const label = rest.length === 0 ? "in contact" : `in contact, ${hulls.contacts.length} times`;
  return [["Between hulls", label], ...hulls.contacts.map((spell) => spellRow(spell, timeZone))];
}

/**
 * One spell, as a clock time and a length.
 *
 * **The length is the difference between the two, not the number of samples that showed
 * contact.** Those differ by one step every time, and this page printed the count: 18:13:28 to
 * 18:13:37 is nine seconds, and it said ten.
 */
function spellRow(spell: Contact, timeZone: string): [string, string] {
  const seconds = spell.toEpochSeconds - spell.fromEpochSeconds;
  return [
    "...from",
    `${formatClock(spell.fromEpochSeconds, timeZone)} to ${formatClock(spell.toEpochSeconds, timeZone)} local, ${seconds.toFixed(1)} s`,
  ];
}

/**
 * What that range is a distance BETWEEN.
 *
 * Each track says for itself what its positions refer to, and the two need not agree: one
 * ship's may be her antenna and the other's already moved to her reference point. Naming
 * both is the only version that stays true when they differ.
 *
 * Whether the view disagrees with the figure depends on whether the view moved anything at
 * the moment this figure describes, so that half is asked of that moment rather than assumed.
 * A page that says "the hulls are placed from these offsets" beside two hulls drawn at their
 * antennae has reproduced, in prose, the fault the offsets were applied to fix.
 */
function approachCaveat(both: [Prepared, Prepared], epochSeconds: number): string {
  const [first, second] = both;
  const between = `${reportedPoint(first)} to ${reportedPoint(second)}`;
  // Whichever of the two states its offsets, for the sake of one concrete distance. Either
  // may be the one that has them, and neither need be.
  const withOffsets = [first, second].find((p) => p.actor.vessel?.referencePointOffsets);
  const offsets = withOffsets?.actor.vessel?.referencePointOffsets;
  const howFar = offsets
    ? ` On ${withOffsets.actor.id} that point sits ${offsets.fromBowMetres} m from the bow.`
    : "";

  const caveat = viewCaveat(both, epochSeconds);
  return `Measured ${between}, which is what the sources state.${howFar} ${caveat}`;
}

/**
 * What the hull figure is worth, which is less than it looks and more than the other one.
 *
 * Four things have to be said with it and each is a different kind of caveat.
 *
 * The SHAPE is generated. A length and a beam is all a scenario carries, so the outline is
 * this tool's plan of a plausible ship of that size, not either ship's lines - and every
 * metre of the answer is a metre of that. It is the shape the picture draws, which is the
 * only property that makes the number and the view agree.
 *
 * The DIMENSIONS come from the AIS offsets where the file has them, because the four
 * distances measure the ship and the particulars' length is often a registered length. AIS
 * rounds them to the metre.
 *
 * The INSTANT is not the other row's instant. Hulls close before antennae do, or after,
 * depending on where the antennae sit; on the reference case the hulls touch about eight
 * seconds before the reported positions are nearest.
 *
 * And the WINDOW is interpolated. Positions between samples are joined by straight lines, so
 * a contact lasting seconds is measured inside a segment the source says nothing about.
 */
function hullNote(
  both: [Prepared, Prepared],
  hulls: HullApproach | null,
  antennaeAt: number,
): string {
  if (!hulls) {
    return (
      "The range between hulls is not given because at least one of these actors carries no " +
      "particulars, and a hull cannot be drawn - or measured against - without a length and " +
      "a beam."
    );
  }
  const gap = hulls.epochSeconds - antennaeAt;
  const when =
    gap === 0
      ? "at the same moment as"
      : `${Math.abs(gap)} s ${gap < 0 ? "before" : "after"} the moment`;
  return (
    "That second figure is between the hulls as DRAWN, which is the question a collision " +
    "asks and the first figure cannot answer. Three things bound it. The outline is " +
    "generated - a plausible plan of a ship of the right size, not either ship's lines - so " +
    `every metre of it is a metre of this tool's guess. Its length and beam come from ${dimensionSource(both)}. ` +
    `And it happens ${when} the reported positions are nearest, so the two rows are not two ` +
    "readings of one instant. Where they touch, the ends of each spell are found on those " +
    "hulls rather than on the search, but the positions between samples are joined by " +
    `straight lines, so the times are this tool's interpolation and not the source's. It ` +
    `looked every ${hulls.stepSeconds} s, so a touch shorter than that could fall between ` +
    "two looks and go unreported."
  );
}

/**
 * Which of the file's two answers about a hull's size this range was measured at.
 *
 * Both are in the file and they differ - on the reference case's tanker by 0.4 m of beam,
 * which moves first contact by a second - so saying which one was used is the difference
 * between a figure a reader can check and a figure they have to accept.
 */
function dimensionSource(both: [Prepared, Prepared]): string {
  const sources = both
    .map(({ actor }) => (actor.vessel ? hullDimensions(actor.vessel).from : null))
    .filter((from) => from !== null);
  return sources.every((from) => from === "offsets")
    ? "the four AIS offsets, which measure the ship where the particulars describe her"
    : "the particulars, the AIS offsets not being stated for both";
}

/** How the picture stands to that figure, at the moment the figure is about. */
function viewCaveat(both: [Prepared, Prepared], epochSeconds: number): string {
  const placed = both.filter((p) => isPlacedAt(p, epochSeconds)).map((p) => p.actor.id);
  const gap = "the gap between hulls, which needs their shapes rather than two points: issue #10";

  if (placed.length === 0) {
    return (
      "At that moment neither hull in the view is moved off the position reported for her, " +
      `so this is also the distance between the hulls as drawn - though still not ${gap}.`
    );
  }

  const clause =
    placed.length === 1
      ? `At that moment ${placed[0]}'s hull in the view is placed from her offsets`
      : "At that moment both hulls in the view are placed from their offsets";
  return `${clause}; this range is not, so it is not ${gap}.`;
}

function reportedPoint({ actor }: Prepared): string {
  const point = actor.track.positionAt === "reference-point" ? "reference point" : "GPS antenna";
  return `${actor.id}'s ${point}`;
}

/**
 * One ship looking at another. `observer` and `target` are not interchangeable: the table
 * reports what the observer saw, and the light arcs are read off the TARGET's heading, so
 * swapping them turns every aspect through 180 degrees while still looking plausible.
 */
interface Encounter {
  observer: Prepared;
  target: Prepared;
  /** The target's particulars, already checked to be present. */
  targetVessel: Vessel;
  timeZone: string;
}

function aspects(prepared: Prepared[], scenario: Scenario): string {
  const both = pair(prepared);
  if (!both) return "<p>Needs two actors.</p>";
  const [observer, target] = both;

  const targetVessel = target.actor.vessel;
  if (!targetVessel) return `<p>${escapeHtml(target.actor.id)} carries no vessel particulars.</p>`;

  const cpa = closestPointOfApproach(observer.track, target.track);
  if (!cpa) return "<p>The two tracks do not overlap in time.</p>";

  const encounter = { observer, target, targetVessel, timeZone: scenario.meta.timeZone };
  const rows: string[][] = [];
  for (let back = 420; back >= 0; back -= 60) {
    const row = aspectRow(encounter, cpa.epochSeconds - back);
    if (row) rows.push(row);
  }
  return (
    dataTable(["time", `bearing of ${target.actor.id}`, "range", "aspect"], rows) +
    // Deliberately says nothing about how far apart the two answers are HERE: that depends on
    // this scenario's ranges and offsets, and a sentence measured on one case and printed over
    // every case is the same kind of untrue claim as a hull drawn where it was not.
    note(
      "Bearings and ranges here are between the positions the sources report, not between " +
        "the hulls in the view. The two agree while the ships are far apart and part company " +
        "as the range closes, by up to the antenna offsets - and once the hulls are within " +
        "their own lengths of each other, no bearing between two points says much about what " +
        "was visible. Bearings and ranges between hulls need their shapes - issue #10.",
    )
  );
}

/** One minute of the approach: where the other ship was, and what she was showing. */
function aspectRow(encounter: Encounter, epochSeconds: number): string[] | null {
  const { observer, target, targetVessel, timeZone } = encounter;
  const here = sampleAt(observer.track, epochSeconds);
  const there = sampleAt(target.track, epochSeconds);
  if (!here || !there) return null;

  const bearing = bearingDegrees(here.position, there.position);
  return [
    formatClock(epochSeconds, timeZone),
    `${bearing.toFixed(1)} deg`,
    `${distanceMetres(here.position, there.position).toFixed(0)} m`,
    `${observer.actor.id} sees: ${lightsSeen(targetVessel, there, bearing)}`,
  ];
}

/**
 * Heading fixes a ship's light arcs. Where the source supplied none - a Class B
 * transponder never does - say so rather than quietly using the course.
 */
function lightsSeen(vessel: Vessel, there: SampledState, bearing: number): string {
  const heading = there.headingDegreesTrue;
  const standIn = heading ?? there.cogDegreesTrue;
  if (standIn === undefined) return "no heading and no course: cannot say";

  const aspect = describeAspect(visibleLights(vessel, normaliseDegrees(bearing + 180 - standIn)));
  return heading === undefined ? `${aspect} (from course over ground)` : aspect;
}

/**
 * One ship looking for another across a sea, which needs both ships' particulars.
 *
 * Separate from `Encounter` because it asks a different question and needs a different
 * thing to be present: light arcs need the target's heading and nothing about the observer,
 * whereas how much sea stands between them turns on how high the observer's eye is.
 */
interface Sighting {
  observer: Prepared;
  target: Prepared;
  observerVessel: Vessel;
  targetVessel: Vessel;
  timeZone: string;
}

/**
 * What the sea was, and how much of that anybody wrote down.
 *
 * Its own section rather than a paragraph under the occlusion table, and that is a
 * correction: the table needs two ships and the sea does not. A scenario with one ship and
 * a stated sea drew three metres of it, with a readable height and a readable direction,
 * and said nothing whatever about them - the picture asserting a sea the page never
 * mentioned, which is the fault every other line here exists to prevent.
 *
 * Printed even when there is no sea to describe, because "nothing was stated" is the part a
 * reader most needs and the flat water in the view is the strongest claim available.
 */
function seaSection(scenario: Scenario): string {
  const at = Date.parse(scenario.meta.occurredAt) / 1000;
  const conditions = conditionsAt(scenario.origin, scenario.environment, at);
  const { sea } = conditions;
  const wind = windRows(conditions) + disagreementNote(conditions);
  if (!sea) return wind + `<p>${escapeHtml(NO_SEA)}</p>`;

  // The components the RENDERER draws, through the renderer's own two rules: the generator
  // is seeded from the sea itself, and `drawable` drops what is under a millimetre and gives
  // the rest its share. Same sea, same direction, same filter - so every figure below is
  // about the water on screen rather than about a second reading of the band.
  const drawn = drawable(
    waveComponents(sea.rough, sea.fromDegreesTrue ?? ASSUMED_DIRECTION_DEGREES_TRUE),
  );

  const rows: [string, string][] = [
    ["From", sea.source === "stated" ? "figures in the file" : "the stated sea state"],
    ["Significant height", heightRange(sea)],
    [
      "Peak period",
      sea.periodFrom === "none"
        ? "no waves to have one"
        : `${sea.rough.peakPeriodSeconds.toFixed(1)} s (${PERIOD_SOURCE[sea.periodFrom]})`,
    ],
    ["Coming from", directionRow(sea)],
    ["Derivation", sea.derivation],
    ["Waves drawn", bandRow(drawn, sea.rough.significantHeightMetres > 0)],
  ];
  return wind + keyValueTable(rows) + notes([seaCaveat(sea), slopeNote(drawn)]);
}

/**
 * Where the sea runs from, keyed on the DIRECTION's own provenance rather than the period's.
 *
 * A file may state a bearing on a sea of no height - a decayed swell has one - and hiding it
 * because the period is absent denies a figure the file contains.
 */
function directionRow(sea: SeaEstimate): string {
  if (sea.directionFrom !== "stated" && sea.rough.significantHeightMetres <= 0) {
    return "no waves to come from anywhere";
  }
  if (sea.fromDegreesTrue === null) {
    return `${ASSUMED_DIRECTION_DEGREES_TRUE.toFixed(0)} deg (assumed - nothing states it)`;
  }
  return `${sea.fromDegreesTrue.toFixed(0)} deg true (${DIRECTION_SOURCE[sea.directionFrom]})`;
}

/** The shortest and longest wavelengths actually carrying the drawn sea, or null for a calm. */
function drawnBand(drawn: WaveComponent[]): { shortest: number; longest: number } | null {
  if (drawn.length === 0) return null;
  const lengths = drawn.map((wave) => (2 * Math.PI) / wave.wavenumberPerMetre);
  return { shortest: Math.min(...lengths), longest: Math.max(...lengths) };
}

/**
 * Which waves are in the drawn sea, which is a statement about the picture rather than the
 * water: it decides how steep the surface is and how often it crosses a sight line.
 *
 * **Measured off the components themselves rather than off the band's edges.** Each is
 * sampled from somewhere inside its own equal-energy bin, so the band's ends are not the
 * drawn sea's ends: the bins reach from a sixth of the peak frequency to eight times it,
 * while the waves that come out of them for a 3 m sea run from 1.9 m to 174 m. Printing the
 * edge would be the page describing a sea the picture does not have.
 */
function bandRow(drawn: WaveComponent[], hasHeight: boolean): string {
  // Two different nothings. A sea of no height has no components at all; a sea of four
  // millimetres has forty and the renderer keeps none of them, since not one stands a
  // millimetre high. Saying "no height" over a height printed in the row above would be the
  // page contradicting itself one line up.
  const band = drawnBand(drawn);
  if (band) return `${band.shortest.toFixed(1)} m to ${band.longest.toFixed(0)} m of wavelength`;
  return hasHeight
    ? "none - nothing in this sea stands a millimetre high"
    : "none, on a sea of no height";
}

/** The rms slope of a surface made of these components: `atan` of the summed variance. */
function rmsSlopeDegrees(drawn: WaveComponent[]): number {
  const variance = drawn.reduce(
    (total, wave) => total + (wave.amplitudeMetres * wave.wavenumberPerMetre) ** 2 / 2,
    0,
  );
  return (Math.atan(Math.sqrt(variance)) * 180) / Math.PI;
}

/**
 * **What the band leaves out, said rather than integrated for - and only where there is a
 * band.** A sea of no height has no waves drawn and no slope to fall short of, and a page
 * that warned about the steepness of a flat surface would be describing another picture.
 *
 * Both figures are this sea's own. The drawn one is summed from the components above; the
 * measured one is Cox and Munk's `mss = 0.003 + 0.00512 U` for the wind that raises a sea
 * this size, since no report carries a slope. Widening the band cannot close the gap: the
 * rest is in capillary-gravity ripples, which the spectrum this is built on does not
 * describe and no screen can draw.
 */
function slopeNote(drawn: WaveComponent[]): string {
  const band = drawnBand(drawn);
  if (!band) return "";
  const heights = drawn.reduce((total, wave) => total + wave.amplitudeMetres ** 2 / 2, 0);
  const measured = coxMunkSlopeDegrees(4 * Math.sqrt(heights));
  return (
    `The drawn sea carries waves from ${band.shortest.toFixed(1)} m up. Most of a real sea's ` +
    "SLOPE is in shorter waves than that - Cox and Munk measured about " +
    `${measured.toFixed(0)} degrees rms for the wind that raises a sea this size, against ` +
    `${rmsSlopeDegrees(drawn).toFixed(1)} here - so the water is drawn flatter than it was, ` +
    "and the difference is in ripples this spectrum does not describe and no screen can " +
    "draw. The same band decides how often the sea crosses a sight line, so the hidden " +
    "fractions below move with it: it is one choice, made once, for the picture and the " +
    "arithmetic together."
  );
}

/**
 * Cox and Munk's clean-surface slope for the wind that would raise this sea, in degrees.
 *
 * Both halves come from `core/seaway.ts` rather than being written again here: the sea's
 * physics is not the page's, and `render/sky.ts` needs the same number to set the width of
 * the glitter path. Two copies would put a figure on the page and a different one in the
 * water.
 */
function coxMunkSlopeDegrees(significantHeightMetres: number): number {
  const variance = coxMunkSlopeVariance(windRaisingMetresPerSecond(significantHeightMetres));
  return (Math.atan(Math.sqrt(variance)) * 180) / Math.PI;
}

/**
 * The wind, where the file gives one - and it is printed whether or not there is a sea.
 *
 * A wind with no stated sea is not nothing: it bounds how big the sea could have been, and
 * it is the figure a deck log always carries where the wave height almost never is. A force
 * is shown as its class, never as a midpoint, for the same reason a sea state is.
 */
function windRows(conditions: Conditions): string {
  const { wind } = conditions;
  if (!wind) return "";
  return (
    keyValueTable([
      [
        "Wind from",
        wind.fromDegreesTrue === null ? "not stated" : `${wind.fromDegreesTrue} deg true`,
      ],
      ["Wind speed", windSpeed(wind)],
      ["Wind derivation", wind.derivation],
    ]) + forceNote(wind)
  );
}

/**
 * Where a file states a speed AND a force that are not the same wind.
 *
 * The speed is what gets used, being the narrower statement - but eighteen knots and force
 * 9 in one file means one of them is wrong, and using one in silence would leave a reader
 * with no way to know the file disagreed with itself. Nothing here decides which is right.
 */
function forceNote(wind: WindEstimate): string {
  if (wind.statedForceAgrees !== false || wind.statedForce === null) return "";
  return note(
    `The file also states Beaufort force ${wind.statedForce}, which is ` +
      `${beaufortRange(wind.statedForce)}, and the two are not the same wind: the stated ` +
      `${wind.fastestKnots} kn does not fall in it. The speed is used, being the narrower ` +
      "statement, and which of the two is right is not something this tool can decide - but " +
      "the sea drawn from one would not be the sea drawn from the other.",
  );
}

/** A force written out as its class, so a reader can check a disagreement rather than take it. */
function beaufortRange(force: number): string {
  const band = forceClass(force);
  if (!band) return "not a force on the scale";
  if (band.topIsOpen) return `${band.slowestKnots} kn or more`;
  // Calm is "less than 1 knot", not "nought to one": a knot is already force 1.
  if (band.topIsExclusive) return `under ${band.fastestKnots} kn`;
  return `${band.slowestKnots} to ${band.fastestKnots} kn`;
}

/**
 * The speed, said as tightly as the file says it and no tighter.
 *
 * The open end is checked FIRST. Force 12 runs from 64 knots upward, so its two ends are
 * the same number - and a version that tested them for equality before testing for openness
 * printed "64 kn" over a storm with no ceiling, which is the sea state 9 fault again one
 * field over.
 */
function windSpeed(wind: WindEstimate): string {
  if (wind.source === "direction-only") return "not stated";
  if (wind.source === "force" && wind.statedForce !== null) {
    return `force ${wind.statedForce}: ${beaufortRange(wind.statedForce)}`;
  }
  return `${wind.fastestKnots} kn`;
}

/**
 * The wind this was compared against, named the way the file gave it.
 *
 * A force is a class, and quoting its top as though the file had stated 21 knots would put a
 * figure in the reader's hands that nobody wrote down. Calm is worse: its top is EXCLUSIVE -
 * "under 1 knot", and a knot is force 1 - so calling 1 kn "the top of the stated force"
 * offers a speed the class does not contain. The comparison may use it as a supremum, which
 * keeps the warning conservative; the sentence may not present it as a wind.
 *
 * Force 12 cannot arrive here: its top is open, and `seaExceedsWind` declines to compare at
 * all where the wind has no ceiling.
 */
function windCompared(wind: WindEstimate): string {
  const raised = fullyDevelopedHeightMetres(wind.fastestKnots).toFixed(2);
  const band = wind.statedForce === null ? null : forceClass(wind.statedForce);
  if (wind.source === "force" && band?.topIsExclusive) {
    return `the ${raised} m that anything under ${band.fastestKnots} kn could raise at most`;
  }
  const at =
    wind.source === "force"
      ? `the ${wind.fastestKnots} kn at the top of the stated force`
      : `the stated ${wind.fastestKnots} kn`;
  return `the ${raised} m a fully developed sea reaches at ${at}`;
}

/**
 * The one comparison the wind and the sea can be held to, and only in one direction.
 *
 * A sea bigger than the wind can raise is either carrying a swell from another weather
 * system or has been mistranscribed - both worth a reader's attention. A sea smaller than
 * the wind supports is the ordinary case and says nothing, so nothing is said.
 */
function disagreementNote(conditions: Conditions): string {
  if (conditions.seaExceedsWind !== true) return "";
  const { wind, sea } = conditions;
  if (!wind || !sea) return "";
  return note(
    `The stated sea is bigger than the stated wind can raise: ` +
      `${sea.calm.significantHeightMetres} m against ${windCompared(wind)}. Either a swell is ` +
      "running from another weather system - which no wind stated here can account for - or " +
      "one of the two figures is wrong. Both sides are taken the way that makes this hard to " +
      "say: the calmest sea the file allows against the strongest wind it allows. The reverse " +
      "is never reported - a sea smaller than its wind is ordinary, since a sea needs both " +
      "fetch and time to reach what the wind can give it.",
  );
}

function heightRange(sea: SeaEstimate): string {
  const { calm, rough } = sea;
  if (sea.source === "stated") return `${calm.significantHeightMetres} m`;
  if (sea.roughEndIsOpen) return `${rough.significantHeightMetres} m or more`;
  // Sea state 0 is nought to nought, which is not a range and must not be printed as one.
  if (calm.significantHeightMetres === rough.significantHeightMetres) {
    return `${calm.significantHeightMetres} m`;
  }
  return `${calm.significantHeightMetres} to ${rough.significantHeightMetres} m`;
}

/** Where each derived figure came from, in the words the table shows. */
const PERIOD_SOURCE: Record<SeaEstimate["periodFrom"], string> = {
  stated: "stated",
  wind: "from the stated wind",
  height: "assumed from the height",
  none: "none",
};

const DIRECTION_SOURCE: Record<SeaEstimate["directionFrom"], string> = {
  stated: "stated",
  wind: "from the stated wind",
  assumed: "assumed",
};

const NO_SEA =
  "The file states no sea, and the view therefore draws flat water - which is not a " +
  "neutral picture but the strongest claim available, that everything was in sight the " +
  "whole time. An unstated sea is not a calm one.";

/**
 * How much of the time a crest stood between the two.
 *
 * Two halves with quite different standing, and the table keeps them apart. The crest
 * height at which she starts to be hidden is GEOMETRY: an eye height, a target height and a
 * range, assuming nothing about the sea, and it is worth printing even where the file says
 * nothing about the weather. What fraction of the time the sea is over that height needs a
 * sea, and every sea this project has met is a class somebody estimated by eye.
 *
 * The fraction is a pair because four things nobody wrote down go into it - both heights,
 * the wave height and the period - and the width of a sea state class alone can move it by
 * a factor of fifty. Where the two ends agree, that is a finding; where they straddle, the
 * source does not settle the question and the honest output says so.
 */
function occlusion(prepared: Prepared[], scenario: Scenario): string {
  const both = pair(prepared);
  if (!both) return "<p>Needs two actors.</p>";
  const [observer, target] = both;
  const observerVessel = observer.actor.vessel;
  const targetVessel = target.actor.vessel;
  if (!observerVessel || !targetVessel) {
    return "<p>Needs particulars for both ships: every height here is derived from the beam.</p>";
  }

  const cpa = closestPointOfApproach(observer.track, target.track);
  if (!cpa) return "<p>The two tracks do not overlap in time.</p>";

  const at = Date.parse(scenario.meta.occurredAt) / 1000;
  const { sea } = conditionsAt(scenario.origin, scenario.environment, at);
  const sighting = {
    observer,
    target,
    observerVessel,
    targetVessel,
    timeZone: scenario.meta.timeZone,
  };
  return occlusionTable(sighting, cpa.epochSeconds, sea) + note(occlusionCaveat(sighting, sea));
}

function occlusionTable(sighting: Sighting, cpaSeconds: number, sea: SeaEstimate | null): string {
  const rows: string[][] = [];
  for (let back = 420; back >= 0; back -= 60) {
    const row = occlusionRow(sighting, cpaSeconds - back, sea);
    if (row) rows.push(row);
  }
  const head = ["time", "range", "hidden by crests above", "of the time behind one"];
  return dataTable(head, rows);
}

/** One minute of it: how low a crest would do, and how often the sea offers one. */
function occlusionRow(
  sighting: Sighting,
  epochSeconds: number,
  sea: SeaEstimate | null,
): string[] | null {
  const here = sampleAt(sighting.observer.track, epochSeconds);
  const there = sampleAt(sighting.target.track, epochSeconds);
  if (!here || !there) return null;

  const sightline = sightlineOf(sighting, distanceMetres(here.position, there.position));
  return [
    formatClock(epochSeconds, sighting.timeZone),
    `${sightline.rangeMetres.toFixed(0)} m`,
    `${crestOcclusionMetres(sightline).toFixed(2)} m`,
    hiddenCell(sightline, sea),
  ];
}

/**
 * The eye and the target height this section asks about.
 *
 * The top of the superstructure, which is the last of the hull to go: it answers "was any
 * part of her above the sea", not "were her lights". They stand higher and the caveat says
 * so, since the same arithmetic run at a lamp's height gives a different and gentler answer.
 */
function sightlineOf(sighting: Sighting, rangeMetres: number): Sightline {
  return {
    eyeHeightMetres: assumedHeights(sighting.observerVessel).eyeMetres,
    targetHeightMetres: assumedHeights(sighting.targetVessel).superstructureMetres,
    rangeMetres,
  };
}

/**
 * The cell, which has to be the narrower claim of the two on the row.
 *
 * A closed range is printed only where the source closes it. Sea state 9 has no upper
 * bound, so its top figure is a floor and the cell says "or more" - a cell reading
 * "53.1% to 91.4%" over a class that runs to any height at all would be inventing the
 * bound the caveat below it is busy denying.
 */
function hiddenCell(sightline: Sightline, sea: SeaEstimate | null): string {
  if (!sea) return "no sea stated";
  const bounds = occludedFractionBounds(sightline, sea);
  const low = (bounds.lowestFraction * 100).toFixed(1);
  const high = (bounds.highestFraction * 100).toFixed(1);
  // Nothing stands above a hundred per cent, so the open end has nothing left to say.
  const open = bounds.highestFractionIsFloor && bounds.highestFraction < 0.9995;

  if (low === high) return open ? `${low}% or more` : `${low}%`;
  return open ? `${low}% to ${high}% or more` : `${low}% to ${high}%`;
}

/**
 * What the two columns rest on, which is not the same thing at all.
 *
 * The caveat carries the assumptions rather than the table, because a figure printed
 * without them is the fault this project keeps having to fix: a number in a cell reads as
 * measured whatever the prose beside it says, so the prose has to be unmissable and the
 * cell has to be the narrower claim of the two.
 */
function occlusionCaveat(sighting: Sighting, sea: SeaEstimate | null): string {
  const eye = assumedHeights(sighting.observerVessel).eyeMetres;
  const top = assumedHeights(sighting.targetVessel).superstructureMetres;
  return (
    `Both heights are assumed from the beam and neither is recorded: ${eye.toFixed(1)} m for ` +
    `${sighting.observer.actor.id}'s eye and ${top.toFixed(1)} m for the top of ` +
    `${sighting.target.actor.id}'s superstructure - issue #8. Her lights stand higher than ` +
    `that and are correspondingly harder to hide, which this table does not answer for. ` +
    // The biases belong to figures, and where no sea is stated there are none: a caveat
    // qualifying an empty column reads as though something had been computed.
    (sea
      ? "The sea these figures were run against is described in its own section above. " +
        "They count crossings independently, which runs high, and treat the sea as long " +
        "crested along one line, which runs low."
      : "The last column is empty rather than zero, for the reason given under The sea.")
  );
}

function seaCaveat(sea: SeaEstimate): string {
  return `${heightSentence(sea)}${periodSentence(sea)}${directionSentence(sea)} ${tailNote(sea)}`;
}

/**
 * Where the height came from, in the same breath as the height.
 *
 * The derivation is required by the schema precisely so that a reconstructed height and a
 * recorded one cannot be read as the same claim, and the occlusion figures are more
 * sensitive to this number than to anything else on the row. Printing the height without it
 * would put the format's own guarantee back where it started.
 *
 * Sea state 9 gets "or more" rather than a range, both because 14 to 14 is not one and
 * because the class genuinely has no upper end.
 */
function heightSentence(sea: SeaEstimate): string {
  const { calm, rough, derivation } = sea;
  if (sea.source === "stated") {
    return `The file states a significant height of ${calm.significantHeightMetres} m (${derivation}).`;
  }
  if (sea.roughEndIsOpen) {
    // The one class where the drawn sea is the CALMEST the source allows rather than the
    // roughest, because the class has no roughest. That is the weaker picture and so the
    // stronger claim, which is the opposite of every other row and has to be said outright.
    return (
      `Sea state gives a significant height of ${rough.significantHeightMetres} m or more ` +
      `(${derivation}), with nothing above it, so the last column is a floor and not a range. ` +
      `The view draws ${rough.significantHeightMetres} m, which here is the least the class ` +
      "allows rather than the most - the sea shown is the calmest that fits, and a calmer " +
      "picture is the stronger claim about what could be seen."
    );
  }
  if (calm.significantHeightMetres === rough.significantHeightMetres) {
    return `Sea state gives a significant height of ${calm.significantHeightMetres} m (${derivation}).`;
  }
  return (
    `Sea state gives a significant height between ${calm.significantHeightMetres} and ` +
    `${rough.significantHeightMetres} m (${derivation}), and the view draws the rougher end ` +
    "of that - among the seas a class permits, the calmer the picture the stronger its " +
    "claim about what could be seen. Do not measure a wave height off the picture: it is " +
    "one end of the range above, not a figure."
  );
}

/** Only where the file left the period out, since then it is this project's guess and not hers. */
function periodSentence(sea: SeaEstimate): string {
  if (sea.periodFrom === "none") {
    // Nothing about the direction here: `directionSentence` follows immediately and says it,
    // and the first version said it twice over.
    return (
      " The file states a flat sea and no period, so there is none to give. A `Seaway` still " +
      "carries a figure because its fields are numbers, and that figure is not reported " +
      "because it means nothing."
    );
  }
  if (sea.periodFrom === "stated") return "";
  const source =
    sea.periodFrom === "wind" ? "taken forwards from the stated wind" : fromHeight(sea);
  return (
    ` The period is ${sea.rough.peakPeriodSeconds.toFixed(1)} s${end(sea)}, ${source}. ` +
    "Either way it assumes a sea that has stopped growing, which runs long in enclosed " +
    "water and so errs towards saying she was visible."
  );
}

/** `whichEnd` with the spacing, so a sea with no ends reads as a sentence and not a gap. */
function end(sea: SeaEstimate): string {
  const which = whichEnd(sea);
  return which === "" ? "" : ` ${which}`;
}

/**
 * Which end of the class that period belongs to.
 *
 * "The rough end" is the internal name and it is wrong for the one class where the rough end
 * is the calmest sea allowed: state 9's 14 m is a floor, and the sentence above has just
 * finished saying so. Naming it "the rough end" two lines later takes that back.
 */
function whichEnd(sea: SeaEstimate): string {
  if (sea.roughEndIsOpen) return `for the ${sea.rough.significantHeightMetres} m drawn`;
  // A stated height, or a class with no width, has no ends to choose between - and naming
  // one implies a range the file did not give.
  if (sea.calm.significantHeightMetres === sea.rough.significantHeightMetres) return "";
  return "at the rough end";
}

/**
 * Why the height had to supply the period, which depends on what the file withheld.
 *
 * A reader who wrote "force 6" and is told the period was assumed "from the height, the file
 * giving neither a period nor a wind speed" has been told something true and left wondering
 * what happened to their wind. It was declined, and for a reason worth one clause: a force
 * is a class, and taking a period from one means taking a speed out of the middle of it.
 */
function fromHeight(sea: SeaEstimate): string {
  const base = "assumed from the height";
  // "none" cannot arrive: the wind supplied the period in that case and this branch is not
  // taken. Narrowing it away rather than giving it prose keeps an impossible case from
  // having words to say - the alternative was a line of apology in the reader's report.
  return sea.periodDeclined === "none" ? base : `${base}, ${DECLINED[sea.periodDeclined]}`;
}

/**
 * Why the wind was not used, in the reader's own terms.
 *
 * Four of them, and they were two until a stated 150 knots against sea state 9 came back as
 * "too light" - it raises 16.6 m. The class simply has no ceiling, and no finite wind can
 * cover one. Naming the wrong refusal is worse than naming none: it makes a false statement
 * about the reader's own figure and sends them to correct it.
 */
const DECLINED: Record<Exclude<SeaEstimate["periodDeclined"], "none">, string> = {
  "nothing-stated": "the file giving neither a period nor a wind speed",
  "force-is-a-class":
    "the file giving a Beaufort force and no speed - and a force is a class, so taking a " +
    "period from one would mean taking a speed out of the middle of it",
  "wind-too-light": "the stated wind being too light to have raised this sea",
  "sea-has-no-ceiling":
    "the stated sea state having no upper bound - one period is applied across a class, and " +
    "no finite wind can answer for a class that runs past every height",
};

/**
 * Which way the sea runs, and whether anybody said so.
 *
 * A sea state carries no direction, so most scenarios reach the renderer without one - and
 * the renderer still has to draw the water running somewhere. The waves are drawn from a
 * single direction with a narrow spread, which means a reader can take a bearing off the
 * picture, which means an undeclared one is the picture asserting a figure the file does
 * not contain. A wind would settle it properly; the format has no field for one.
 */
function directionSentence(sea: SeaEstimate): string {
  if (sea.directionFrom === "stated") {
    return ` The file puts the sea as coming from ${String(sea.fromDegreesTrue)} degrees true.`;
  }
  if (sea.directionFrom === "wind") {
    return (
      ` Nothing states which way the sea runs, so it is drawn from the stated wind - ` +
      `${String(sea.fromDegreesTrue)} degrees true - because a wind sea runs with the wind. ` +
      "A swell runs from wherever its own storm was, which no wind here can say."
    );
  }
  // Nothing is drawn on a sea of no height - `waveComponents` returns nothing at all for it -
  // so there is no bearing to warn anyone off, and claiming one would be the plainest kind of
  // untruth: describing a wave the picture does not contain.
  if (sea.rough.significantHeightMetres <= 0) {
    return " There are no waves drawn, so no direction is drawn either.";
  }
  // Only a sea state is silent about direction BY ITS NATURE. A file that states a height
  // and omits a bearing simply omitted it, and saying otherwise explains the wrong absence.
  const why =
    sea.source === "sea-state"
      ? " - a sea state does not carry a direction -"
      : ", the file giving a height and no bearing,";
  return (
    ` Nothing states which way the sea runs${why} so ` +
    `the view draws it from ${ASSUMED_DIRECTION_DEGREES_TRUE.toFixed(0)} degrees true, which ` +
    "is a bearing this tool chose and not one the source gives. Do not read a wave direction " +
    "off the picture unless this line says the file supplied it."
  );
}

/**
 * Why the height quoted is not the height of the waves.
 *
 * Takes its end from `whichEnd` like the sentence before it. The first version said "at the
 * rough end" unconditionally and sat immediately after a clause explaining that state 9's
 * 14 m is a floor and the least the class allows - contradicting it in the next breath, and
 * surviving a test that had negated the phrase only where it appeared earlier on the page.
 */
function tailNote(sea: SeaEstimate): string {
  const hs = sea.rough.significantHeightMetres;
  // Nought has no tail, and "the highest tenth averages 0.00 m" says nothing to anybody.
  if (hs <= 0) return "";
  return (
    `Significant height is the mean of the highest third:${end(sea)} the highest tenth ` +
    `averages ${meanOfHighest(hs, 0.1).toFixed(2)} m and the highest hundredth ` +
    `${meanOfHighest(hs, 0.01).toFixed(2)} m.`
  );
}

/**
 * The sea marks, and how much of each one is somebody's word.
 *
 * A mark's position is the whole of what a report usually gives, and it is the part that
 * matters - which side of it she passed. Its shape and its height are what the renderer
 * needs to draw one, they are almost never written down, and on screen an assumed pillar of
 * an assumed height is indistinguishable from a measured one. A can is port hand and a cone
 * starboard, so a shape this tool chose is a statement this tool made.
 *
 * **The two kinds do not answer the same questions, so the table must not read as if they
 * did.** A beacon has no IALA shape and no watch circle, and what it does have below the
 * water is drawn rather than stated; a buoy has both, and the position given for her is her
 * sinker's. One table takes both, so every cell that differs by kind says which is being
 * reported.
 *
 * Absent entirely when a scenario carries no marks, rather than an empty table: a section
 * headed "Sea marks" over nothing invites the reading that there were none.
 */
function marksSection(scenario: Scenario): string[] {
  const marks = scenario.marks ?? [];
  if (marks.length === 0) return [];
  const region = scenario.meta.buoyageRegion ?? null;
  const head = [
    "id",
    "name",
    "kind",
    "purpose",
    "position",
    "form",
    "colours",
    "topmark",
    "height",
    "watch circle",
    "light",
  ];
  const rows = marks.map((mark) => markRow(mark, region));
  return [
    section(
      `Sea marks (${marks.length})`,
      dataTable(head, rows) + notes(marksCaveat(marks, region)),
    ),
  ];
}

function markRow(mark: Mark, region: BuoyageRegion | null): string[] {
  const drawn = drawnAppearance(mark, region);
  return [
    mark.id,
    mark.name ?? "-",
    mark.kind,
    mark.purpose ?? "not stated",
    `${mark.at.lat.toFixed(5)}, ${mark.at.lon.toFixed(5)}`,
    formCell(drawn),
    patternCell(drawn.pattern),
    topmarkCell(drawn),
    heightCell(mark),
    watchCircleCell(mark),
    lightCell(mark, region),
  ];
}

/**
 * Where each part of the drawn mark came from - and this is the whole point of the column.
 *
 * On screen a black-and-yellow the source stated and one this tool worked out from "north
 * cardinal" look exactly alike, and both look like a colour nobody supplied at all. Three
 * origins, three phrasings, never collapsed into two.
 */
function saying<T>(part: From<T>, said: string): string {
  return part.from === "stated" ? said : `${said}, ${part.from}`;
}

/** The IALA body shape for a buoy, and how a beacon is built - which are different axes. */
function formCell(drawn: DrawnMark): string {
  if (drawn.construction) return saying(drawn.construction, drawn.construction.value);
  return drawn.shape ? saying(drawn.shape, drawn.shape.value) : "-";
}

/**
 * The colours as they sit on the body, which is most of what a mark says by daylight.
 *
 * Written the way the buoyage says them - "black over yellow", "red and white stripes" -
 * rather than as a list, because the ORDER is the message: black over yellow is north and
 * yellow over black is south.
 */
function patternCell(pattern: From<MarkPattern>): string {
  const colours = pattern.value.colours;
  const written =
    pattern.value.kind === "solid"
      ? (colours[0] ?? "-")
      : pattern.value.kind === "horizontal bands"
        ? colours.join(" over ")
        : `${colours.join(" and ")} stripes`;
  return saying(pattern, written);
}

/**
 * The shape on top, which for a cardinal mark is the only thing that tells north from south
 * by day.
 *
 * **Three answers.** One drawn, with where it came from; a stated absence, which R1001 allows
 * for in so many words and which is a fact about the mark; and nothing known either way. The
 * middle and the last look alike in the picture - no topmark - and must not look alike here.
 */
function topmarkCell(drawn: DrawnMark): string {
  const topmark = drawn.topmark;
  if (!topmark) return "nothing says";
  // Two statements with nothing to draw for either, and neither is the silence above: the
  // file said there was none, or said there was one without saying what the mark was for.
  if (topmark.value === null) return "none, stated";
  if (topmark.value === "carried one") return "carried one, shape not worked out";
  return saying(topmark, `${topmark.value.colour} ${topmark.value.shape}`);
}

/**
 * The light it carries, and how much of its rhythm is this tool's arithmetic.
 *
 * **Three answers again.** A file that says nothing about a light has not said the mark was
 * unlit - a buoy and a lighted buoy are different marks, and a report omitting the light is
 * the ordinary case. A character nobody can read is a third thing, and it is reported as
 * that rather than quietly drawn as something plainer: reading `Fl(2)` as a single flash
 * turns an isolated-danger mark into a special mark.
 */
function lightCell(mark: Mark, region: BuoyageRegion | null): string {
  const reading = lightOf(mark, region);
  if (!reading.known) {
    return reading.because === "the file does not say whether it carried a light"
      ? "not stated"
      : `stated, unreadable - ${reading.because}`;
  }
  const written = formatCharacter(reading.character);
  // Where the rhythm came from, and separately where its timings did. A rhythm the buoyage
  // supplied is not one the source stated - a north cardinal shows VQ because it is a north
  // cardinal, and the page has to be able to say that rather than appear to quote a report.
  const source = reading.characterFrom === "stated" ? "" : `, ${reading.characterFrom}`;
  const timings = reading.timings === "stated" ? ", timings stated" : "";
  return `${written}${source}${timings}`;
}

/**
 * The height, and what it was measured from - which the number alone does not say.
 *
 * **Above the water for both kinds**, though what is usual differs wildly between them. A
 * beacon's structure carries on below the surface and the picture draws it doing so, but how
 * far down is invented here: nothing states the depth of the ground it stands on. Reporting
 * a beacon's height from its foundation would be quoting a datum the format cannot place.
 */
function heightCell(mark: Mark): string {
  const height =
    mark.heightMetres === undefined
      ? `assumed ${ASSUMED_MARK.heightMetres[mark.kind]} m`
      : `${mark.heightMetres} m`;
  return `${height} above the water`;
}

/**
 * How far a buoy may lie from the position given for her.
 *
 * Three answers, and they must not collapse into two. A beacon has no circle at all, which
 * is the difference between the kinds rather than a gap in the file - it is built where it
 * stands. A buoy always has one; when the file gives no depth or scope its radius is
 * unknown, and printing a dash there would read as "none".
 */
function watchCircleCell(mark: Mark): string {
  if (mark.kind === "beacon") return "none - built where it stands";
  const radius = watchCircleMetres(mark);
  if (radius === null) return "she has one, size not stated";
  return `${radius.toFixed(0)} m about the stated position`;
}

/** The parts of a drawn mark that this tool may have had to choose for itself. */
const CHOOSABLE = ["form", "colours", "height"] as const;
type Choosable = (typeof CHOOSABLE)[number];

/**
 * Which of this mark's drawn properties came from here rather than from the file or from the
 * buoyage.
 *
 * **Read off the same resolution the renderer draws from**, so the count cannot drift from
 * the picture. A part generated from the mark's purpose is not counted: it came from IALA,
 * which is a source, and calling it a choice made here would confess to an invention that
 * did not happen.
 */
function assumedOf(mark: Mark, region: BuoyageRegion | null): Choosable[] {
  const drawn = drawnAppearance(mark, region);
  const chosen: Choosable[] = [];
  const form = drawn.construction ?? drawn.shape;
  if (form && decided(form.from)) chosen.push("form");
  if (decided(drawn.pattern.from)) chosen.push("colours");
  if (mark.heightMetres === undefined) chosen.push("height");
  return chosen;
}

/**
 * How the buoys answer the sea, and the one number in it with no source.
 *
 * A float does not trace the water: below her own natural period she follows it, near it she
 * moves further than it, above it she cannot keep up - and her heave and her lean have
 * different periods, so they peak at different moments. All of that comes out of her draught,
 * which is her geometry. **The damping does not.** It depends on her hull and on whether she
 * carries a heave plate, and the figure used here is chosen - which matters most at
 * resonance, where the response goes as one over twice it.
 */
function ridingNote(marks: Mark[], region: BuoyageRegion | null): string {
  const floats = marks.filter((mark) => mark.kind === "buoy");
  if (floats.length === 0) return "";

  const periods = floats.map((mark) => ridingFor(mark, region));
  const shortest = Math.min(...periods.map((riding) => riding.heavePeriodSeconds));
  const longest = Math.max(...periods.map((riding) => riding.heavePeriodSeconds));
  const range =
    shortest === longest
      ? `${shortest.toFixed(1)} s`
      : `${shortest.toFixed(1)} to ${longest.toFixed(1)} s`;

  const draughts = new Set(periods.map((riding) => riding.draughtFrom));
  const where =
    draughts.size === 1 && draughts.has("stated")
      ? "from the draught the file gives"
      : `from ${[...draughts].join(" and ")}`;

  return (
    `A buoy answers the sea rather than tracing it: her heave has a natural period of ` +
    `${range} here, which rests on her draught alone - the waterplane cancels - taken ` +
    `${where}. So she follows a long swell, moves further than a chop near that period, and ` +
    "falls behind a shorter one. Her lean is given twice that period, which is why the two " +
    `do not peak together. ${WHAT_NOBODY_STATED} ${RIDES_THE_DRAWN_SEA}`
  );
}

/**
 * **The damping is the one figure here with no source**, and the lean is a class rather than
 * a figure at all - so both are said outright rather than left to look computed.
 */
const WHAT_NOBODY_STATED =
  "**The damping is the one figure here with no source**: it depends on the hull and on " +
  `whether she carries a heave plate, and ${(CHOSEN_DAMPING * 100).toFixed(0)} per cent of ` +
  "critical is this tool's own figure. It weighs most at resonance, where the response goes " +
  "as one over twice it - which is to say where this model is least trustworthy. How far " +
  "each shape leans is a class rather than a calculation: a spar buoy exists to stay " +
  "upright, and the ballast that makes her do it is not in any report.";

/**
 * **She is given the sea the picture draws, not the sea the page describes.**
 *
 * Two things take the sea away with distance and both apply to her. The band goes first:
 * every component is dropped where the vertices under it run out, so the chop is gone within
 * a couple of hundred metres while the swell is still there. Then the displaced geometry
 * itself fades between 250 and 600 m, past which the water is drawn flat and she sits still
 * on it - which is #34's rule, not an omission.
 *
 * Naming only the band would say the swell reaches her at any distance, and the page would
 * then be describing water the picture stopped drawing.
 */
const RIDES_THE_DRAWN_SEA =
  "She rides the sea as it is DRAWN under her rather than the sea described above: the chop " +
  "goes out of the water within a couple of hundred metres, where the mesh runs out of " +
  "vertices for it, and the displaced surface itself flattens between 250 and 600 m - so a " +
  "buoy a few hundred metres off answers less than one alongside, and one beyond that lies " +
  "still on water drawn flat. Given the whole spectrum over water drawn without it, she " +
  "would hover.";

/** The same riding the renderer uses, from the same resolved shape. */
function ridingFor(mark: Mark, region: BuoyageRegion | null): Riding {
  const drawn = drawnAppearance(mark, region);
  const height = mark.heightMetres ?? ASSUMED_MARK.heightMetres[mark.kind];
  return ridingOf(drawn.shape?.value ?? CHOSEN.shape, height, mark.draughtMetres);
}

/** Whether this beacon's construction was left to this tool rather than stated. */
function chosenForm(mark: Mark, region: BuoyageRegion | null): boolean {
  return drawnAppearance(mark, region).construction?.from === "chosen here";
}

/**
 * Both kinds of decision this tool makes, and neither kind of thing it was told.
 *
 * Picking the first of the shapes a purpose allows is a smaller decision than picking one
 * with nothing to go on, but it is still this tool deciding - and the count is of what a
 * reader cannot hold the source to.
 */
function decided(origin: Origin): boolean {
  return origin === "chosen here" || origin === "chosen from what its purpose allows";
}

/**
 * What the table cannot show: what was chosen here, and how each kind behaves in the water.
 *
 * Built from what these marks actually are. A page carrying the buoy sentence over a lone
 * beacon, or the beacon sentence over a fleet of buoys, is the picture and the page
 * disagreeing in prose - the failure `plans/done/antenna-offset-6.md` records.
 */
function marksCaveat(marks: Mark[], region: BuoyageRegion | null): string[] {
  const parts = [assumedNote(marks, region), lightNote(marks, region)];
  if (marks.some((m) => m.kind === "buoy")) {
    parts.push(
      "A buoy is drawn riding the sea as the water is drawn beneath her, which past a few " +
        "hundred metres has faded flat - so a distant buoy stops heaving because the water " +
        "under her has, not because the sea has. Her stated position is her sinker's, not " +
        "hers.",
    );
  }
  const rides = ridingNote(marks, region);
  if (rides !== "") parts.push(rides);
  if (marks.some((m) => m.kind === "beacon")) {
    parts.push(
      "A beacon neither heaves nor tilts: it is built on the ground it marks, the sea runs " +
        "past it, and the position given for it is the structure's own. Its height is the " +
        "part above the water; it is drawn carrying on below the surface onto a footing, " +
        "and how far down that goes is this tool standing it on something rather than a " +
        "depth anybody stated.",
    );
  }
  // And only where a beacon's form was not stated. The format has the vocabulary now - a
  // tower, a lattice, a column, a pile - so a page that called a stated lattice this tool's
  // choice would contradict the cell above it, which says the file gave it.
  if (marks.some((mark) => mark.kind === "beacon" && chosenForm(mark, region))) {
    parts.push(
      "How a beacon is built means nothing - a lattice tower and a concrete column can both " +
        "be a north cardinal - but something has to be on the screen, and where the file does " +
        "not say, the form drawn is this tool's.",
    );
  }
  return parts.filter((part) => part !== "");
}

const SHAPE_CLAUSE =
  " - and a can is port hand where a cone is starboard, so a shape drawn here is a " +
  "statement made here (issue #34)";

/**
 * What the drawn rhythm is, and is not.
 *
 * Only where a light was actually stated, and only about the ones whose timings this tool
 * worked out: a page that explained an inference nobody made would be as misleading as one
 * that made an inference and never explained it.
 */
function lightNote(marks: Mark[], region: BuoyageRegion | null): string {
  const readings = marks.map((mark) => lightOf(mark, region));
  if (!readings.some((reading) => reading.known)) return "";

  const inferred = readings.filter((r) => r.known && r.timings === "inferred").length;
  // Two lights in one scene start together here, because nothing says otherwise. A file has
  // nowhere to put the phase of one against another, and a viewer watching two marks flash
  // in step would be reading a relationship out of the picture that nobody stated.
  const together =
    readings.filter((reading) => reading.known).length > 1
      ? " Where more than one mark is lit, all of them start their sequence at the same " +
        "instant: nothing states the phase of one light against another, so any two that " +
        "appear to keep step here are keeping step for that reason."
      : "";
  const drawn =
    "A light is drawn from a bridge at night and nowhere else: a chart is not a moment, so " +
    "the plan view does not blink, and a light is not what a mark looks like by day. It is " +
    "drawn at whatever range the mark is in view at, which overstates a real one - a light " +
    "has a nominal range, and the format has nowhere to put it yet." +
    together;
  if (inferred === 0) return drawn;
  return (
    `The timings of ${inferred} of these are this tool's. An abbreviation says how often a ` +
    "light flashes and not how long the flash lasts - IALA Recommendation E-110 bounds the " +
    "split within the period without fixing it, and the rest comes from that light's own " +
    `Light List entry. What is drawn conforms to those bounds; it is not what was seen. ${drawn}`
  );
}

/**
 * What was chosen here rather than read from the file, **counted field by field**.
 *
 * A count of marks over a union of fields reads as a claim about each of them: one buoy
 * missing only her shape beside one beacon missing only its colour becomes "2 of 2 carry a
 * shape or colour this tool chose", which says the beacon was given a shape - a field it
 * cannot have at all. The cells above are right and the sentence under them is not, which is
 * the page making the stronger claim, one layer down.
 */
function assumedNote(marks: Mark[], region: BuoyageRegion | null): string {
  const counted = CHOOSABLE.map((field) => ({ field, ...tally(marks, field, region) })).filter(
    (entry) => entry.count > 0,
  );
  if (counted.length === 0) return "";

  const list = andList(
    counted.map((entry) => `a ${entry.field} for ${entry.count} of ${entry.of}`),
  );
  // The buoyage clause is about IALA body SHAPES - a can is port hand, a cone starboard - so
  // it belongs to a buoy whose shape was chosen here and not to a beacon whose construction
  // was. A beacon's form means nothing, and saying it does is the page overclaiming again.
  const shapes = marks.some(
    (mark) => mark.kind === "buoy" && assumedOf(mark, region).includes("form"),
  )
    ? SHAPE_CLAUSE
    : "";
  return (
    `Decided here rather than stated: ${list}${shapes}. Each cell above says which kind of ` +
    "decision it was - a value the buoyage fixes, one it allows several of, or one with " +
    "nothing to go on at all."
  );
}

/**
 * How many marks needed this field chosen for them, and how many could have carried it.
 *
 * **The denominator is not always every mark.** Only a buoy has an IALA shape, so counting
 * beacons into it would report a gap in marks that have no such field to fill.
 */
function tally(
  marks: Mark[],
  field: Choosable,
  region: BuoyageRegion | null,
): { count: number; of: number } {
  return {
    count: marks.filter((mark) => assumedOf(mark, region).includes(field)).length,
    of: marks.length,
  };
}

/** "a", "a and b", "a, b and c". */
function andList(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1] ?? ""}`;
}

function findingList(findings: Finding[], scenario: Scenario): string {
  if (findings.length === 0) return "<p>Nothing implausible.</p>";
  const rows = findings.map((f) => [
    f.actorId,
    formatClock(f.fromEpochSeconds, scenario.meta.timeZone),
    f.kind,
    f.message,
  ]);
  return dataTable(["actor", "from", "kind", "detail"], rows);
}

/** A line under a table saying what the figures in it are, and are not. */
function note(text: string): string {
  return `<p style="color:var(--muted)">${escapeHtml(text)}</p>`;
}

/**
 * Several notes under one table, each as its own paragraph.
 *
 * The sea marks section has four things to say - what was chosen here, what the drawn rhythm
 * is, how a buoy rides, how a beacon stands - and run together they are a wall nobody reads
 * to the end of. A caveat that is not read is not a caveat.
 */
function notes(texts: string[]): string {
  return texts
    .filter((text) => text !== "")
    .map((text) => note(text))
    .join("");
}

export function section(title: string, body: string): string {
  return `<section><h2>${escapeHtml(title)}</h2><div class="scroll">${body}</div></section>`;
}

function keyValueTable(rows: [string, string][]): string {
  return `<table>${rows
    .map(([k, v]) => `<tr><th>${escapeHtml(k)}</th><td>${escapeHtml(v)}</td></tr>`)
    .join("")}</table>`;
}

function dataTable(head: string[], rows: string[][]): string {
  const thead = `<tr>${head.map((h) => `<th>${escapeHtml(h)}</th>`).join("")}</tr>`;
  const tbody = rows
    .map((r) => `<tr>${r.map((c) => `<td>${escapeHtml(c)}</td>`).join("")}</tr>`)
    .join("");
  return `<table>${thead}${tbody}</table>`;
}

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c] ?? c);
}
