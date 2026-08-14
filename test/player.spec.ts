import { OrthographicCamera, PerspectiveCamera, Vector3 } from "three";
import type * as THREE from "three";
import type { Group, Object3D, Points, PointsMaterial, Scene } from "three";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { headingToRotationY, toWorld } from "../src/render/coords.js";
import { toLatLon } from "../src/core/geodesy.js";
import { prepareActor, sampleAt } from "../src/core/track.js";
import type { Actor, Scenario, TrackPoint } from "../src/core/types.js";
import {
  actor,
  BIG_SHIP,
  COASTER,
  northboundPoints,
  ORIGIN,
  scenario,
  silentPoints,
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

/**
 * The hull and the lamps, which hang off the group carrying the antenna offset rather than
 * off the ship's own group. Both are wanted together: they are bolted to the same steel, so
 * anything that moves one and not the other is wrong however plausible it looks.
 */
function partsOf(ship: Object3D): Object3D[] {
  return ship.children.flatMap((child) => child.children);
}

/**
 * Where the eye sits in the drawn hull's own frame: +X to starboard, -Z forward, both from
 * her centre. Asking it this way is what makes the answer checkable without repeating any of
 * the renderer's arithmetic - a wheelhouse is on the centreline and abaft the middle, and
 * both halves stay true whatever heading she is on and wherever her antenna is.
 */
function eyeInHullFrame(ship: Object3D, eye: Vector3): Vector3 {
  const hull = partsOf(ship)[0]!;
  hull.updateWorldMatrix(true, false);
  return hull.worldToLocal(eye.clone());
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
   * The rule this project is most careful about, and the two halves of it have to be
   * checked separately or neither is checked at all.
   *
   * A hull points along her HEADING. Actor A is making good due north with her bow ten
   * degrees to starboard of that - a drift angle, which is what a cross-tide does - so
   * course and heading disagree and only one of them is the right answer. Reaching for the
   * course instead would turn her by the drift angle, taking every navigation light she
   * carries round with her, and the picture would still look entirely reasonable.
   *
   * Actor B is the other half: a Class B transponder, which transmits no heading at all.
   * Something has to be drawn, so her course stands in and the panels say so.
   */
  it("points a hull along her heading, not along the course she is making good", () => {
    const replay = replayOf();
    replay.seek(replay.startSeconds + 30);
    const [a] = ships(lastFrame().scene);

    expect(a!.rotation.y).toBeCloseTo(headingToRotationY(10), 9);
    expect(a!.rotation.y, "her course over ground is 000; her bow is not").not.toBeCloseTo(
      headingToRotationY(0),
      9,
    );
  });

  it("falls back to the course over ground only where no heading was transmitted", () => {
    const replay = replayOf();
    replay.seek(replay.startSeconds + 30);
    const [, b] = ships(lastFrame().scene);

    expect(b!.rotation.y).toBeCloseTo(headingToRotationY(270), 9);
  });

  /**
   * The reported position is the GPS antenna, and a hull is drawn about its own centre. B's
   * antenna sits 140 m from a 180 m bow, so her hull's centre is 50 m forward of what her
   * track reports and 4 m to starboard of it.
   *
   * She is steering 270, so forward is west and starboard is north, and the expected offset
   * separates cleanly onto the two world axes: get the sign wrong and the hull lands 50 m
   * EAST, astern of where she was, which is what the renderer did before and what still
   * looks like a ship on a reasonable course.
   */
  it("stands the hull where the offsets say, not on top of the antenna", () => {
    const subject = scenario();
    const replay = replayOf(subject);
    const at = replay.startSeconds + 30;
    replay.seek(at);

    const track = prepareActor(subject.actors[1]!, subject.origin);
    const reported = toWorld(sampleAt(track, at)!.position);
    const parts = partsOf(ships(lastFrame().scene)[1]!);

    expect(parts.length, "the hull and the lamps").toBe(2);
    for (const part of parts) {
      const world = part.getWorldPosition(new Vector3());
      expect(world.x, "50 m forward, and forward is west").toBeCloseTo(reported.x - 50, 6);
      expect(world.z, "4 m to starboard, and starboard is north").toBeCloseTo(reported.z - 4, 6);
    }
  });

  it("leaves a ship whose offsets were never stated where her track reports her", () => {
    const subject = scenario();
    const replay = replayOf(subject);
    replay.seek(replay.startSeconds + 30);

    const track = prepareActor(subject.actors[0]!, subject.origin);
    const reported = toWorld(sampleAt(track, replay.timeSeconds)!.position);
    const world = partsOf(ships(lastFrame().scene)[0]!)[0]!.getWorldPosition(new Vector3());

    expect(world.x).toBeCloseTo(reported.x, 6);
    expect(world.z).toBeCloseTo(reported.z, 6);
  });

  /**
   * A track reported at the ship's reference point has already been moved onto the hull by
   * whoever prepared it. Moving it again displaces her twice - and by then she is 50 m from
   * where the source put her, still on a plausible course, with nothing downstream to say so.
   */
  it("does not move a track that was already reported at the hull", () => {
    const alreadyMoved = actor("B", westboundPoints(), BIG_SHIP);
    alreadyMoved.track.positionAt = "reference-point";
    const subject = scenario([actor("A", northboundPoints(), COASTER), alreadyMoved]);
    const replay = replayOf(subject);
    replay.seek(replay.startSeconds + 30);

    const track = prepareActor(alreadyMoved, subject.origin);
    const reported = toWorld(sampleAt(track, replay.timeSeconds)!.position);
    const world = partsOf(ships(lastFrame().scene)[1]!)[0]!.getWorldPosition(new Vector3());

    expect(world.x).toBeCloseTo(reported.x, 6);
    expect(world.z).toBeCloseTo(reported.z, 6);
  });

  /**
   * A hull can be POINTED somewhere for want of anything better - she points north and the
   * panels' aspect column says the geometry cannot be read off her. She cannot be MOVED
   * somewhere on the same footing: the offset runs along her heading, so applying it to an
   * invented one would carry her 50 m north of the only thing the source actually states.
   */
  it("does not displace a ship that reports neither heading nor course", () => {
    const subject = scenario([
      actor("A", northboundPoints(), COASTER),
      actor("B", silentPoints(), BIG_SHIP),
    ]);
    const replay = replayOf(subject);
    replay.seek(replay.startSeconds + 30);

    const track = prepareActor(subject.actors[1]!, subject.origin);
    const reported = toWorld(sampleAt(track, replay.timeSeconds)!.position);
    const world = partsOf(ships(lastFrame().scene)[1]!)[0]!.getWorldPosition(new Vector3());

    expect(world.x).toBeCloseTo(reported.x, 6);
    expect(world.z).toBeCloseTo(reported.z, 6);
  });

  it("keeps the eye in the wheelhouse of a ship reporting neither heading nor course", () => {
    const replay = replayOf(
      scenario([actor("A", northboundPoints(), COASTER), actor("B", silentPoints(), BIG_SHIP)]),
    );
    replay.setView({ kind: "bridge", actorId: "B" });

    const eye = eyeInHullFrame(
      ships(lastFrame().scene)[1]!,
      (lastFrame().camera as PerspectiveCamera).position,
    );

    // Suppress the offset for the hull but not for the eye and she looks out 4 m off her own
    // centreline, from a wheelhouse 50 m further forward than the one that is drawn.
    expect(eye.x, "a wheelhouse is on the centreline").toBeCloseTo(0, 6);
    expect(eye.z, "and abaft the middle, which is +Z").toBeGreaterThan(0);
    expect(eye.z, "and inside her").toBeLessThan(BIG_SHIP.loaMetres / 2);
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

  /**
   * Moving the hull onto its offsets moves the wheelhouse with it, and the eye has to go
   * too. B's hull is 50 m forward of her reported position and her bridge 57.6 m aft of her
   * centre, so an eye placed from the reported position alone ends up 107 m from the hull it
   * belongs to - outside a 180 m ship, floating off her quarter and looking at her own
   * accommodation block. Nothing about the frame would look broken.
   */
  it("keeps the bridge camera inside the hull it was moved with", () => {
    const replay = replayOf();
    replay.setView({ kind: "bridge", actorId: "B" });

    const eye = eyeInHullFrame(
      ships(lastFrame().scene)[1]!,
      (lastFrame().camera as PerspectiveCamera).position,
    );

    expect(eye.x, "a wheelhouse is on the centreline").toBeCloseTo(0, 6);
    expect(eye.z, "and abaft the middle, which is +Z").toBeGreaterThan(0);
    expect(eye.z, "and inside her").toBeLessThan(BIG_SHIP.loaMetres / 2);
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
    // Three deep now: the ship, the group carrying her antenna offset, her lamps, the arcs.
    const sectorsOf = (ship: Object3D): Object3D =>
      partsOf(ship)
        .flatMap((part) => part.children)
        .find((c) => c.type === "Group") ?? ship;

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

/**
 * Rule 21 gives the sidelights 112.5 degrees each, on opposite sides, and they do not
 * overlap: a ship shows one of them or the other and never both at once. The renderer drew
 * every lamp she carried whatever it was being watched from, so a bridge view showed a red
 * and a green together - a picture of an observer standing in two places, contradicted in
 * words by the panel underneath it, which has always asked `visibleLights`.
 *
 * The two cases below are the same ship watched from opposite sides. Both have to hold: one
 * alone passes just as well with the bearing measured from the wrong bow, which is the
 * mistake that comes out exactly 180 degrees round and still looks like a ship.
 */
describe("which of another ship's lamps a bridge can see", () => {
  const GREEN = 0x2ad04a;
  const RED = 0xf0323c;
  const WHITE = 0xfff6e0;

  /** Two points in the same place: this test is about aspect, and nothing here moves. */
  function moored(lat: number, lon: number, headingDegreesTrue: number): TrackPoint[] {
    return [0, 1].map((minute) => ({
      t: `2025-01-01T00:0${minute}:00Z`,
      lat,
      lon,
      cogDegreesTrue: headingDegreesTrue,
      headingDegreesTrue,
    }));
  }

  function litOn(ship: Object3D): number[] {
    return partsOf(ship)[1]!
      .children.filter((child) => child.visible && child.type === "Points")
      .map((lamp) => ((lamp as Points).material as PointsMaterial).color.getHex());
  }

  /** The watched ship is second in the cast, so second on stage. */
  function watch(watcher: Actor, watched: Actor): number[] {
    const replay = replayOf(scenario([watcher, watched]));
    replay.setView({ kind: "bridge", actorId: "A" });
    return litOn(ships(lastFrame().scene)[1]!);
  }

  function lampsLitOnTheWatched(watcherLon: number): number[] {
    // She heads due north; the watcher lies a kilometre off, east or west, so the bearing
    // of him from her bow is a right angle one way or the other. No boundary to argue with.
    return watch(
      actor("A", moored(0, watcherLon, 0), COASTER),
      actor("B", moored(0, 0, 0), BIG_SHIP),
    );
  }

  it("shows her starboard side to a bridge on her starboard beam", () => {
    const lit = lampsLitOnTheWatched(0.01);

    expect(lit).toContain(GREEN);
    expect(lit).not.toContain(RED);
    // Two masthead lights: she is 180 m, and Rule 23 makes the second one obligatory at 50.
    expect(lit.filter((colour) => colour === WHITE)).toHaveLength(2);
  });

  it("shows her port side to a bridge on her port beam", () => {
    const lit = lampsLitOnTheWatched(-0.01);

    expect(lit).toContain(RED);
    expect(lit).not.toContain(GREEN);
  });

  /**
   * Both ships on the same heading is a case that passes whichever bow the bearing is taken
   * from, so here they differ. The watched ship heads east with the watcher a kilometre due
   * north of her: that is 270 from HER bow, which is her port side, and 0 from HIS, which
   * would be her starboard. Only one of those is the aspect she was actually presenting.
   */
  it("measures the bearing from the bow of the ship carrying the lamps", () => {
    const lit = watch(
      actor("A", moored(0.009, 0, 0), COASTER),
      actor("B", moored(0, 0, 90), BIG_SHIP),
    );

    expect(lit).toContain(RED);
    expect(lit).not.toContain(GREEN);
  });

  /**
   * The other end of the same line. Her lamps and her sectors hang off the group carrying
   * the antenna offset, so the arcs have to be read from the hull's centre - the place they
   * are drawn - and not from the position her track reports.
   *
   * BIG_SHIP's centre is 50 m forward of her antenna and 4 m to starboard of it. Heading
   * north with the watcher 100 m due east of that antenna, the two origins fall on opposite
   * sides of a Rule 21 boundary: 98.9 degrees from the antenna, which is her starboard side,
   * and 124.4 from her centre, which is abaft the beam and therefore her stern light. Twelve
   * degrees of margin either way, so this is not a rounding argument.
   */
  it("reads the arcs from the hull, where the lamps are, and not from the antenna", () => {
    const eastOfHer = toLatLon({ east: 100, north: 0 }, ORIGIN);
    const lit = watch(
      actor("A", moored(eastOfHer.lat, eastOfHer.lon, 0), COASTER),
      actor("B", moored(0, 0, 0), BIG_SHIP),
    );

    expect(lit).not.toContain(GREEN);
    // Her stern light alone: the masthead arc stops 22.5 degrees abaft the beam as well.
    expect(lit.filter((colour) => colour === WHITE)).toHaveLength(1);
  });

  /**
   * The lights a ship shows are for everybody except her. They are screened from her own
   * wheelhouse precisely so they do not spoil the night vision of the person keeping the
   * look-out, and a lamp drawn in the middle of his window is the same error as showing
   * both sidelights at once - a light where no light was.
   */
  it("shows a bridge none of the lights her own ship is carrying", () => {
    const replay = replayOf();
    replay.setView({ kind: "bridge", actorId: "A" });

    expect(litOn(ships(lastFrame().scene)[0]!)).toEqual([]);
  });

  /**
   * The plan view is where the sectors are drawn, and they annotate the lamps. Blanking the
   * lamps there would leave a wedge coming out of nothing.
   */
  it("leaves every lamp lit in the plan view, which is a diagram", () => {
    const replay = replayOf();
    replay.setView({ kind: "bridge", actorId: "A" });
    replay.setView({ kind: "overhead" });

    const lamps = partsOf(ships(lastFrame().scene)[1]!)[1]!.children.filter(
      (child) => child.type === "Points",
    );
    expect(lamps.every((lamp) => lamp.visible)).toBe(true);
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
