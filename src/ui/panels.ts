/**
 * The text under the picture.
 *
 * The 3D view shows what happened; these say what the data is and whether it can be
 * trusted - where each track came from, whether a heading was ever recorded, how close
 * the two actually came, and anything a ship could not physically have done. A
 * reconstruction without them is an animation.
 */

import { describeAspect, visibleLights } from "../actors/vessel/lights.js";
import { hullCentreOffset } from "../actors/vessel/reference-point.js";
import { bearingDegrees, distanceMetres, normaliseDegrees } from "../core/geodesy.js";
import { conditionsAt, type Conditions } from "../core/conditions.js";
import { checkPlausibility, type Finding } from "../core/plausibility.js";
import { formatClock } from "../core/time.js";
import {
  closestPointOfApproach,
  sampleAt,
  type PreparedTrack,
  type SampledState,
} from "../core/track.js";
import type { Actor, Scenario, Vessel } from "../core/types.js";

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
