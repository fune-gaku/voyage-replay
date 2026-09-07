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
import { lightOf } from "../actors/mark/light.js";
import { watchCircleMetres } from "../actors/mark/mooring.js";
import { formatCharacter } from "../core/light-character.js";
import { ASSUMED_MARK } from "../render/mark.js";
import { isNight } from "../render/scene.js";
import {
  ASSUMED_DIRECTION_DEGREES_TRUE,
  forceClass,
  fullyDevelopedHeightMetres,
  meanOfHighest,
  type SeaEstimate,
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
      : `fog is drawn out to the stated ${visibilityMetres} m`;
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

  const rows: [string, string][] = [
    ["From", sea.source === "stated" ? "figures in the file" : "the stated sea state"],
    ["Significant height", heightRange(sea)],
    [
      "Peak period",
      sea.periodFrom === "none"
        ? "no waves to have one"
        : `${sea.rough.peakPeriodSeconds.toFixed(1)} s (${PERIOD_SOURCE[sea.periodFrom]})`,
    ],
    [
      "Coming from",
      // Keyed on the DIRECTION's own provenance, not the period's. A file may state a
      // bearing on a sea of no height - a decayed swell has one - and hiding it because the
      // period is absent denies a figure the file contains.
      sea.directionFrom !== "stated" && sea.rough.significantHeightMetres <= 0
        ? "no waves to come from anywhere"
        : sea.fromDegreesTrue === null
          ? `${ASSUMED_DIRECTION_DEGREES_TRUE.toFixed(0)} deg (assumed - nothing states it)`
          : `${sea.fromDegreesTrue.toFixed(0)} deg true (${DIRECTION_SOURCE[sea.directionFrom]})`,
    ],
    ["Derivation", sea.derivation],
  ];
  return wind + keyValueTable(rows) + note(seaCaveat(sea));
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
  const head = [
    "id",
    "name",
    "kind",
    "position",
    "shape",
    "colour",
    "height",
    "watch circle",
    "light",
  ];
  const rows = marks.map((mark) => [
    mark.id,
    mark.name ?? "-",
    mark.kind,
    `${mark.at.lat.toFixed(5)}, ${mark.at.lon.toFixed(5)}`,
    shapeCell(mark),
    stated(mark.colour, ASSUMED_MARK.colour),
    heightCell(mark),
    watchCircleCell(mark),
    lightCell(mark),
  ]);
  return [
    section(`Sea marks (${marks.length})`, dataTable(head, rows) + notes(marksCaveat(marks))),
  ];
}

/**
 * What the file said, or what was drawn in its place - never the two looking alike.
 *
 * The fallbacks come from `render/mark.ts` rather than being written out again here. Two
 * copies drift, and when they do the page names a shape the picture is not drawing, which
 * is the exact thing this column exists to prevent.
 */
function stated(value: string | undefined, fallback: string): string {
  return value ?? `assumed ${fallback}`;
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
function lightCell(mark: Mark): string {
  const reading = lightOf(mark);
  if (!reading.known) {
    return reading.because === "the file does not say whether it carried a light"
      ? "not stated"
      : `stated, unreadable - ${reading.because}`;
  }
  const written = formatCharacter(reading.character);
  return reading.timings === "stated" ? `${written}, timings stated` : written;
}

/**
 * The body shape, where the mark is the kind that has one.
 *
 * A beacon has no IALA shape - the schema refuses one - so nothing was assumed in its place.
 * But something is on the screen, and the form drawn there was chosen here: the format has no
 * vocabulary for towers, lattices, columns and piles yet (issue #42). Reporting the field as
 * simply empty would leave the picture making the only statement about it.
 */
function shapeCell(mark: Mark): string {
  if (mark.kind === "beacon") return "a structure, form chosen here";
  return stated(mark.shape, ASSUMED_MARK.shape);
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

/** The fields a mark may leave unstated, which this tool then has to choose to draw one. */
const CHOOSABLE = ["shape", "colour", "height"] as const;
type Choosable = (typeof CHOOSABLE)[number];

/**
 * Which of this mark's drawn properties came from here rather than from the source.
 *
 * **A beacon's shape is not among them.** It has no IALA shape to state, so nothing was
 * assumed in its place, and counting the empty field as an assumption would have the page
 * confessing to a choice the renderer never made.
 */
function assumedOf(mark: Mark): Choosable[] {
  const chosen: Choosable[] = [];
  if (mark.kind === "buoy" && mark.shape === undefined) chosen.push("shape");
  if (mark.colour === undefined) chosen.push("colour");
  if (mark.heightMetres === undefined) chosen.push("height");
  return chosen;
}

/**
 * What the table cannot show: what was chosen here, and how each kind behaves in the water.
 *
 * Built from what these marks actually are. A page carrying the buoy sentence over a lone
 * beacon, or the beacon sentence over a fleet of buoys, is the picture and the page
 * disagreeing in prose - the failure `plans/done/antenna-offset-6.md` records.
 */
function marksCaveat(marks: Mark[]): string[] {
  const parts = [assumedNote(marks), lightNote(marks)];
  if (marks.some((m) => m.kind === "buoy")) {
    parts.push(
      "A buoy is drawn riding the sea as the water is drawn beneath her, which past a few " +
        "hundred metres has faded flat - so a distant buoy stops heaving because the water " +
        "under her has, not because the sea has. She follows the surface exactly, which is " +
        "right for something small against the wave and wrong in a short steep sea: issue " +
        "#32. Her stated position is her sinker's, not hers.",
    );
  }
  if (marks.some((m) => m.kind === "beacon")) {
    parts.push(
      "A beacon neither heaves nor tilts: it is built on the ground it marks, the sea runs " +
        "past it, and the position given for it is the structure's own. Its height is the " +
        "part above the water; it is drawn carrying on below the surface onto a footing, " +
        "and how far down that goes is this tool standing it on something rather than a " +
        "depth anybody stated. What kind of structure - a tower, a lattice, a column, a " +
        "pile - is a vocabulary this format does not have either, so the one on screen is " +
        "this tool's: issue #42.",
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
function lightNote(marks: Mark[]): string {
  const readings = marks.map(lightOf);
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
function assumedNote(marks: Mark[]): string {
  const counted = CHOOSABLE.map((field) => ({ field, ...tally(marks, field) })).filter(
    (entry) => entry.count > 0,
  );
  if (counted.length === 0) return "";

  const list = andList(
    counted.map((entry) => `a ${entry.field} for ${entry.count} of ${entry.of}`),
  );
  const shapes = counted.some((entry) => entry.field === "shape") ? SHAPE_CLAUSE : "";
  return `Chosen here rather than taken from the source: ${list}${shapes}.`;
}

/**
 * How many marks needed this field chosen for them, and how many could have carried it.
 *
 * **The denominator is not always every mark.** Only a buoy has an IALA shape, so counting
 * beacons into it would report a gap in marks that have no such field to fill.
 */
function tally(marks: Mark[], field: Choosable): { count: number; of: number } {
  const eligible = field === "shape" ? marks.filter((m) => m.kind === "buoy") : marks;
  return {
    count: eligible.filter((m) => assumedOf(m).includes(field)).length,
    of: eligible.length,
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
