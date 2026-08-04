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

async function main(): Promise<void> {
  const panels = must("#panels", HTMLElement);
  const subtitle = must("#subtitle", HTMLElement);
  const url = new URLSearchParams(location.search).get("scenario") ?? DEFAULT_SCENARIO;

  let raw: unknown;
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    raw = (await response.json()) as unknown;
  } catch (error) {
    subtitle.textContent = "load failed";
    panels.innerHTML = section("Load failed", `<p class="warn">${escapeHtml(String(error))}</p>`);
    return;
  }

  const validation = validateScenario(raw);
  if (!validation.valid) {
    subtitle.textContent = "does not match the schema";
    panels.innerHTML = section(
      "Schema",
      `<p class="warn">${validation.errors.map(escapeHtml).join("<br>")}</p>`,
    );
    return;
  }

  const scenario = parseScenario(raw);
  const prepared = scenario.actors.map((actor) => ({
    actor,
    track: prepareActor(actor, scenario.origin),
  }));

  panels.innerHTML = renderPanels(scenario, prepared);
  must("#stage", HTMLElement).hidden = false;

  const replay = new Replay(must("#view", HTMLCanvasElement), scenario);
  subtitle.textContent = `${scenario.meta.title} - ${formatDate(replay.startSeconds, scenario.meta.timeZone)}`;

  wireControls(replay, scenario);
}

function wireControls(replay: Replay, scenario: Scenario): void {
  const views = must("#views", HTMLElement);
  const playPause = must("#playPause", HTMLButtonElement);
  const speed = must("#speed", HTMLSelectElement);
  const clock = must("#clock", HTMLElement);
  const scrub = must("#scrub", HTMLInputElement);
  const record = must("#record", HTMLButtonElement);

  const span = replay.endSeconds - replay.startSeconds;
  const viewButtons: { button: HTMLButtonElement; view: ViewSelection }[] = [];

  const addView = (label: string, view: ViewSelection) => {
    const button = document.createElement("button");
    button.textContent = label;
    button.addEventListener("click", () => {
      replay.setView(view);
      for (const entry of viewButtons) {
        entry.button.setAttribute("aria-pressed", String(entry.view === view));
      }
    });
    views.append(button);
    viewButtons.push({ button, view });
  };

  addView("Overhead", { kind: "overhead" });
  for (const id of replay.actorIds) addView(`${id} bridge`, { kind: "bridge", actorId: id });
  viewButtons[0]?.button.setAttribute("aria-pressed", "true");

  const paint = () => {
    clock.textContent = `${formatClock(replay.timeSeconds, scenario.meta.timeZone)} local`;
    scrub.value = String(
      Math.round(((replay.timeSeconds - replay.startSeconds) / span) * SCRUB_STEPS),
    );
    playPause.textContent = replay.isPlaying ? "Pause" : "Play";
  };

  // The clock has to keep up with playback, which advances on its own animation frames -
  // but ONLY while it is playing. An unconditional rAF loop repaints the clock sixty
  // times a second at a standstill, which is not merely wasted work: it keeps the main
  // thread busy enough that anything waiting for an idle moment (a screenshot, an
  // extension, the profiler) never gets one.
  let following = false;
  const follow = () => {
    paint();
    if (replay.isPlaying) requestAnimationFrame(follow);
    else following = false;
  };
  const startFollowing = () => {
    if (following) return;
    following = true;
    requestAnimationFrame(follow);
  };

  playPause.addEventListener("click", () => {
    if (replay.isPlaying) replay.pause();
    else {
      replay.play();
      startFollowing();
    }
    paint();
  });

  speed.addEventListener("change", () => {
    replay.setSpeed(Number(speed.value));
  });
  replay.setSpeed(Number(speed.value));

  scrub.max = String(SCRUB_STEPS);
  scrub.addEventListener("input", () => {
    replay.pause();
    replay.seek(replay.startSeconds + (Number(scrub.value) / SCRUB_STEPS) * span);
    paint();
  });

  window.addEventListener("resize", () => {
    replay.resize();
  });

  paint();
  wireRecording(record, replay, scenario, startFollowing);
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
    if (recorder.isRecording) {
      void recorder.stop().then((recording) => {
        downloadRecording(recording, slug(scenario.meta.title));
        button.textContent = "Record";
        button.classList.remove("recording");
      });
      replay.pause();
      return;
    }

    // Rewind first: a recording that starts halfway through is not what anyone wants,
    // and remembering to scrub back every time is exactly the kind of step people skip.
    replay.seek(replay.startSeconds);
    recorder.start();
    replay.play();
    startFollowing();
    button.textContent = "Stop";
    button.classList.add("recording");
  });
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
