/**
 * Development page.
 *
 * There is no renderer yet. What this does is the half of the job that has to be right
 * before any of it is worth drawing: load a scenario, check it against the schema, screen
 * it against physics, and work out the aspect each ship presented to the other. When the
 * 3D view lands it grows out of this file; until then, this is how you tell whether a
 * newly extracted scenario is any good.
 */

import { describeAspect, visibleLights } from "./actors/vessel/lights.js";
import { bearingDegrees, distanceMetres, normaliseDegrees } from "./core/geodesy.js";
import { checkPlausibility, type Finding } from "./core/plausibility.js";
import {
  closestPointOfApproach,
  prepareActor,
  sampleAt,
  type PreparedTrack,
} from "./core/track.js";
import type { Actor, Scenario } from "./core/types.js";
import { parseScenario, validateScenario } from "./core/validate.js";

const DEFAULT_SCENARIO = "/suo-nada-2025-11-27.voyage.json";

interface Prepared {
  actor: Actor;
  track: PreparedTrack;
}

const app = document.querySelector<HTMLElement>("#app");
if (!app) throw new Error("#app is missing");

void main(app);

async function main(root: HTMLElement): Promise<void> {
  const url = new URLSearchParams(location.search).get("scenario") ?? DEFAULT_SCENARIO;

  let raw: unknown;
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    raw = (await response.json()) as unknown;
  } catch (error) {
    root.innerHTML = section("Load failed", `<p class="warn">${escapeHtml(String(error))}</p>`);
    return;
  }

  const validation = validateScenario(raw);
  if (!validation.valid) {
    root.innerHTML = section(
      "Schema",
      `<p class="warn">${validation.errors.map(escapeHtml).join("<br>")}</p>`,
    );
    return;
  }

  root.innerHTML = render(parseScenario(raw));
}

function render(scenario: Scenario): string {
  const prepared: Prepared[] = scenario.actors.map((actor) => ({
    actor,
    track: prepareActor(actor, scenario.origin),
  }));

  const findings = prepared.flatMap((p) => checkPlausibility(p.track, p.actor.vessel));

  return [
    section("Scenario", overview(scenario)),
    section("Actors", actorTable(prepared)),
    section("Closest approach", approach(prepared)),
    section("What each ship showed the other", aspects(prepared)),
    section(`Plausibility screening (${findings.length})`, findingList(findings)),
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

/** The two actors a two-ship analysis needs, or null with the reason it cannot run. */
function pair(prepared: Prepared[]): [Prepared, Prepared] | null {
  const [first, second] = prepared;
  return first && second ? [first, second] : null;
}

function approach(prepared: Prepared[]): string {
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
      ["At", new Date(cpa.epochSeconds * 1000).toISOString()],
      ["Range", `${cpa.metres.toFixed(0)} m (${(cpa.metres / 1852).toFixed(2)} NM)`],
    ]) + (caveat ? `<p style="color:var(--muted)">${escapeHtml(caveat)}</p>` : "")
  );
}

function aspects(prepared: Prepared[]): string {
  const both = pair(prepared);
  if (!both) return "<p>Needs two actors.</p>";
  const [first, second] = both;

  const vessel = second.actor.vessel;
  if (!vessel) return `<p>${escapeHtml(second.actor.id)} carries no vessel particulars.</p>`;

  const cpa = closestPointOfApproach(first.track, second.track);
  if (!cpa) return "<p>The two tracks do not overlap in time.</p>";

  const rows: string[][] = [];
  for (let back = 420; back >= 0; back -= 60) {
    const t = cpa.epochSeconds - back;
    const here = sampleAt(first.track, t);
    const there = sampleAt(second.track, t);
    if (!here || !there) continue;

    const clock = new Date(t * 1000).toISOString().slice(11, 19);
    const range = distanceMetres(here.position, there.position);
    const bearing = bearingDegrees(here.position, there.position);

    // Heading is what fixes a ship's light arcs. Where the source did not supply it -
    // a Class B transponder never does - say so rather than quietly using the course.
    const heading = there.headingDegreesTrue;
    const standIn = heading ?? there.cogDegreesTrue;
    const seen =
      standIn === undefined
        ? "no heading and no course: cannot say"
        : describeAspect(visibleLights(vessel, normaliseDegrees(bearing + 180 - standIn))) +
          (heading === undefined ? " (from course over ground)" : "");

    rows.push([
      `${clock}Z`,
      `${bearing.toFixed(1)} deg`,
      `${range.toFixed(0)} m`,
      `${first.actor.id} sees: ${seen}`,
    ]);
  }
  return dataTable(["time", `bearing of ${second.actor.id}`, "range", "aspect"], rows);
}

function findingList(findings: Finding[]): string {
  if (findings.length === 0) return "<p>Nothing implausible.</p>";
  const rows = findings.map((f) => [
    f.actorId,
    new Date(f.fromEpochSeconds * 1000).toISOString().slice(11, 19) + "Z",
    f.kind,
    f.message,
  ]);
  return dataTable(["actor", "from", "kind", "detail"], rows);
}

function section(title: string, body: string): string {
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

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c] ?? c);
}
