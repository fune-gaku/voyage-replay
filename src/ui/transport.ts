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

import type { LocalPosition } from "../core/geodesy.js";
import { formatClock } from "../core/time.js";
import { clampElevation, type ViewSelection } from "../render/view.js";

/** How many positions the scrub bar has between the start and the end of the tracks. */
const SCRUB_STEPS = 1000;

/**
 * What the pointer does over the picture, which is not quite the same list as the viewpoints.
 *
 * The chart is dragged and zoomed and the sea view is orbited and ranged. A bridge is
 * neither - `placeBridgeCamera` faces the bow and holds the horizon level, and both of those
 * are claims about what a watchkeeper saw rather than camera settings - and a `free` eye is
 * stated outright by whoever built it, so a drag would have nowhere to write. Hence `fixed`
 * for the two of them: the name says what the pointer can do, because that is what this is.
 */
type Mode = "chart" | "orbit" | "fixed";

/**
 * Where the eye stands, and what it stands off. See `render/view.ts`.
 *
 * `centre` is null until the sea view is first opened, which is when it is taken - from
 * wherever the frame was already looking. After that only a click on the chart or Recentre
 * moves it: a viewpoint that drifts while somebody is reading it is the thing #67 removed.
 */
interface Orbit {
  centre: LocalPosition | null;
  azimuthDegrees: number;
  elevationDegrees: number;
  distanceMetres: number;
}

interface Viewpoint {
  mode: Mode;
  orbit: Orbit;
}

/**
 * Degrees of orbit per pixel dragged. About twelve hundred pixels for a full turn, which is
 * a wide canvas end to end - far enough that a small correction is possible, near enough
 * that getting to the other side is one drag rather than four.
 */
const ORBIT_DEGREES_PER_PIXEL = 0.3;
const ORBIT_NEAREST_METRES = 50;
const ORBIT_FURTHEST_METRES = 1_000_000;

/**
 * Where the sea view opens, the first time it is asked for.
 *
 * The eye due SOUTH of the action, so it looks north and north is away from the reader -
 * which is where north is on the chart it was just switched from. Half way up, because
 * either end is a special case: the zenith is the chart again without the chart's furniture,
 * and the surface is a bridge without a ship under it.
 *
 * The range is taken from what the chart was showing rather than fixed, so the first frame
 * out at sea holds what the frame before it held. A 55 degree lens covers 1.04 times its
 * distance vertically, so the extent IS the distance to within a rounding.
 */
const ORBIT_OPENING = { azimuthDegrees: 180, elevationDegrees: 45 };

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
  /** Where the action is, asked once by whatever opens the sea view. See `render/player.ts`. */
  readonly actionCentre: LocalPosition;
  /** Take the ground under a point of the picture as the place to look at, and say which. */
  lookAtPixels(dxPixels: number, dyPixels: number): LocalPosition;
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
  /**
   * The scale, which belongs to the chart alone, so it can leave the bar when the chart
   * does. **Recentre is not in it**: standing off a fixed place is exactly when a stated way
   * back to the ships is wanted, so it stays up in the sea view too and goes only on a
   * bridge, where there is nothing to recentre.
   *
   * **Hidden rather than disabled.** They were disabled, which is the same statement to a
   * screen reader and a different one to an eye: a control that is present and does nothing
   * reads as broken, and both of these are meaningless from a wheelhouse rather than
   * temporarily unavailable. What is left when they go is what playback needs - the views,
   * play, the speed, the clock and the bar.
   */
  chartControls: HTMLElement;
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
  // Zero range says the sea view has not been opened yet, which is what `enter` seeds from.
  const viewpoint: Viewpoint = {
    mode: "chart",
    // No centre and no range yet: `enter` takes both from the frame the first time the sea
    // view is opened, so it starts holding what the picture before it held.
    orbit: { ...ORBIT_OPENING, centre: null, distanceMetres: 0 },
  };

  wireViews(parts, viewpoint);
  wireSpeed(parts);
  wireScale(parts, viewpoint);
  wireDrag(parts, viewpoint);
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

/**
 * The three viewpoints: the chart, the sea around the action, and each ship's wheelhouse.
 *
 * "Sea" rather than "free" or "orbit" because the label answers a reader's question rather
 * than naming the mechanism - it is the view from off the ship, out on the water, and the
 * two names for how the camera gets there are this file's business.
 */
function wireViews(parts: TransportParts, viewpoint: Viewpoint): void {
  const buttons: { button: HTMLButtonElement; view: ViewSelection }[] = [];

  const add = (label: string, view: ViewSelection): void => {
    const button = document.createElement("button");
    button.textContent = label;
    button.addEventListener("click", () => {
      enter(parts, viewpoint, view);
      for (const entry of buttons) {
        entry.button.setAttribute("aria-pressed", String(entry.view === view));
      }
    });
    parts.views.append(button);
    buttons.push({ button, view });
  };

  add("Chart", { kind: "chart" });
  // The stored numbers are a placeholder: `enter` rebuilds the view from the live orbit,
  // whose centre and range are not known until the button is pressed. Identity is all this
  // copy is for.
  add("Sea", { kind: "orbit", ...ORBIT_OPENING, centre: { east: 0, north: 0 }, distanceMetres: 0 });
  for (const id of parts.replay.actorIds) add(`${id} bridge`, { kind: "bridge", actorId: id });

  buttons[0]?.button.setAttribute("aria-pressed", "true");
  parts.canvas.style.cursor = "grab";
}

/** Take up a viewpoint: tell the replay, and leave the bar carrying what that view can use. */
function enter(parts: TransportParts, viewpoint: Viewpoint, view: ViewSelection): void {
  viewpoint.mode = modeFor(view);
  if (view.kind === "orbit") {
    // Taken once, from what the frame was already showing, and remembered afterwards: a
    // reader who has moved the sea view and then glanced at the chart has not asked to lose
    // it, and one who has picked a place to watch from has not asked to be moved off it.
    if (viewpoint.orbit.centre === null) viewpoint.orbit = opened(parts, viewpoint.orbit);
    parts.replay.setView(orbitView(viewpoint.orbit));
  } else {
    parts.replay.setView(view);
  }

  parts.chartControls.hidden = view.kind !== "chart";
  // Recentre stays up in the sea view: standing off a fixed place is exactly when a stated
  // way back to the ships is wanted. Only a bridge has nothing to recentre.
  parts.recentre.hidden = view.kind === "bridge";
  // A canvas that offers to be dragged where dragging does nothing makes the same promise a
  // dead button does. The bridge is the one view with nothing to move.
  parts.canvas.style.cursor = view.kind === "bridge" ? "" : "grab";
}

function modeFor(view: ViewSelection): Mode {
  if (view.kind === "chart") return "chart";
  return view.kind === "orbit" ? "orbit" : "fixed";
}

/** Where the sea view stands when it is first opened: what the frame was already showing. */
function opened(parts: TransportParts, orbit: Orbit): Orbit {
  return {
    ...orbit,
    centre: parts.replay.actionCentre,
    distanceMetres: clampRange(parts.replay.planExtentMetres),
  };
}

/**
 * The view as the replay wants it. A centre that has not been taken yet cannot be drawn
 * from, so it falls back to the origin - which no caller reaches, `enter` having filled it
 * in before this is ever asked for a view to draw.
 */
function orbitView(orbit: Orbit): ViewSelection {
  const { centre, ...rest } = orbit;
  return { kind: "orbit", ...rest, centre: centre ?? { east: 0, north: 0 } };
}

function clampRange(metres: number): number {
  return Math.min(Math.max(metres, ORBIT_NEAREST_METRES), ORBIT_FURTHEST_METRES);
}

/**
 * Turn the eye round the action, and raise or lower it.
 *
 * **Both signs are "grab the world"**, which is what the chart's drag already means: pull to
 * the right and the sea turns to the right under the eye, so the eye has gone the other way
 * round; pull down and the far side comes up, so the eye has climbed. The elevation is
 * clamped where it is held rather than only where it is used, or dragging past the top and
 * back leaves the picture dead until the surplus is unwound.
 */
function orbitBy(parts: TransportParts, viewpoint: Viewpoint, dx: number, dy: number): void {
  const orbit = viewpoint.orbit;
  viewpoint.orbit = {
    ...orbit,
    azimuthDegrees: orbit.azimuthDegrees + dx * ORBIT_DEGREES_PER_PIXEL,
    elevationDegrees: clampElevation(orbit.elevationDegrees + dy * ORBIT_DEGREES_PER_PIXEL),
  };
  parts.replay.setView(orbitView(viewpoint.orbit));
}

/** Move the eye in or out along the same bearing. The wheel's other job. */
function rangeBy(parts: TransportParts, viewpoint: Viewpoint, factor: number): void {
  viewpoint.orbit = {
    ...viewpoint.orbit,
    distanceMetres: clampRange(viewpoint.orbit.distanceMetres * factor),
  };
  parts.replay.setView(orbitView(viewpoint.orbit));
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
function wireScale(parts: TransportParts, viewpoint: Viewpoint): void {
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

  wireWheel(parts, viewpoint, (metres: number): void => {
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
function wireWheel(parts: TransportParts, viewpoint: Viewpoint, zoomTo: (m: number) => void): void {
  const { replay, scale, canvas } = parts;
  const ladder = ladderOf(scale);
  const closest = ladder[0] ?? 200;
  const widest = ladder.at(-1) ?? 1_000_000;

  canvas.addEventListener(
    "wheel",
    (event: WheelEvent) => {
      // From a bridge there is no range to change: the eye is where the ship's eye was.
      // The wheel is left alone so the page scrolls as it normally would.
      if (viewpoint.mode === "fixed") return;
      event.preventDefault();

      // Away from the reader is further off, which is which way round both a map and a
      // camera work. From what is on screen, not from what was last chosen: on automatic
      // nothing has been chosen, and the first turn would otherwise jump to an end.
      const factor = WHEEL_ZOOM_PER_NOTCH ** (event.deltaY / WHEEL_NOTCH);
      if (viewpoint.mode === "orbit") rangeBy(parts, viewpoint, factor);
      else zoomTo(Math.min(Math.max(replay.planExtentMetres * factor, closest), widest));
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
/** Where a press began and where it has got to, which is all a drag needs to remember. */
interface Press {
  began: { x: number; y: number } | null;
  last: { x: number; y: number } | null;
}

function wireDrag(parts: TransportParts, viewpoint: Viewpoint): void {
  const { canvas } = parts;
  const press: Press = { began: null, last: null };

  canvas.addEventListener("pointerdown", (event: PointerEvent) => {
    // From a bridge there is nothing to drag: where the eye stands and which way it faces
    // are the ship's, and moving them would be answering a different question.
    if (viewpoint.mode === "fixed") return;
    event.preventDefault();
    press.last = { x: event.clientX, y: event.clientY };
    press.began = press.last;
    canvas.setPointerCapture(event.pointerId);
    canvas.style.cursor = "grabbing";
  });

  canvas.addEventListener("pointermove", (event: PointerEvent) => {
    dragTo(parts, viewpoint, press, event);
  });

  canvas.addEventListener("pointerup", (event: PointerEvent) => {
    // A press that has not moved is a choice of where to watch from, not a pan of no
    // distance - and only the chart is a place to choose on.
    if (press.began && viewpoint.mode === "chart" && !moved(press.began, event)) {
      chooseCentre(parts, viewpoint, event);
    }
    release(parts, viewpoint, press);
  });

  canvas.addEventListener("pointercancel", () => {
    release(parts, viewpoint, press);
  });

  wireRecentre(parts, viewpoint);
}

/** The chart slides; the sea turns. One gesture, and what it moves is the picture's. */
function dragTo(
  parts: TransportParts,
  viewpoint: Viewpoint,
  press: Press,
  event: PointerEvent,
): void {
  if (!press.last) return;
  const dx = event.clientX - press.last.x;
  const dy = event.clientY - press.last.y;
  if (viewpoint.mode === "chart") parts.replay.panByPixels(dx, dy);
  else orbitBy(parts, viewpoint, dx, dy);
  press.last = { x: event.clientX, y: event.clientY };
}

function release(parts: TransportParts, viewpoint: Viewpoint, press: Press): void {
  press.began = null;
  press.last = null;
  parts.canvas.style.cursor = viewpoint.mode === "fixed" ? "" : "grab";
}

/**
 * Back to the ships, which is two things at once.
 *
 * The chart follows them again. The sea view follows nothing - that is the whole of #67 - so
 * it is stood over them as they are NOW, once, and then holds still there. A control that
 * put one of the two back and not the other would leave the page in a state neither view
 * could be read out of.
 */
function wireRecentre({ replay, recentre }: TransportParts, viewpoint: Viewpoint): void {
  recentre.addEventListener("click", () => {
    replay.recentre();
    if (viewpoint.orbit.centre === null) return;
    viewpoint.orbit = { ...viewpoint.orbit, centre: replay.actionCentre };
    if (viewpoint.mode === "orbit") replay.setView(orbitView(viewpoint.orbit));
  });
}

/**
 * Whether a press was a drag or a click. Under a few pixels is a hand holding still, not a
 * pan of no distance - and a touchscreen or a pen never delivers a press that has not moved
 * at all.
 */
const CLICK_SLOP_PIXELS = 4;

function moved(began: { x: number; y: number }, event: PointerEvent): boolean {
  return Math.hypot(event.clientX - began.x, event.clientY - began.y) > CLICK_SLOP_PIXELS;
}

/**
 * A click on the chart picks the place the sea view stands off.
 *
 * **The frame goes to it**, which is what makes the choice visible without putting another
 * mark on a drawing that already carries a grid, track lines and sea marks - and the ground
 * it was is answered by the replay rather than worked out here, so the chart and the sea
 * view cannot come to disagree about which spot was picked. Issue #67.
 */
function chooseCentre(parts: TransportParts, viewpoint: Viewpoint, event: PointerEvent): void {
  const box = parts.canvas.getBoundingClientRect();
  const centre = parts.replay.lookAtPixels(
    event.clientX - box.left - box.width / 2,
    event.clientY - box.top - box.height / 2,
  );
  viewpoint.orbit = {
    ...viewpoint.orbit,
    centre,
    // A range as well, the first time: the sea view has to open at some distance and the one
    // the chart is showing is the only one anybody has asked for.
    distanceMetres: viewpoint.orbit.distanceMetres || clampRange(parts.replay.planExtentMetres),
  };
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
