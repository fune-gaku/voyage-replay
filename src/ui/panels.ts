/**
 * The text under the picture.
 *
 * The 3D view shows what happened; these say what the data is and whether it can be
 * trusted - where each track came from, whether a heading was ever recorded, how close
 * the two actually came, and anything a ship could not physically have done. A
 * reconstruction without them is an animation.
 */

import { describeAspect, visibleLights } from "../actors/vessel/lights.js";
import { bearingDegrees, distanceMetres, normaliseDegrees } from "../core/geodesy.js";
import { checkPlausibility, type Finding } from "../core/plausibility.js";
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
    section("Actors", actorTable(prepared)),
    section("Closest approach", approach(prepared, scenario)),
    section("What each ship showed the other", aspects(prepared, scenario)),
    section(`Plausibility screening (${findings.length})`, findingList(findings, scenario)),
  ].join("");
}

/** Wall-clock in the zone the source report's own times refer to. */
export function formatClock(epochSeconds: number, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date(epochSeconds * 1000));
}

export function formatDate(epochSeconds: number, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "short",
    day: "2-digit",
  }).format(new Date(epochSeconds * 1000));
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

function actorTable(prepared: Prepared[]): string {
  const head = ["id", "name", "LOA", "beam", "points", "derivation", "position at", "heading?"];
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
      `${withHeading}/${track.points.length}`,
    ];
  });
  return dataTable(head, rows);
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

  const offsets = first.actor.vessel?.referencePointOffsets;
  const caveat = offsets
    ? `Reported positions are the GPS antenna. On ${first.actor.id} the antenna sits ` +
      `${offsets.fromBowMetres} m from the bow, so this is not the gap between hulls.`
    : "";

  return (
    keyValueTable([
      ["Between", `${first.actor.id} and ${second.actor.id}`],
      ["At", `${formatClock(cpa.epochSeconds, scenario.meta.timeZone)} local`],
      ["Range", `${cpa.metres.toFixed(0)} m (${(cpa.metres / 1852).toFixed(2)} NM)`],
    ]) + (caveat ? `<p style="color:var(--muted)">${escapeHtml(caveat)}</p>` : "")
  );
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
  return dataTable(["time", `bearing of ${target.actor.id}`, "range", "aspect"], rows);
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
