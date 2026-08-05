/**
 * Wiring: fetch a scenario, put it on the canvas, hook up the controls.
 *
 * The analysis this page used to print is still here, under the picture - the 3D view
 * shows what happened, the panels say what the data is and whether it can be trusted.
 */

import { prepareActor } from "./core/track.js";
import type { Scenario, ScenarioMeta } from "./core/types.js";
import { parseScenario, validateScenario } from "./core/validate.js";
import { Replay } from "./render/player.js";
import { escapeHtml, formatDate, renderPanels, section } from "./ui/panels.js";
import { wireRecordingButton } from "./ui/recording-button.js";
import { wireTransport } from "./ui/transport.js";

const DEFAULT_SCENARIO = "/suo-nada-2025-11-27.voyage.json";

void main();

/** The two places on the page the analysis is written into. They always travel together. */
interface Report {
  panels: HTMLElement;
  subtitle: HTMLElement;
}

async function main(): Promise<void> {
  const report: Report = {
    panels: must("#panels", HTMLElement),
    subtitle: must("#subtitle", HTMLElement),
  };
  const url = new URLSearchParams(location.search).get("scenario") ?? DEFAULT_SCENARIO;

  let raw: unknown;
  try {
    raw = readInlineScenario() ?? (await fetchScenario(url));
  } catch (error) {
    fail(report, "load failed", "Load failed", escapeHtml(String(error)));
    return;
  }

  const validation = validateScenario(raw);
  if (!validation.valid) {
    const detail = validation.errors.map(escapeHtml).join("<br>");
    fail(report, "does not match the schema", "Schema", detail);
    return;
  }

  show(parseScenario(raw), report);
}

/**
 * Put the failure where the analysis would have gone.
 *
 * A tool that makes claims about what happened has to be visibly unable to make one,
 * rather than showing an empty page and leaving the reason in a console nobody has open.
 */
function fail(report: Report, status: string, title: string, detail: string): void {
  report.subtitle.textContent = status;
  report.panels.innerHTML = section(title, `<p class="warn">${detail}</p>`);
}

function show(scenario: Scenario, report: Report): void {
  const prepared = scenario.actors.map((actor) => ({
    actor,
    track: prepareActor(actor, scenario.origin),
  }));

  report.panels.innerHTML = renderPanels(scenario, prepared);
  must("#stage", HTMLElement).hidden = false;

  const replay = new Replay(must("#view", HTMLCanvasElement), scenario);
  const when = formatDate(replay.startSeconds, scenario.meta.timeZone);
  report.subtitle.textContent = `${scenario.meta.title} - ${when}`;

  wireControls(replay, scenario.meta);
}

/** Look every control up, hand them over, and hook the two halves together. */
function wireControls(replay: Replay, meta: ScenarioMeta): void {
  const { startFollowing } = wireTransport({
    replay,
    clock: must("#clock", HTMLElement),
    playPause: must("#playPause", HTMLButtonElement),
    scrub: must("#scrub", HTMLInputElement),
    speed: must("#speed", HTMLSelectElement),
    views: must("#views", HTMLElement),
    timeZone: meta.timeZone,
  });

  window.addEventListener("resize", () => {
    replay.resize();
  });

  wireRecordingButton({
    button: must("#record", HTMLButtonElement),
    canvas: must("#view", HTMLCanvasElement),
    replay,
    title: meta.title,
    onStart: startFollowing,
  });
}

/**
 * A single-file build embeds the scenario in the page, which is what lets the result be
 * opened straight off the filesystem: `fetch` of a sibling file is blocked under file://,
 * so a page that has to go and get its data is a page that needs a web server.
 */
function readInlineScenario(): unknown {
  const element = document.querySelector("#scenario");
  const text = element?.textContent?.trim();
  if (!text) return null;
  return JSON.parse(text) as unknown;
}

async function fetchScenario(url: string): Promise<unknown> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return (await response.json()) as unknown;
}

/**
 * Look an element up and check it is the kind expected.
 *
 * The obvious version takes the type as a parameter and casts, which asserts something
 * about the page that nothing verifies - ask for a canvas, get a div, and the failure
 * surfaces much later as a missing method. Passing the constructor makes it a real check.
 */
function must<T extends Element>(selector: string, kind: new () => T): T {
  const element = document.querySelector(selector);
  if (!element) throw new Error(`${selector} is missing from the page`);
  if (!(element instanceof kind)) {
    throw new Error(`${selector} is a ${element.tagName.toLowerCase()}, not a ${kind.name}`);
  }
  return element;
}
