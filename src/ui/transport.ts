/**
 * The controls under the picture: play, speed, the scrub bar, the clock, the view buttons.
 *
 * This is here rather than in `main.ts` for the reason the Record button is: `follower`
 * below is an asynchronous state machine, and the thing it guards against - a repaint loop
 * that keeps running after playback has stopped - is invisible when it goes wrong. The
 * page looks right and quietly never goes idle again. That is not something to check by
 * reading, so it lives somewhere a test can drive it.
 *
 * Nothing here looks anything up in the document. Every element is handed in, which is the
 * whole of what makes that possible; `main.ts` keeps the lookups.
 */

import type { ViewSelection } from "../render/player.js";
import { formatClock } from "./panels.js";

/** How many positions the scrub bar has between the start and the end of the tracks. */
const SCRUB_STEPS = 1000;

/** The part of the Replay the controls drive. Narrow on purpose - it is all that is used. */
export interface TransportPlayback {
  readonly startSeconds: number;
  readonly endSeconds: number;
  readonly timeSeconds: number;
  readonly isPlaying: boolean;
  readonly actorIds: string[];
  setView(view: ViewSelection): void;
  setSpeed(multiplier: number): void;
  seek(epochSeconds: number): void;
  play(): void;
  pause(): void;
  resize(): void;
}

export interface TransportParts {
  replay: TransportPlayback;
  clock: HTMLElement;
  playPause: HTMLButtonElement;
  scrub: HTMLInputElement;
  speed: HTMLSelectElement;
  views: HTMLElement;
  /** The zone the source report's own times are in. */
  timeZone: string;
}

export interface Transport {
  /** Bring every control up to date with where playback has got to. */
  paint: () => void;
  /** Begin following playback, if something is not already following it. */
  startFollowing: () => void;
}

export function wireTransport(parts: TransportParts): Transport {
  const paint = painter(parts);
  const startFollowing = follower(parts.replay, paint);

  wireViews(parts);
  wireSpeed(parts);
  wirePlayPause(parts, paint, startFollowing);
  wireScrub(parts, paint);

  paint();
  return { paint, startFollowing };
}

/** Everything the controls say about where playback has got to. */
function painter({ replay, clock, playPause, scrub, timeZone }: TransportParts): () => void {
  const span = replay.endSeconds - replay.startSeconds;

  return () => {
    clock.textContent = `${formatClock(replay.timeSeconds, timeZone)} local`;
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
 *
 * Hence the flag, which is doing two jobs. It stops a second loop being started while one
 * is already running, and it is cleared by the loop itself on the frame after playback
 * stops - so the next press starts following again rather than finding the flag stuck on
 * and never repainting the clock at all.
 */
function follower(replay: TransportPlayback, paint: () => void): () => void {
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

function wireViews({ replay, views }: TransportParts): void {
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

function wireSpeed({ replay, speed }: TransportParts): void {
  speed.addEventListener("change", () => {
    replay.setSpeed(Number(speed.value));
  });
  replay.setSpeed(Number(speed.value));
}

function wirePlayPause(
  { replay, playPause }: TransportParts,
  paint: () => void,
  startFollowing: () => void,
): void {
  playPause.addEventListener("click", () => {
    if (replay.isPlaying) replay.pause();
    else {
      replay.play();
      startFollowing();
    }
    paint();
  });
}

function wireScrub({ replay, scrub }: TransportParts, paint: () => void): void {
  const span = replay.endSeconds - replay.startSeconds;

  scrub.max = String(SCRUB_STEPS);
  scrub.addEventListener("input", () => {
    // Dragging the bar is a deliberate move to a moment, so it stops playback rather than
    // fighting it: leaving it running would have the next frame drag the handle back.
    replay.pause();
    replay.seek(replay.startSeconds + (Number(scrub.value) / SCRUB_STEPS) * span);
    paint();
  });
}
