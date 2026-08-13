import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ViewSelection } from "../src/render/player.js";
import { wireTransport, type TransportParts, type TransportPlayback } from "../src/ui/transport.js";

/** An element that remembers what was attached to it and what was done to it. */
interface Fake {
  textContent: string;
  value: string;
  max: string;
  disabled: boolean;
  style: Record<string, string>;
  options: { value: string }[];
  listeners: Record<string, ((event?: unknown) => void)[]>;
  appended: Fake[];
  attributes: Record<string, string>;
  addEventListener(event: string, handler: (event?: unknown) => void): void;
  setAttribute(name: string, value: string): void;
  append(child: Fake): void;
  setPointerCapture(pointerId: number): void;
}

function fake(value = "", options: string[] = []): Fake {
  return {
    textContent: "",
    value,
    max: "",
    disabled: false,
    style: {},
    options: options.map((v) => ({ value: v })),
    listeners: {},
    appended: [],
    attributes: {},
    addEventListener(event, handler) {
      (this.listeners[event] ??= []).push(handler);
    },
    setAttribute(name, v) {
      this.attributes[name] = v;
    },
    append(child) {
      this.appended.push(child);
    },
    setPointerCapture() {
      // The real one keeps a drag alive past the edge of the canvas; nothing here needs it.
    },
  };
}

/** A pointer event with only the members the drag handlers touch. */
function pointer(
  x: number,
  y: number,
): { clientX: number; clientY: number; pointerId: number; preventDefault(): void } {
  return { clientX: x, clientY: y, pointerId: 1, preventDefault: () => undefined };
}

function fire(element: Fake, event: string, payload?: unknown): void {
  for (const handler of element.listeners[event] ?? []) handler(payload);
}

/** The scales the page offers, whose ends are also the ends of the wheel's range. */
const SCALES = [
  "auto",
  "200",
  "500",
  "1000",
  "2000",
  "5000",
  "10000",
  "20000",
  "50000",
  "100000",
  "200000",
  "500000",
  "1000000",
];

/** A wheel event with only the two members the handler touches. */
function wheel(deltaY: number): { deltaY: number; prevented: boolean; preventDefault(): void } {
  return {
    deltaY,
    prevented: false,
    preventDefault(): void {
      this.prevented = true;
    },
  };
}

/** A Replay that answers questions and records what it was told, without rendering. */
function playback(overrides: Partial<TransportPlayback> = {}): TransportPlayback & {
  seeks: number[];
  speeds: number[];
  scales: (number | null)[];
  pans: [number, number][];
  recentres: number;
  views: ViewSelection[];
  playing: boolean;
} {
  const state = {
    startSeconds: 1_000,
    endSeconds: 1_600,
    timeSeconds: 1_000,
    playing: false,
    actorIds: ["A", "B"],
    seeks: [] as number[],
    speeds: [] as number[],
    scales: [] as (number | null)[],
    pans: [] as [number, number][],
    recentres: 0,
    views: [] as ViewSelection[],
    setView: (view: ViewSelection) => state.views.push(view),
    setSpeed: (multiplier: number) => state.speeds.push(multiplier),
    setScale: (extentMetres: number | null) => state.scales.push(extentMetres),
    panByPixels: (dx: number, dy: number) => state.pans.push([dx, dy]),
    recentre: () => {
      state.recentres += 1;
    },
    seek: (epochSeconds: number) => {
      state.seeks.push(epochSeconds);
      state.timeSeconds = epochSeconds;
    },
    play: () => {
      state.playing = true;
    },
    pause: () => {
      state.playing = false;
    },
    resize: () => undefined,
    get isPlaying(): boolean {
      return state.playing;
    },
    // As the real one does: what the plan view is showing now, whether that was chosen or
    // worked out. The wheel zooms from it, so a fixed answer would make every notch the
    // first one.
    get planExtentMetres(): number {
      const last = state.scales.at(-1);
      return typeof last === "number" ? last : 8_000;
    },
    ...overrides,
  };
  return state;
}

let frames: (() => void)[] = [];

/** Run one animation frame, the way a browser would. */
function nextFrame(): void {
  const due = frames;
  frames = [];
  for (const callback of due) callback();
}

function wire(replay = playback()): {
  replay: ReturnType<typeof playback>;
  parts: TransportParts &
    Record<
      "canvas" | "clock" | "playPause" | "scrub" | "speed" | "scale" | "recentre" | "views",
      Fake
    >;
  transport: ReturnType<typeof wireTransport>;
} {
  const elements = {
    canvas: fake(),
    recentre: fake(),
    clock: fake(),
    playPause: fake(),
    scrub: fake(),
    speed: fake("20"),
    scale: fake("auto", SCALES),
    views: fake(),
  };
  const parts = { replay, timeZone: "UTC", ...elements } as unknown as TransportParts;
  const transport = wireTransport(parts);
  return { replay, parts: parts as never, transport };
}

beforeEach(() => {
  frames = [];
  vi.stubGlobal("requestAnimationFrame", (cb: () => void) => frames.push(cb));
  vi.stubGlobal("document", { createElement: () => fake() });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("what the controls say", () => {
  it("shows the clock in the zone the source report's own times are in", () => {
    const { parts } = wire();
    expect(parts.clock.textContent).toBe("00:16:40 local");
  });

  it("puts the scrub handle where playback has got to", () => {
    const replay = playback();
    const { parts, transport } = wire(replay);
    expect(parts.scrub.value, "at the start").toBe("0");
    expect(parts.scrub.max).toBe("1000");

    replay.seek(replay.startSeconds + 300);
    transport.paint();
    expect(parts.scrub.value, "halfway").toBe("500");
  });

  it("labels the button with what pressing it would do", () => {
    const replay = playback();
    const { parts, transport } = wire(replay);
    expect(parts.playPause.textContent).toBe("Play");

    replay.play();
    transport.paint();
    expect(parts.playPause.textContent).toBe("Pause");
  });
});

/**
 * The reason this module was pulled out of `main.ts`. A repaint loop that keeps running
 * after playback has stopped is invisible: the page looks right, and quietly never goes
 * idle again - which is what a screenshot, an extension or a profiler is waiting for.
 */
describe("following playback", () => {
  it("repaints while playing, and stops the frame after playback does", () => {
    const replay = playback();
    const { transport } = wire(replay);
    replay.play();
    transport.startFollowing();

    nextFrame();
    expect(frames, "still playing, so still queued").toHaveLength(1);

    replay.pause();
    nextFrame();
    expect(frames, "playback stopped, so the loop stopped").toHaveLength(0);
  });

  it("does not start a second loop while one is already running", () => {
    const replay = playback();
    const { transport } = wire(replay);
    replay.play();

    transport.startFollowing();
    transport.startFollowing();
    transport.startFollowing();

    expect(frames, "one loop, however many times it was asked for").toHaveLength(1);
  });

  /**
   * The flag has to be cleared by the loop on its way out. Left set, the next press
   * starts playback with nothing following it: the picture moves and the clock sits
   * frozen at whatever time it stopped.
   */
  it("follows again after it has stopped", () => {
    const replay = playback();
    const { transport } = wire(replay);
    replay.play();
    transport.startFollowing();
    nextFrame();

    replay.pause();
    nextFrame();
    expect(frames).toHaveLength(0);

    replay.play();
    transport.startFollowing();
    expect(frames, "following again").toHaveLength(1);
  });

  it("keeps the clock up with playback while it runs", () => {
    const replay = playback();
    const { parts, transport } = wire(replay);
    replay.play();
    transport.startFollowing();

    replay.seek(replay.startSeconds + 60);
    nextFrame();
    expect(parts.clock.textContent).toBe("00:17:40 local");
  });
});

describe("the view buttons", () => {
  it("offers the plan view and one bridge for every ship", () => {
    const { parts } = wire();
    const labels = parts.views.appended.map((b) => b.textContent);
    expect(labels).toEqual(["Overhead", "A bridge", "B bridge"]);
  });

  it("starts on the plan view, and says so to a screen reader", () => {
    const { parts } = wire();
    expect(parts.views.appended[0]!.attributes["aria-pressed"]).toBe("true");
  });

  it("moves the pressed state to whichever view was chosen", () => {
    const { replay, parts } = wire();
    const [overhead, bridgeA] = parts.views.appended;

    fire(bridgeA!, "click");
    expect(replay.views.at(-1)).toEqual({ kind: "bridge", actorId: "A" });
    expect(bridgeA!.attributes["aria-pressed"]).toBe("true");
    expect(overhead!.attributes["aria-pressed"], "and off the one left behind").toBe("false");
  });
});

describe("speed", () => {
  // Applied at once, so the page and the control agree before anything is pressed.
  it("takes the speed the page was built with", () => {
    const { replay } = wire();
    expect(replay.speeds).toEqual([20]);
  });

  it("follows the control when it changes", () => {
    const { replay, parts } = wire();
    parts.speed.value = "5";
    fire(parts.speed, "change");
    expect(replay.speeds.at(-1)).toBe(5);
  });
});

describe("scale", () => {
  /**
   * Automatic is the right default and the wrong thing to be stuck with: the frame opens
   * to nearly twice the ships' separation, so early on they are specks, and it closes to a
   * few ship lengths at contact whether or not that is the moment being looked at.
   */
  it("starts on automatic, and says so to the replay rather than assuming it", () => {
    const { replay } = wire();
    expect(replay.scales).toEqual([null]);
  });

  it("fixes the frame at the scale chosen", () => {
    const { replay, parts } = wire();
    parts.scale.value = "2000";
    fire(parts.scale, "change");
    expect(replay.scales.at(-1)).toBe(2000);
  });

  it("hands the frame back when automatic is chosen again", () => {
    const { replay, parts } = wire();
    parts.scale.value = "2000";
    fire(parts.scale, "change");
    parts.scale.value = "auto";
    fire(parts.scale, "change");

    expect(replay.scales.at(-1)).toBeNull();
  });

  // A control that changes nothing on screen reads as one that is broken.
  it("goes dead from a bridge, and comes back from above", () => {
    const { parts } = wire();
    const [overhead, bridge] = parts.views.appended;

    fire(bridge!, "click");
    expect(parts.scale.disabled).toBe(true);
    fire(overhead!, "click");
    expect(parts.scale.disabled).toBe(false);
  });
});

describe("the wheel over the picture", () => {
  /**
   * Smoothly, which the first version was not: stepping the menu's own ladder jumped two to
   * three times the scale a notch, and a trackpad - a stream of small deltas where a mouse
   * sends one notch of about a hundred - either did nothing or crossed the whole range.
   */
  it("multiplies the scale on screen rather than stepping a ladder", () => {
    const { replay, parts } = wire();
    fire(parts.canvas, "wheel", wheel(-100));
    expect(replay.scales.at(-1), "in a notch from 8 km").toBeCloseTo(6400, 6);
  });

  it("goes the way a map goes: away from the reader opens out", () => {
    const { replay, parts } = wire();
    fire(parts.canvas, "wheel", wheel(100));
    expect(replay.scales.at(-1), "out a notch from 8 km").toBeCloseTo(10000, 6);
  });

  // The point of the change. A trackpad's deltas are a fraction of a notch, and they have
  // to move the picture by a fraction of a notch rather than by nothing or by all of it.
  it("moves a fraction of a notch for a fraction of a turn", () => {
    const { replay, parts } = wire();
    fire(parts.canvas, "wheel", wheel(-10));

    const after = replay.scales.at(-1)!;
    expect(after).toBeLessThan(8000);
    expect(after).toBeGreaterThan(7500);
  });

  it("carries on from where it got to", () => {
    const { replay, parts } = wire();
    fire(parts.canvas, "wheel", wheel(-100));
    fire(parts.canvas, "wheel", wheel(-100));
    expect(replay.scales.at(-1)).toBeCloseTo(5120, 6);
  });

  /**
   * The menu offers round numbers and the wheel arrives between them, so the wheel writes
   * where it got to into an option of its own. However far it is turned, the control still
   * names the scale the picture is at - which is the whole reason a stated scale is worth
   * having.
   */
  it("names the scale it arrived at, in the menu", () => {
    const { parts } = wire();
    fire(parts.canvas, "wheel", wheel(-100));

    expect(parts.scale.value).toBe("manual");
    expect(parts.scale.appended.at(-1)!.textContent).toBe("Scale: 6.4 km");
  });

  it("stops at the ends of the range rather than running past them", () => {
    const { replay, parts } = wire();
    for (let notch = 0; notch < 60; notch += 1) fire(parts.canvas, "wheel", wheel(-100));
    expect(replay.scales.at(-1), "the closest the menu offers").toBe(200);

    for (let notch = 0; notch < 120; notch += 1) fire(parts.canvas, "wheel", wheel(100));
    expect(replay.scales.at(-1), "and the widest").toBe(1000000);
  });

  // Trapping the page's own scroll is the price of zooming here, so it is only paid where
  // the wheel does something.
  it("holds the page still while it is zooming", () => {
    const { parts } = wire();
    const event = wheel(-100);
    fire(parts.canvas, "wheel", event);
    expect(event.prevented).toBe(true);
  });

  it("lets the page scroll from a bridge, where there is no scale to change", () => {
    const { replay, parts } = wire();
    const [, bridge] = parts.views.appended;
    fire(bridge!, "click");

    const event = wheel(-100);
    fire(parts.canvas, "wheel", event);

    expect(event.prevented).toBe(false);
    expect(replay.scales, "and nothing was changed").toEqual([null]);
  });
});

describe("dragging the picture", () => {
  /**
   * The frame follows the ships by default, which is right until it is not: an approach is
   * often best watched from over the headland one of them is rounding, and that is not
   * where the midpoint of two tracks happens to be.
   */
  it("moves the view by what the pointer moved", () => {
    const { replay, parts } = wire();
    fire(parts.canvas, "pointerdown", pointer(100, 100));
    fire(parts.canvas, "pointermove", pointer(130, 90));

    expect(replay.pans).toEqual([[30, -10]]);
  });

  // Each move is measured from the last one, not from where the drag began, or a steady
  // drag accelerates away across the picture.
  it("measures each move from the one before", () => {
    const { replay, parts } = wire();
    fire(parts.canvas, "pointerdown", pointer(100, 100));
    fire(parts.canvas, "pointermove", pointer(110, 100));
    fire(parts.canvas, "pointermove", pointer(120, 100));

    expect(replay.pans).toEqual([
      [10, 0],
      [10, 0],
    ]);
  });

  it("stops moving when the pointer is let go", () => {
    const { replay, parts } = wire();
    fire(parts.canvas, "pointerdown", pointer(100, 100));
    fire(parts.canvas, "pointerup", pointer(110, 100));
    fire(parts.canvas, "pointermove", pointer(200, 100));

    expect(replay.pans, "the move after the release is not a drag").toEqual([]);
  });

  it("ignores a pointer that never went down on it", () => {
    const { replay, parts } = wire();
    fire(parts.canvas, "pointermove", pointer(200, 100));
    expect(replay.pans).toEqual([]);
  });

  it("does not drag a bridge view, where there is nothing to drag", () => {
    const { replay, parts } = wire();
    const [, bridge] = parts.views.appended;
    fire(bridge!, "click");

    fire(parts.canvas, "pointerdown", pointer(100, 100));
    fire(parts.canvas, "pointermove", pointer(200, 100));
    expect(replay.pans).toEqual([]);
  });

  // Offering to be dragged is how anyone finds out that it can be, so the offer has to be
  // withdrawn where it is not true.
  it("shows the picture can be grabbed, and only where it can", () => {
    const { parts } = wire();
    const [overhead, bridge] = parts.views.appended;
    expect(parts.canvas.style.cursor).toBe("grab");

    fire(parts.canvas, "pointerdown", pointer(100, 100));
    expect(parts.canvas.style.cursor, "while dragging").toBe("grabbing");
    fire(parts.canvas, "pointerup", pointer(100, 100));
    expect(parts.canvas.style.cursor).toBe("grab");

    fire(bridge!, "click");
    expect(parts.canvas.style.cursor, "nothing to grab from a wheelhouse").toBe("");
    fire(overhead!, "click");
    expect(parts.canvas.style.cursor).toBe("grab");
  });

  /**
   * A view that has been taken over needs a stated way back rather than a knack. The scale
   * has "auto" in its menu; the centre has this.
   */
  it("hands the view back to the ships when asked", () => {
    const { replay, parts } = wire();
    fire(parts.recentre, "click");
    expect(replay.recentres).toBe(1);
  });

  it("goes dead from a bridge, like the scale", () => {
    const { parts } = wire();
    const [overhead, bridge] = parts.views.appended;

    fire(bridge!, "click");
    expect(parts.recentre.disabled).toBe(true);
    fire(overhead!, "click");
    expect(parts.recentre.disabled).toBe(false);
  });
});

describe("play and pause", () => {
  it("plays when stopped, and follows playback from there", () => {
    const { replay, parts } = wire();
    fire(parts.playPause, "click");

    expect(replay.isPlaying).toBe(true);
    expect(frames, "and something is now following it").toHaveLength(1);
    expect(parts.playPause.textContent).toBe("Pause");
  });

  it("pauses when playing", () => {
    const { replay, parts } = wire();
    replay.play();
    fire(parts.playPause, "click");

    expect(replay.isPlaying).toBe(false);
    expect(parts.playPause.textContent).toBe("Play");
  });
});

describe("the scrub bar", () => {
  /**
   * Dragging is a deliberate move to a moment, so it stops playback rather than fighting
   * it. Left running, the next frame would drag the handle straight back out of the user's
   * hand.
   */
  it("stops playback and goes to the moment asked for", () => {
    const { replay, parts } = wire();
    replay.play();

    parts.scrub.value = "250";
    fire(parts.scrub, "input");

    expect(replay.isPlaying).toBe(false);
    expect(replay.seeks.at(-1), "a quarter of the way through 600 seconds").toBe(1_150);
  });

  it("repaints the clock as it is dragged", () => {
    const { parts } = wire();
    parts.scrub.value = "1000";
    fire(parts.scrub, "input");
    expect(parts.clock.textContent).toBe("00:26:40 local");
  });
});
