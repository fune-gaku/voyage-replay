import { OrthographicCamera, PerspectiveCamera } from "three";
import type * as THREE from "three";
import type { Group, Object3D, Scene } from "three";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { headingToRotationY, toWorld } from "../src/render/coords.js";
import { prepareActor, sampleAt } from "../src/core/track.js";
import type { Scenario } from "../src/core/types.js";
import {
  actor,
  BIG_SHIP,
  COASTER,
  northboundPoints,
  scenario,
  westboundPoints,
} from "./fixtures.js";

const gl = vi.hoisted(() => ({
  frames: [] as { scene: Scene; camera: unknown }[],
  sizes: [] as [number, number][],
  pixelRatios: [] as number[],
  disposals: 0,
}));

/**
 * The only part of three.js that wants a GL context.
 *
 * Everything else it provides - scenes, geometry, cameras, and the arithmetic that puts a
 * hull where the track says it was - runs in Node exactly as it does in a browser. Standing
 * in for this one class is what makes the rest of this file reachable, and recording what
 * it was handed is what makes it worth reaching: the camera passed to `render` is the
 * answer to "what was the viewer looking through", which is the question this class exists
 * to settle.
 */
vi.mock("three", async (importOriginal) => {
  const actual = await importOriginal<typeof THREE>();
  return {
    ...actual,
    WebGLRenderer: class {
      setPixelRatio(ratio: number): void {
        gl.pixelRatios.push(ratio);
      }
      setSize(width: number, height: number): void {
        gl.sizes.push([width, height]);
      }
      render(scene: Scene, camera: unknown): void {
        gl.frames.push({ scene, camera });
      }
      dispose(): void {
        gl.disposals += 1;
      }
    },
  };
});

const { Replay } = await import("../src/render/player.js");

let frameCallbacks: (() => void)[] = [];

function fakeCanvas(width = 800, height = 400): HTMLCanvasElement {
  return { clientWidth: width, clientHeight: height } as unknown as HTMLCanvasElement;
}

function replayOf(
  subject: Scenario = scenario(),
  canvas = fakeCanvas(),
): InstanceType<typeof Replay> {
  return new Replay(canvas, subject);
}

/** The last frame drawn. Nothing is asserted about frames nobody would have seen. */
function lastFrame(): { scene: Scene; camera: unknown } {
  const frame = gl.frames.at(-1);
  if (!frame) throw new Error("nothing was rendered");
  return frame;
}

/**
 * Scene layout, fixed by `buildScene` and `buildStage`: water, ambient, key, the cast,
 * the grid, then the diagram. The two Groups are the cast and the diagram, in that order.
 */
function groupsOf(scene: Scene): [Group, Group] {
  const groups = scene.children.filter((child): child is Group => child.type === "Group");
  return [groups[0]!, groups[1]!];
}

function ships(scene: Scene): Object3D[] {
  return groupsOf(scene)[0].children;
}

beforeEach(() => {
  gl.frames = [];
  gl.sizes = [];
  gl.pixelRatios = [];
  gl.disposals = 0;
  frameCallbacks = [];
  vi.stubGlobal("window", { devicePixelRatio: 1 });
  vi.stubGlobal("requestAnimationFrame", (cb: () => void) => {
    frameCallbacks.push(cb);
  });
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("what the Replay takes from the scenario", () => {
  it("spans the union of the tracks", () => {
    const replay = replayOf();
    expect(replay.startSeconds).toBe(Date.parse("2025-01-01T00:00:00Z") / 1000);
    expect(replay.endSeconds).toBe(Date.parse("2025-01-01T00:02:00Z") / 1000);
  });

  it("keeps the actors in the order the scenario gave them", () => {
    expect(replayOf().actorIds).toEqual(["A", "B"]);
  });

  it("draws a frame as soon as it is built, without being asked", () => {
    replayOf();
    expect(gl.frames.length).toBeGreaterThan(0);
  });

  it("refuses to seek outside the tracks", () => {
    const replay = replayOf();
    replay.seek(replay.startSeconds - 9999);
    expect(replay.timeSeconds).toBe(replay.startSeconds);
    replay.seek(replay.endSeconds + 9999);
    expect(replay.timeSeconds).toBe(replay.endSeconds);
  });
});

describe("where each ship is put", () => {
  it("stands her where the track says she was", () => {
    const subject = scenario();
    const replay = replayOf(subject);
    const at = replay.startSeconds + 60;
    replay.seek(at);

    const track = prepareActor(subject.actors[0]!, subject.origin);
    const expected = toWorld(sampleAt(track, at)!.position);
    expect(ships(lastFrame().scene)[0]!.position.x).toBeCloseTo(expected.x, 6);
    expect(ships(lastFrame().scene)[0]!.position.z).toBeCloseTo(expected.z, 6);
  });

  /**
   * The rule this project is most careful about. A hull points along her HEADING, and a
   * Class B transponder never transmits one - actor B here has only a course over ground.
   * Something has to be drawn, so the course stands in, and the panels say so. What must
   * not happen is the two being confused in either direction.
   */
  it("points a hull along her heading, and along her course only where there is no heading", () => {
    const replay = replayOf();
    replay.seek(replay.startSeconds + 30);
    const [a, b] = ships(lastFrame().scene);

    // A steers 000 and says so.
    expect(a!.rotation.y).toBeCloseTo(headingToRotationY(0), 9);
    // B transmits no heading at all; her course over ground is 270.
    expect(b!.rotation.y).toBeCloseTo(headingToRotationY(270), 9);
  });

  it("hides a ship at an instant her own track does not reach", () => {
    const short = actor("B", westboundPoints().slice(0, 2), BIG_SHIP);
    const replay = replayOf(scenario([actor("A", northboundPoints(), COASTER), short]));
    replay.seek(replay.endSeconds);

    const [a, b] = ships(lastFrame().scene);
    expect(a!.visible).toBe(true);
    expect(b!.visible, "B's track ends a minute early").toBe(false);
  });
});

describe("the two views", () => {
  it("looks through the plan camera by default", () => {
    replayOf();
    expect(lastFrame().camera).toBeInstanceOf(OrthographicCamera);
  });

  it("looks through the named ship's bridge when asked", () => {
    const replay = replayOf();
    replay.setView({ kind: "bridge", actorId: "B" });
    expect(lastFrame().camera).toBeInstanceOf(PerspectiveCamera);
  });

  it("falls back to the plan view rather than guessing at an unknown ship", () => {
    const replay = replayOf();
    replay.setView({ kind: "bridge", actorId: "nobody" });
    // Falls back to the first of the cast, which is a ship that does exist.
    expect(lastFrame().camera).toBeInstanceOf(PerspectiveCamera);
  });

  /**
   * The light sectors and the track lines are a diagram, not the night. Leaving them on
   * from a wheelhouse would be a picture of the rules rather than of what was seen, and
   * nobody on a bridge sees where the other ship has been.
   */
  it("shows the arcs and the track lines from above, and neither from a bridge", () => {
    const replay = replayOf();
    const [cast, diagram] = groupsOf(lastFrame().scene);
    const sectorsOf = (ship: Object3D): Object3D =>
      ship.children.flatMap((c) => c.children).find((c) => c.type === "Group") ?? ship;

    expect(diagram.visible).toBe(true);
    expect(sectorsOf(cast.children[0]!).visible).toBe(true);

    replay.setView({ kind: "bridge", actorId: "A" });
    expect(diagram.visible).toBe(false);
    expect(sectorsOf(cast.children[0]!).visible).toBe(false);
  });

  /**
   * Framing the action rather than the whole track is what makes the plan view usable -
   * but at contact the two hulls are metres apart, and a frame that followed them all the
   * way in would collapse onto them just as the geometry became the thing worth seeing.
   */
  it("never zooms the plan view closer than a few ship lengths", () => {
    const replay = replayOf();
    replay.seek(replay.endSeconds);

    const camera = lastFrame().camera as OrthographicCamera;
    // Seven lengths of the larger ship, and she is 180 m.
    expect(camera.top - camera.bottom).toBeGreaterThanOrEqual(BIG_SHIP.loaMetres * 7);
  });

  it("widens the plan view to the shape of the canvas", () => {
    const replay = replayOf(scenario(), fakeCanvas(800, 400));
    replay.seek(replay.endSeconds);

    const camera = lastFrame().camera as OrthographicCamera;
    expect((camera.right - camera.left) / (camera.top - camera.bottom)).toBeCloseTo(2, 6);
  });
});

describe("playback", () => {
  it("advances by the elapsed time multiplied by the speed", () => {
    vi.useFakeTimers();
    const replay = replayOf();
    replay.setSpeed(20);
    replay.play();
    expect(replay.isPlaying).toBe(true);

    const before = replay.timeSeconds;
    vi.advanceTimersByTime(1000);
    frameCallbacks.pop()!();

    expect(replay.timeSeconds - before).toBeCloseTo(20, 1);
  });

  it("stops of its own accord at the end of the tracks", () => {
    vi.useFakeTimers();
    const replay = replayOf();
    replay.setSpeed(1000);
    replay.play();

    vi.advanceTimersByTime(5000);
    frameCallbacks.pop()!();

    expect(replay.timeSeconds).toBe(replay.endSeconds);
    expect(replay.isPlaying).toBe(false);
  });

  it("rewinds rather than sitting at the end when played again", () => {
    const replay = replayOf();
    replay.seek(replay.endSeconds);
    replay.play();
    expect(replay.timeSeconds).toBe(replay.startSeconds);
  });

  it("ignores a second play rather than running two loops at once", () => {
    const replay = replayOf();
    replay.play();
    const queued = frameCallbacks.length;
    replay.play();
    expect(frameCallbacks.length).toBe(queued);
  });

  it("stops when paused", () => {
    const replay = replayOf();
    replay.play();
    replay.pause();
    expect(replay.isPlaying).toBe(false);
    expect(cancelAnimationFrame).toHaveBeenCalled();
  });

  it("reports the speed it was given", () => {
    const replay = replayOf();
    replay.setSpeed(5);
    expect(replay.speedMultiplier).toBe(5);
  });
});

describe("the canvas", () => {
  it("resizes the drawing buffer and the bridge lens together", () => {
    const canvas = fakeCanvas(800, 400);
    const replay = replayOf(scenario(), canvas);
    replay.setView({ kind: "bridge", actorId: "A" });

    (canvas as { clientWidth: number }).clientWidth = 1200;
    (canvas as { clientHeight: number }).clientHeight = 300;
    replay.resize();

    expect(gl.sizes.at(-1)).toEqual([1200, 300]);
    expect((lastFrame().camera as PerspectiveCamera).aspect).toBeCloseTo(4, 6);
  });

  // A canvas laid out at zero height would otherwise divide by it.
  it("survives a canvas with no height yet", () => {
    expect(() => replayOf(scenario(), fakeCanvas(800, 0))).not.toThrow();
  });

  // A retina display would otherwise render four times the pixels, which on a scene this
  // dark buys nothing and costs the frame rate the recording is taken at.
  it("caps the pixel ratio rather than following the display all the way up", () => {
    vi.stubGlobal("window", { devicePixelRatio: 3 });
    replayOf();
    expect(gl.pixelRatios.at(-1)).toBe(2);
  });

  it("gives the GL context back when disposed", () => {
    replayOf().dispose();
    expect(gl.disposals).toBe(1);
  });
});
