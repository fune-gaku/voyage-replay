/**
 * Wiring: fetch a scenario, put it on the canvas, hook up the controls.
 *
 * The analysis this page used to print is still here, under the picture - the 3D view
 * shows what happened, the panels say what the data is and whether it can be trusted.
 */

import { prepareActor } from "./core/track.js";
import type { Scenario } from "./core/types.js";
import { parseScenario, validateScenario } from "./core/validate.js";
import { Replay, type ViewSelection } from "./render/player.js";
import { CanvasRecorder, downloadRecording, isRecordingSupported } from "./render/record.js";
import { escapeHtml, formatClock, formatDate, renderPanels, section } from "./ui/panels.js";

const DEFAULT_SCENARIO = "/suo-nada-2025-11-27.voyage.json";
const SCRUB_STEPS = 1000;

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

  wireControls(replay, scenario);
}

function wireControls(replay: Replay, scenario: Scenario): void {
  const paint = painter(replay, scenario);
  const startFollowing = follower(replay, paint);

  wireViews(replay);
  wireSpeed(replay);
  wirePlayPause(replay, paint, startFollowing);
  wireScrub(replay, paint);
  window.addEventListener("resize", () => {
    replay.resize();
  });

  paint();
  wireRecording(must("#record", HTMLButtonElement), replay, scenario, startFollowing);
}

/** Everything the controls say about where playback has got to. */
function painter(replay: Replay, scenario: Scenario): () => void {
  const clock = must("#clock", HTMLElement);
  const playPause = must("#playPause", HTMLButtonElement);
  const scrub = must("#scrub", HTMLInputElement);
  const span = replay.endSeconds - replay.startSeconds;

  return () => {
    clock.textContent = `${formatClock(replay.timeSeconds, scenario.meta.timeZone)} local`;
    scrub.value = String(
      Math.round(((replay.timeSeconds - replay.startSeconds) / span) * SCRUB_STEPS),
    );
    playPause.textContent = replay.isPlaying ? "Pause" : "Play";
  };
}

/**
 * The clock has to keep up with playback, which advances on its own animation frames -
 * but ONLY while it is playing. An unconditional rAF loop repaints the clock sixty times
 * a second at a standstill, which is not merely wasted work: it keeps the main thread
 * busy enough that anything waiting for an idle moment (a screenshot, an extension, the
 * profiler) never gets one.
 */
function follower(replay: Replay, paint: () => void): () => void {
  let following = false;

  const follow = (): void => {
    paint();
    if (replay.isPlaying) requestAnimationFrame(follow);
    else following = false;
  };

  return () => {
    if (following) return;
    following = true;
    requestAnimationFrame(follow);
  };
}

function wireViews(replay: Replay): void {
  const views = must("#views", HTMLElement);
  const buttons: { button: HTMLButtonElement; view: ViewSelection }[] = [];

  const add = (label: string, view: ViewSelection): void => {
    const button = document.createElement("button");
    button.textContent = label;
    button.addEventListener("click", () => {
      replay.setView(view);
      for (const entry of buttons) {
        entry.button.setAttribute("aria-pressed", String(entry.view === view));
      }
    });
    views.append(button);
    buttons.push({ button, view });
  };

  add("Overhead", { kind: "overhead" });
  for (const id of replay.actorIds) add(`${id} bridge`, { kind: "bridge", actorId: id });
  buttons[0]?.button.setAttribute("aria-pressed", "true");
}

function wireSpeed(replay: Replay): void {
  const speed = must("#speed", HTMLSelectElement);
  speed.addEventListener("change", () => {
    replay.setSpeed(Number(speed.value));
  });
  replay.setSpeed(Number(speed.value));
}

function wirePlayPause(replay: Replay, paint: () => void, startFollowing: () => void): void {
  const playPause = must("#playPause", HTMLButtonElement);
  playPause.addEventListener("click", () => {
    if (replay.isPlaying) replay.pause();
    else {
      replay.play();
      startFollowing();
    }
    paint();
  });
}

function wireScrub(replay: Replay, paint: () => void): void {
  const scrub = must("#scrub", HTMLInputElement);
  const span = replay.endSeconds - replay.startSeconds;

  scrub.max = String(SCRUB_STEPS);
  scrub.addEventListener("input", () => {
    replay.pause();
    replay.seek(replay.startSeconds + (Number(scrub.value) / SCRUB_STEPS) * span);
    paint();
  });
}

function wireRecording(
  button: HTMLButtonElement,
  replay: Replay,
  scenario: Scenario,
  startFollowing: () => void,
): void {
  if (!isRecordingSupported()) {
    button.disabled = true;
    button.title = "this browser cannot record the canvas";
    return;
  }

  const recorder = new CanvasRecorder(must("#view", HTMLCanvasElement));
  button.addEventListener("click", () => {
    if (recorder.isRecording) stopRecording(recorder, replay, button, scenario);
    else startRecording(recorder, replay, button, startFollowing);
  });
}

/**
 * Rewind first: a recording that starts halfway through is not what anyone wants, and
 * remembering to scrub back every time is exactly the kind of step people skip.
 */
function startRecording(
  recorder: CanvasRecorder,
  replay: Replay,
  button: HTMLButtonElement,
  startFollowing: () => void,
): void {
  replay.seek(replay.startSeconds);
  recorder.start();
  replay.play();
  startFollowing();
  button.textContent = "Stop";
  button.classList.add("recording");
}

function stopRecording(
  recorder: CanvasRecorder,
  replay: Replay,
  button: HTMLButtonElement,
  scenario: Scenario,
): void {
  void recorder.stop().then((recording) => {
    downloadRecording(recording, slug(scenario.meta.title));
    button.textContent = "Record";
    button.classList.remove("recording");
  });
  replay.pause();
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

function slug(title: string): string {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "voyage-replay"
  );
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
