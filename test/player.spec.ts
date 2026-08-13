import { OrthographicCamera, PerspectiveCamera, Texture, Vector3 } from "three";
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
  silentPoints,
  westboundPoints,
} from "./fixtures.js";
import { fakeDocument } from "./dom.js";

const gl = vi.hoisted(() => ({
  frames: [] as { scene: Scene; camera: unknown; cleared: boolean }[],
  sizes: [] as [number, number][],
  pixelRatios: [] as number[],
  tiles: [] as ((texture: unknown) => void)[],
  tileUrls: [] as string[],
  disposals: 0,
}));

/**
 * The two parts of three.js that want a browser.
 *
 * Everything else it provides - scenes, geometry, cameras, and the arithmetic that puts a
 * hull where the track says it was - runs in Node exactly as it does in a browser. Standing
 * in for these is what makes the rest of this file reachable, and recording what the
 * renderer was handed is what makes it worth reaching: the camera passed to `render` is the
 * answer to "what was the viewer looking through", which is the question that class exists
 * to settle.
 *
 * `TextureLoader` is here because the basemap asks it for map tiles the moment a stage is
 * built. Its stand-in never calls anything back, which is also the state of a page whose
 * tiles have not arrived - so every test below sees the scene without a map, which is the
 * one the geometry claims in this file are about.
 */
vi.mock("three", async (importOriginal) => {
  const actual = await importOriginal<typeof THREE>();
  return {
    ...actual,
    WebGLRenderer: class {
      autoClear = true;
      setPixelRatio(ratio: number): void {
        gl.pixelRatios.push(ratio);
      }
      setSize(width: number, height: number): void {
        gl.sizes.push([width, height]);
      }
      render(scene: Scene, camera: unknown): void {
        // `cleared` is the state of autoClear at the moment of the draw. An overlay pass
        // has to turn it off and put it back; leaving it off means the next frame is
        // painted on top of this one, which on a dark scene shows up as a smear rather
        // than as anything obviously broken.
        gl.frames.push({ scene, camera, cleared: this.autoClear });
      }
      dispose(): void {
        gl.disposals += 1;
      }
    },
    TextureLoader: class {
      setCrossOrigin(): void {
        // What it guards against is a browser refusing to sample the texture, which no
        // test here can reach.
      }
      load(url: string, onLoad: (texture: unknown) => void): void {
        gl.tileUrls.push(url);
        gl.tiles.push(onLoad);
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

/**
 * The last frame of the SCENE. Nothing is asserted about frames nobody would have seen.
 *
 * Every draw is now two passes - the world, then the captions over it in pixel space - so
 * taking simply the last one would hand back the overlay's own scene and camera, and every
 * claim below about what the viewer was looking through would be about the wrong one.
 */
function lastFrame(): { scene: Scene; camera: unknown } {
  const frame = gl.frames.filter((f) => f.scene.name !== "overlay").at(-1);
  if (!frame) throw new Error("nothing was rendered");
  return frame;
}

/** The captions drawn over that frame, if any were. */
function overlayFrames(): { scene: Scene; camera: unknown; cleared: boolean }[] {
  return gl.frames.filter((f) => f.scene.name === "overlay");
}

/**
 * The cast and the diagram, by name.
 *
 * By name rather than by position among the scene's Groups, because the scene has since
 * grown a third - the basemap - and an index that silently moved would have returned the
 * map where the ships were asked for, with every assertion below still reading sensibly.
 */
function groupsOf(scene: Scene): [Group, Group] {
  const named = (name: string): Group => {
    const group = scene.children.find((child) => child.name === name);
    if (!group) throw new Error(`no ${name} group in the scene`);
    return group as Group;
  };
  return [named("actors"), named("diagram")];
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
  gl.tiles = [];
  gl.tileUrls = [];
  gl.disposals = 0;
  frameCallbacks = [];
  vi.stubGlobal("window", { devicePixelRatio: 1 });
  // The clock caption is written on every frame, so the renderer now wants a 2D canvas
  // from the first one - there is no longer a path through this class that draws no text.
  vi.stubGlobal("document", fakeDocument());
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

  /**
   * The automatic framing is the right default and the wrong thing to be stuck with, so a
   * scale can be stated - and a stated one is also the only way two frames can be compared,
   * since a distance read off a picture whose zoom moved on its own means nothing.
   */
  it("holds the plan view at a scale when given one", () => {
    const replay = replayOf();
    replay.setScale(4000);
    replay.seek(replay.endSeconds);

    const camera = lastFrame().camera as OrthographicCamera;
    expect(camera.top - camera.bottom).toBeCloseTo(4000, 6);
  });

  /**
   * The floor on the automatic framing stops the frame collapsing onto two hulls at the
   * moment they touch when nobody asked it to. Somebody choosing 200 m has asked, and a
   * control silently refusing the value it was set to is worse than no control.
   */
  it("lets a chosen scale go closer than the automatic framing would", () => {
    const replay = replayOf();
    replay.setScale(200);

    const camera = lastFrame().camera as OrthographicCamera;
    expect(camera.top - camera.bottom).toBeCloseTo(200, 6);
    expect(200).toBeLessThan(BIG_SHIP.loaMetres * 7);
  });

  it("goes back to following the ships when the scale is cleared", () => {
    const replay = replayOf();
    replay.setScale(200);
    replay.setScale(null);
    replay.seek(replay.endSeconds);

    const camera = lastFrame().camera as OrthographicCamera;
    expect(camera.top - camera.bottom).toBeGreaterThanOrEqual(BIG_SHIP.loaMetres * 7);
  });

  // Only the scale. The frame still centres on whoever is on stage, which is what makes it
  // a picture of the encounter rather than of a patch of sea.
  it("keeps the frame on the ships at a chosen scale", () => {
    const replay = replayOf();
    replay.setScale(4000);

    const camera = lastFrame().camera as OrthographicCamera;
    const ship = ships(lastFrame().scene)[0]!.position;
    expect(Math.abs(camera.position.x - ship.x)).toBeLessThan(4000);
  });

  /**
   * Tracks rarely start together - in this project's reference case one transponder is
   * recorded half an hour before the other - and a frame that held only what was on stage
   * collapsed onto a single ship for the first ninety seconds of the replay, which is the
   * part meant to show two ships approaching from opposite ends of the sea.
   *
   * The ship herself stays hidden until her own record begins. It is the frame that has to
   * hold her, and what fills the space until she appears is her track line.
   */
  it("holds every ship in the case, including one whose track has not reached this moment", () => {
    const subject = scenario([
      actor("A", northboundPoints(), COASTER),
      actor("B", westboundPoints().slice(0, 2), BIG_SHIP),
    ]);
    const replay = replayOf(subject);
    replay.seek(replay.endSeconds);

    const track = prepareActor(subject.actors[1]!, subject.origin);
    const parted = toWorld(sampleAt(track, track.endSeconds)!.position);
    const camera = lastFrame().camera as OrthographicCamera;

    expect(ships(lastFrame().scene)[1]!.visible, "her track ended a minute ago").toBe(false);
    expect(Math.abs(parted.x - camera.position.x), "and she is still in frame").toBeLessThan(
      (camera.right - camera.left) / 2,
    );
    expect(Math.abs(parted.z - camera.position.z)).toBeLessThan((camera.top - camera.bottom) / 2);
  });

  /**
   * What the wheel over the picture starts from. Reporting the scale in use, rather than
   * the one that was set, is the whole of it: on automatic nothing has been set, and a
   * control that started from that would send the first notch to an end of the range
   * instead of to the step next to what is on screen.
   */
  it("reports how much sea it is showing, set or not", () => {
    const replay = replayOf();
    replay.seek(replay.endSeconds);
    const framed = replay.planExtentMetres;
    expect(framed).toBeGreaterThan(0);

    replay.setScale(4000);
    expect(replay.planExtentMetres).toBeCloseTo(4000, 6);
    replay.setScale(null);
    expect(replay.planExtentMetres).toBeCloseTo(framed, 6);
  });

  /**
   * The frame follows the ships until somebody takes it somewhere else. In pixels because
   * the caller has a pointer and this class has the projection: on a canvas 400 px tall
   * showing 4 km, one pixel is ten metres.
   *
   * The ground goes the way the pointer goes, so the frame goes the other way. Pull the
   * picture thirty pixels right and the view has moved three hundred metres WEST; pull it
   * ten pixels down and the view has moved a hundred metres NORTH, because screen up is
   * north. Get either sign wrong and the map slides away from the pointer instead of
   * sticking to it, which is the one thing a drag has to do.
   */
  it("moves the plan view by a drag, in metres worked out from the scale", () => {
    const replay = replayOf(scenario(), fakeCanvas(800, 400));
    replay.setScale(4000);
    const before = (lastFrame().camera as OrthographicCamera).position.clone();

    replay.panByPixels(30, 10);
    const after = (lastFrame().camera as OrthographicCamera).position;

    expect(after.x - before.x, "west, ten metres a pixel").toBeCloseTo(-300, 6);
    // World Z is south, so a hundred metres north is a hundred less Z.
    expect(after.z - before.z, "and north").toBeCloseTo(-100, 6);
  });

  it("keeps the drag where it was put as playback runs on", () => {
    const replay = replayOf();
    replay.setScale(4000);
    replay.panByPixels(100, 0);
    const dragged = (lastFrame().camera as OrthographicCamera).position.x;

    replay.seek(replay.startSeconds + 60);
    expect((lastFrame().camera as OrthographicCamera).position.x).toBeCloseTo(dragged, 6);
  });

  it("follows the ships again when handed back", () => {
    const replay = replayOf();
    const following = (lastFrame().camera as OrthographicCamera).position.x;

    replay.panByPixels(200, 0);
    expect((lastFrame().camera as OrthographicCamera).position.x).not.toBeCloseTo(following, 6);

    replay.recentre();
    expect((lastFrame().camera as OrthographicCamera).position.x).toBeCloseTo(following, 6);
  });

  // A drag is only the centre. Zooming out still opens to the ships' separation, which is
  // what makes the two worth overriding separately.
  it("leaves the scale alone when the view is dragged", () => {
    const replay = replayOf();
    const extent = replay.planExtentMetres;
    replay.panByPixels(50, 50);
    expect(replay.planExtentMetres).toBeCloseTo(extent, 6);
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
    // Away from the very start, so this is a resume rather than an opening: the opening
    // shot holds the clock while the camera flies in, which is its own case below.
    replay.seek(replay.startSeconds + 10);
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
    replay.seek(replay.startSeconds + 10);
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

describe("what the frame says about itself", () => {
  /**
   * Both captions are drawn INTO the picture, not beside it. Recording goes through
   * `canvas.captureStream()`, which copies the drawing buffer and nothing else - so a
   * caption in the page around the canvas is absent from every video the page produces.
   */
  function captionsOf(): Object3D[] {
    return overlayFrames().at(-1)!.scene.children;
  }

  function deliverATile(): void {
    gl.tiles[0]!(new Texture());
  }

  it("asks for map tiles as soon as there is a stage", () => {
    replayOf();
    expect(gl.tileUrls.length).toBeGreaterThan(0);
  });

  /**
   * The clock goes on every frame. It is the one thing a recording cannot recover for
   * itself, and the plan view no longer says night by being dark - so if the picture does
   * not state the time, a night collision reads as an afternoon one.
   */
  it("draws the captions over the picture, in pixel space", () => {
    const replay = replayOf();
    gl.frames = [];
    replay.seek(replay.startSeconds + 30);

    const [picture, captions] = gl.frames;
    expect(gl.frames).toHaveLength(2);
    expect(captions!.scene).not.toBe(picture!.scene);
    expect((captions!.camera as OrthographicCamera).right, "canvas pixels").toBe(800);
  });

  it("keeps the clock showing whichever view is up", () => {
    const replay = replayOf();
    expect(captionsOf()[0]!.visible, "from above").toBe(true);
    replay.setView({ kind: "bridge", actorId: "A" });
    expect(captionsOf()[0]!.visible, "and from a bridge").toBe(true);
  });

  /**
   * Off for the overlay and back on afterwards. Left off, the next frame is painted over
   * the last one - which on a night scene reads as motion blur rather than as a fault.
   */
  it("puts the frame buffer back to clearing itself", () => {
    const replay = replayOf();
    expect(overlayFrames().at(-1)!.cleared).toBe(false);

    replay.seek(replay.startSeconds + 30);
    expect(gl.frames.at(-2)!.cleared).toBe(true);
  });

  // A page whose tiles never came back must not carry a line crediting the map it did not
  // draw. Having asked for them is not having got them.
  it("credits no map until a tile has arrived", () => {
    replayOf();
    expect(captionsOf()[1]!.visible).toBe(false);

    deliverATile();
    expect(captionsOf()[1]!.visible).toBe(true);
  });

  // The map is drawn from above and not from a bridge, so from a bridge there is again
  // nothing to credit.
  it("does not credit a map over a view that is not showing one", () => {
    const replay = replayOf();
    deliverATile();

    replay.setView({ kind: "bridge", actorId: "A" });
    expect(captionsOf()[1]!.visible).toBe(false);
  });
});

/**
 * A reconstruction answers "what happened" and says nothing about "where". Framed on the
 * action from the first frame, every case looks like the same patch of open water - so
 * pressing play opens a thousand kilometres out, holds the clock while the camera closes
 * in, and lets go where the encounter starts.
 */
describe("the opening shot", () => {
  function playFromTheTop(): InstanceType<typeof Replay> {
    vi.useFakeTimers();
    const replay = replayOf();
    replay.play();
    return replay;
  }

  function runFor(milliseconds: number): void {
    vi.advanceTimersByTime(milliseconds);
    frameCallbacks.pop()!();
  }

  it("opens far enough out to hold a country", () => {
    const replay = replayOf();
    const settled = replay.planExtentMetres;
    vi.useFakeTimers();
    replay.play();

    expect(replay.planExtentMetres).toBeCloseTo(1_000_000, -1);
    expect(replay.planExtentMetres).toBeGreaterThan(settled * 10);
  });

  it("holds the clock while the camera is still travelling", () => {
    const replay = playFromTheTop();
    runFor(1000);
    expect(replay.timeSeconds).toBe(replay.startSeconds);
  });

  it("closes in, and lets go where the encounter starts", () => {
    const replay = playFromTheTop();
    runFor(1000);
    const partway = replay.planExtentMetres;
    expect(partway).toBeLessThan(1_000_000);

    runFor(4000);
    expect(replay.planExtentMetres).toBeLessThan(partway);
    expect(replay.timeSeconds, "and the clock is running again").toBe(replay.startSeconds);

    runFor(100);
    expect(replay.timeSeconds).toBeGreaterThan(replay.startSeconds);
  });

  // Resuming after a pause is not an opening: flying out to a thousand kilometres in the
  // middle of an encounter loses the reader's place rather than giving them one.
  it("does not run when playback is resumed part way through", () => {
    vi.useFakeTimers();
    const replay = replayOf();
    replay.seek(replay.startSeconds + 30);
    const settled = replay.planExtentMetres;

    replay.play();
    expect(replay.planExtentMetres).toBeCloseTo(settled, 6);
  });

  // A chosen scale is somebody having said where they want to be looking.
  it("does not overrule a scale that was chosen", () => {
    vi.useFakeTimers();
    const replay = replayOf();
    replay.setScale(4000);
    replay.play();

    expect(replay.planExtentMetres).toBeCloseTo(4000, 6);
  });

  it("gets out of the way as soon as the view is touched", () => {
    const replay = playFromTheTop();
    runFor(500);
    expect(replay.planExtentMetres).toBeGreaterThan(100_000);

    replay.setScale(null);
    expect(replay.planExtentMetres, "back to following the ships at once").toBeLessThan(100_000);
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
