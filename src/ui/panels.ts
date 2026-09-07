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
import { hullCentreOffset } from "../actors/vessel/reference-point.js";
import { bearingDegrees, distanceMetres, normaliseDegrees } from "../core/geodesy.js";
import { conditionsAt, type Conditions } from "../core/conditions.js";
import { crestOcclusionMetres, type Sightline } from "../core/horizon.js";
import { checkPlausibility, type Finding } from "../core/plausibility.js";
import { isNight } from "../render/scene.js";
import { ASSUMED_DIRECTION_DEGREES_TRUE, meanOfHighest, type SeaEstimate } from "../core/seaway.js";
import { occludedFractionBounds } from "../core/visibility.js";
import { formatClock } from "../core/time.js";
import {
  closestPointOfApproach,
  sampleAt,
  type PreparedTrack,
  type SampledState,
} from "../core/track.js";
import type { Actor, Mark, Scenario, Vessel } from "../core/types.js";

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
    ]) + note(skyCaveat(conditions))
  );
}

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
  return (
    "The view draws a fine day, because a sky has to be drawn and cloud is the one thing " +
    "that would decide it - which nothing states. "
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

  return (
    keyValueTable([
      ["Between", `${first.actor.id} and ${second.actor.id}`],
      ["At", `${formatClock(cpa.epochSeconds, scenario.meta.timeZone)} local`],
      ["Range", `${cpa.metres.toFixed(0)} m (${(cpa.metres / 1852).toFixed(2)} NM)`],
    ]) + note(approachCaveat(both, cpa.epochSeconds))
  );
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
    seaCaveat(sea)
  );
}

function seaCaveat(sea: SeaEstimate | null): string {
  if (!sea) {
    return (
      "The file states no sea, so the last column is empty rather than zero: an unstated " +
      "sea is not a calm one, and the view's flat water is the strongest claim available."
    );
  }
  return (
    `${heightSentence(sea)}${periodSentence(sea)}${directionSentence(sea)} ${tailNote(sea)} ` +
    `The figures count crossings ` +
    "independently, which runs high, and treat the sea as long crested along one line, which " +
    "runs low."
  );
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
  if (!sea.periodAssumed) return "";
  return (
    ` The period is assumed from the height (${sea.rough.peakPeriodSeconds.toFixed(1)} s at the ` +
    "rough end), which runs long in enclosed water and so errs towards saying she was visible."
  );
}

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
  if (sea.fromDegreesTrue !== null) {
    return ` The file puts the sea as coming from ${sea.fromDegreesTrue.toFixed(0)} degrees true.`;
  }
  return (
    ` Nothing states which way the sea runs - a sea state does not carry a direction - so ` +
    `the view draws it from ${ASSUMED_DIRECTION_DEGREES_TRUE.toFixed(0)} degrees true, which ` +
    "is a bearing this tool chose and not one the source gives. Do not read a wave direction " +
    "off the picture unless this line says the file supplied it."
  );
}

/** Why the rough end is not the height of the waves. */
function tailNote(sea: SeaEstimate): string {
  const hs = sea.rough.significantHeightMetres;
  return (
    `Significant height is the mean of the highest third: at the rough end the highest tenth ` +
    `averages ${meanOfHighest(hs, 0.1).toFixed(2)} m and the highest hundredth ` +
    `${meanOfHighest(hs, 0.01).toFixed(2)} m.`
  );
}

/**
 * The buoys, and how much of each one is somebody's word.
 *
 * A mark's position is the whole of what a report usually gives, and it is the part that
 * matters - which side of it she passed. Its shape and its height are what the renderer
 * needs to draw one, they are almost never written down, and on screen an assumed pillar of
 * an assumed height is indistinguishable from a measured one. A can is port hand and a cone
 * starboard, so a shape this tool chose is a statement this tool made.
 *
 * Absent entirely when a scenario carries no marks, rather than an empty table: a section
 * headed "Sea marks" over nothing invites the reading that there were none.
 */
function marksSection(scenario: Scenario): string[] {
  const marks = scenario.marks ?? [];
  if (marks.length === 0) return [];
  const head = ["id", "name", "position", "shape", "colour", "height"];
  const rows = marks.map((mark) => [
    mark.id,
    mark.name ?? "-",
    `${mark.at.lat.toFixed(5)}, ${mark.at.lon.toFixed(5)}`,
    stated(mark.shape, "pillar"),
    stated(mark.colour, "yellow"),
    mark.heightMetres === undefined ? "assumed 2.4 m" : `${mark.heightMetres} m`,
  ]);
  return [section(`Sea marks (${marks.length})`, dataTable(head, rows) + note(marksCaveat(marks)))];
}

/** What the file said, or what was drawn in its place - never the two looking alike. */
function stated(value: string | undefined, fallback: string): string {
  return value ?? `assumed ${fallback}`;
}

function marksCaveat(marks: Mark[]): string {
  const assumed = marks.filter((m) => !m.shape || !m.colour || m.heightMetres === undefined);
  const drawn =
    "A mark is drawn riding the sea as the water is drawn beneath it, which past a few " +
    "hundred metres has faded flat - so a distant buoy stops heaving because the water " +
    "under it has, not because the sea has. It follows the surface exactly, which is right " +
    "for something small against the wave and wrong in a short steep sea: issue #32.";
  if (assumed.length === 0) return drawn;
  return (
    `${assumed.length} of ${marks.length} carry a shape, colour or height this tool chose ` +
    "rather than the source - and a can is port hand where a cone is starboard, so a shape " +
    `drawn here is a statement made here (issue #34). ${drawn}`
  );
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
