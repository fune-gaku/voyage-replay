import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ViewSelection } from "../src/render/player.js";
import { wireTransport, type TransportParts, type TransportPlayback } from "../src/ui/transport.js";

/** An element that remembers what was attached to it and what was done to it. */
interface Fake {
  textContent: string;
  value: string;
  max: string;
  listeners: Record<string, (() => void)[]>;
  appended: Fake[];
  attributes: Record<string, string>;
  addEventListener(event: string, handler: () => void): void;
  setAttribute(name: string, value: string): void;
  append(child: Fake): void;
}

function fake(value = ""): Fake {
  return {
    textContent: "",
    value,
    max: "",
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
  };
}

function fire(element: Fake, event: string): void {
  for (const handler of element.listeners[event] ?? []) handler();
}

/** A Replay that answers questions and records what it was told, without rendering. */
function playback(overrides: Partial<TransportPlayback> = {}): TransportPlayback & {
  seeks: number[];
  speeds: number[];
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
    views: [] as ViewSelection[],
    setView: (view: ViewSelection) => state.views.push(view),
    setSpeed: (multiplier: number) => state.speeds.push(multiplier),
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
  parts: TransportParts & Record<"clock" | "playPause" | "scrub" | "speed" | "views", Fake>;
  transport: ReturnType<typeof wireTransport>;
} {
  const elements = {
    clock: fake(),
    playPause: fake(),
    scrub: fake(),
    speed: fake("20"),
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
