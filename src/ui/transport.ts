/**
 * The controls under the picture: play, speed, scale, the scrub bar, the clock, the views.
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

import { formatClock } from "../core/time.js";
import type { ViewSelection } from "../render/player.js";

/** How many positions the scrub bar has between the start and the end of the tracks. */
const SCRUB_STEPS = 1000;

/** The scale option that hands the plan view back to following the ships. */
const AUTO_SCALE = "auto";

/** The option the wheel writes the scale it arrived at into. */
const MANUAL_SCALE = "manual";

/**
 * What one notch of the wheel multiplies the scale by, and why it is a multiplier.
 *
 * Stepping the menu's own ladder was the first version and it was not smooth: every notch
 * jumped two to three times the scale, and a trackpad - which sends a stream of small
 * deltas where a mouse sends one notch of about a hundred - either did nothing or crossed
 * the whole range. Scaling by an exponent of the delta gives both of them the same feel,
 * because what a zoom control is really moving is the logarithm.
 *
 * A quarter per notch, so the whole range is about fifty notches end to end.
 */
const WHEEL_ZOOM_PER_NOTCH = 1.25;
const WHEEL_NOTCH = 100;

/** The part of the Replay the controls drive. Narrow on purpose - it is all that is used. */
export interface TransportPlayback {
  readonly startSeconds: number;
  readonly endSeconds: number;
  readonly timeSeconds: number;
  readonly isPlaying: boolean;
  readonly actorIds: string[];
  /** What the plan view is showing now, so a wheel starts from where the picture is. */
  readonly planExtentMetres: number;
  setView(view: ViewSelection): void;
  setSpeed(multiplier: number): void;
  setScale(extentMetres: number | null): void;
  panByPixels(dxPixels: number, dyPixels: number): void;
  recentre(): void;
  seek(epochSeconds: number): void;
  play(): void;
  pause(): void;
  resize(): void;
}

export interface TransportParts {
  replay: TransportPlayback;
  /** Where the picture is. Wanted here only so the wheel over it can change the scale. */
  canvas: HTMLCanvasElement;
  clock: HTMLElement;
  playPause: HTMLButtonElement;
  scrub: HTMLInputElement;
  speed: HTMLSelectElement;
  /** Metres of sea from the top of the plan view to the bottom, or "auto". */
  scale: HTMLSelectElement;
  /** Hands the plan view back to following the ships after it has been dragged. */
  recentre: HTMLButtonElement;
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
  wireScale(parts);
  wireDrag(parts);
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

function wireViews({ replay, views, scale, recentre, canvas }: TransportParts): void {
  const buttons: { button: HTMLButtonElement; view: ViewSelection }[] = [];

  const add = (label: string, view: ViewSelection): void => {
    const button = document.createElement("button");
    button.textContent = label;
    button.addEventListener("click", () => {
      replay.setView(view);
      // Both belong to the plan view. Left live from a wheelhouse they are controls that
      // change nothing on screen, which reads as ones that are broken - and a canvas
      // offering to be dragged when dragging it does nothing is the same promise.
      const plan = view.kind === "overhead";
      scale.disabled = !plan;
      recentre.disabled = !plan;
      canvas.style.cursor = plan ? "grab" : "";
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
  canvas.style.cursor = "grab";
}

function wireSpeed({ replay, speed }: TransportParts): void {
  speed.addEventListener("change", () => {
    replay.setSpeed(Number(speed.value));
  });
  replay.setSpeed(Number(speed.value));
}

/**
 * How much sea the plan view shows, or "auto" to let it follow the ships.
 *
 * Automatic framing is the right default and the wrong thing to be stuck with. It opens
 * out to nearly twice the separation, so early in an encounter the ships are specks, and
 * it closes to a few ship lengths at contact whether or not that is the moment being
 * looked at. A stated scale is also the only way two frames can be compared: a distance
 * read off a picture whose zoom moved on its own means nothing.
 */
function wireScale(parts: TransportParts): void {
  const { replay, scale } = parts;
  const manual = document.createElement("option");
  manual.value = MANUAL_SCALE;
  scale.append(manual);
  let manualMetres = 0;

  const apply = (): void => {
    if (scale.value === AUTO_SCALE) replay.setScale(null);
    else if (scale.value === MANUAL_SCALE) replay.setScale(manualMetres);
    else replay.setScale(Number(scale.value));
  };
  scale.addEventListener("change", apply);
  apply();

  wireWheel(parts, (metres: number): void => {
    manualMetres = metres;
    manual.textContent = `Scale: ${formatScale(metres)}`;
    scale.value = MANUAL_SCALE;
    apply();
  });
}

/**
 * The wheel over the picture, zooming smoothly and telling the menu where it got to.
 *
 * Smoothly, and the menu still names the result. Those pull against each other - the menu
 * offers round numbers and the wheel arrives between them - and the way out is an option
 * whose label the wheel rewrites, so however far it is turned the control still says what
 * scale the picture is at. This view exists to have distances read off it, and a scale
 * nothing states is worse than no scale.
 */
function wireWheel({ replay, scale, canvas }: TransportParts, zoomTo: (m: number) => void): void {
  const ladder = ladderOf(scale);
  const closest = ladder[0] ?? 200;
  const widest = ladder.at(-1) ?? 1_000_000;

  canvas.addEventListener(
    "wheel",
    (event: WheelEvent) => {
      // The same question the menu already answers: from a bridge the scale cannot be
      // changed, so the wheel is left alone and the page scrolls as it normally would.
      if (scale.disabled) return;
      event.preventDefault();

      // From what is on screen, not from what was last chosen: on automatic nothing has
      // been chosen, and the first turn would otherwise jump to an end of the range.
      // Away from the reader is a bigger number, which is which way round a map works.
      const factor = WHEEL_ZOOM_PER_NOTCH ** (event.deltaY / WHEEL_NOTCH);
      zoomTo(Math.min(Math.max(replay.planExtentMetres * factor, closest), widest));
    },
    // Refused otherwise: a wheel listener is passive by default, and a passive one cannot
    // stop the page scrolling underneath the zoom.
    { passive: false },
  );
}

/** The scales the menu offers, in metres. The markup stays the only place they are listed. */
function ladderOf(scale: HTMLSelectElement): number[] {
  return Array.from(scale.options)
    .map((option) => Number(option.value))
    .filter((metres) => Number.isFinite(metres) && metres > 0)
    .sort((a, b) => a - b);
}

/** Round enough to read at a glance, exact enough to be the scale it claims to be. */
function formatScale(metres: number): string {
  if (metres < 1000) return `${Math.round(metres)} m`;
  if (metres < 10000) return `${(metres / 1000).toFixed(1)} km`;
  return `${Math.round(metres / 1000)} km`;
}

/**
 * Dragging the plan view, and the way back.
 *
 * The frame follows the ships by default, which is right until it is not: an approach is
 * often best watched from over the headland one of them is rounding, or from the buoy the
 * report keeps naming, and neither of those is where the midpoint of two tracks happens to
 * be. So the centre can be taken over the way the scale can - and, like the scale, it
 * needs a stated way back rather than a knack.
 *
 * Pointer events rather than mouse ones, so a trackpad, a touchscreen and a pen all work
 * without three sets of handlers. The capture is what makes a drag survive the pointer
 * leaving the canvas: without it, dragging past the edge stops the pan there and the map
 * sticks to the pointer when it comes back.
 */
function wireDrag({ replay, canvas, scale, recentre }: TransportParts): void {
  let last: { x: number; y: number } | null = null;

  canvas.addEventListener("pointerdown", (event: PointerEvent) => {
    // `disabled` is the same question asked once: from a bridge there is nothing to drag.
    if (scale.disabled) return;
    event.preventDefault();
    last = { x: event.clientX, y: event.clientY };
    canvas.setPointerCapture(event.pointerId);
    canvas.style.cursor = "grabbing";
  });

  canvas.addEventListener("pointermove", (event: PointerEvent) => {
    if (!last) return;
    replay.panByPixels(event.clientX - last.x, event.clientY - last.y);
    last = { x: event.clientX, y: event.clientY };
  });

  const release = (): void => {
    last = null;
    canvas.style.cursor = scale.disabled ? "" : "grab";
  };
  canvas.addEventListener("pointerup", release);
  canvas.addEventListener("pointercancel", release);

  recentre.addEventListener("click", () => {
    replay.recentre();
  });
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
