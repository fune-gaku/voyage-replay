import type { Mesh, MeshBasicMaterial, PlaneGeometry } from "three";
import { afterEach, describe, expect, it, vi } from "vitest";

import { buildOverlay, type Overlay } from "../src/render/overlay.js";
import { fakeDocument } from "./dom.js";

function stubDocument(withContext = true): void {
  vi.stubGlobal("document", fakeDocument(withContext));
}

type Plaque = Mesh<PlaneGeometry, MeshBasicMaterial>;

function plaquesOf(overlay: Overlay): Plaque[] {
  return overlay.scene.children as Plaque[];
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("before anything has been said", () => {
  /**
   * Nothing is built until a caption is given words, and that is not an optimisation. A
   * page whose map tiles never came back carries no credit for a map it did not draw - and
   * a caption nobody writes to never touches the DOM, which is what lets this run outside
   * a browser at all.
   */
  it("draws nothing, and says so", () => {
    const overlay = buildOverlay();
    overlay.caption("top-right", "figures");
    expect(overlay.showing).toBe(false);
  });

  it("takes a resize with nothing on it", () => {
    const overlay = buildOverlay();
    expect(() => {
      overlay.resize(800, 400);
    }).not.toThrow();
  });
});

describe("saying something", () => {
  it("shows it, and stops showing it when there is nothing to say", () => {
    stubDocument();
    const overlay = buildOverlay();
    const clock = overlay.caption("top-right", "figures");

    clock.set("18:13:30");
    expect(overlay.showing).toBe(true);
    clock.set("");
    expect(overlay.showing).toBe(false);
  });

  it("sizes a caption to its words", () => {
    stubDocument();
    const overlay = buildOverlay();
    const short = overlay.caption("top-right", "figures");
    const long = overlay.caption("bottom-right", "text");
    short.set("A");
    long.set("A much longer line of attribution");

    const [first, second] = plaquesOf(overlay);
    expect(second!.geometry.parameters.width).toBeGreaterThan(first!.geometry.parameters.width);
  });

  /**
   * A clock is rewritten many times a second at any useful playback speed. Reusing the
   * canvas and the texture is what keeps that from being a new geometry, a new texture and
   * a discarded pair of both on every frame - which is also why the figures are monospaced.
   */
  it("keeps the same geometry while the words stay the same width", () => {
    stubDocument();
    const overlay = buildOverlay();
    const clock = overlay.caption("top-right", "figures");

    clock.set("18:13:30");
    const first = plaquesOf(overlay)[0]!.geometry;
    clock.set("18:13:31");
    expect(plaquesOf(overlay)[0]!.geometry).toBe(first);
  });

  it("rebuilds it when they do not", () => {
    stubDocument();
    const overlay = buildOverlay();
    const caption = overlay.caption("top-right", "text");

    caption.set("short");
    const first = plaquesOf(overlay)[0]!.geometry;
    caption.set("a great deal longer than before");
    expect(plaquesOf(overlay)[0]!.geometry).not.toBe(first);
  });

  it("says what is wrong when the browser will not give it a canvas to draw on", () => {
    stubDocument(false);
    const caption = buildOverlay().caption("top-right", "text");
    expect(() => {
      caption.set("18:13:30");
    }).toThrow(/2d canvas/);
  });
});

describe("where in the frame they sit", () => {
  /**
   * The overlay's camera measures in canvas pixels, so a caption is the same size in the
   * corner of the frame whichever of the scene's two moving cameras drew it and whatever
   * the canvas has been resized to.
   */
  it("spans the canvas in pixels", () => {
    const overlay = buildOverlay();
    overlay.resize(800, 400);

    expect(overlay.camera.left).toBe(0);
    expect(overlay.camera.bottom).toBe(0);
    expect(overlay.camera.right).toBe(800);
    expect(overlay.camera.top).toBe(400);
  });

  it("puts each in the corner it was asked for", () => {
    stubDocument();
    const overlay = buildOverlay();
    const top = overlay.caption("top-right", "figures");
    const bottom = overlay.caption("bottom-right", "text");
    overlay.resize(800, 400);
    top.set("18:13:30");
    bottom.set("地理院タイル");

    const [above, below] = plaquesOf(overlay);
    expect(above!.position.y + above!.geometry.parameters.height / 2).toBeCloseTo(390, 6);
    expect(below!.position.y - below!.geometry.parameters.height / 2).toBeCloseTo(10, 6);
    for (const plaque of [above!, below!]) {
      expect(plaque.position.x + plaque.geometry.parameters.width / 2).toBeCloseTo(790, 6);
    }
  });

  // Written first, then resized: a caption has to move to the new corner rather than stay
  // at the one it was placed in.
  it("moves to the corner when the canvas changes size", () => {
    stubDocument();
    const overlay = buildOverlay();
    const caption = overlay.caption("bottom-right", "text");
    caption.set("地理院タイル");
    const before = plaquesOf(overlay)[0]!.position.x;

    overlay.resize(1600, 400);
    expect(plaquesOf(overlay)[0]!.position.x).toBeGreaterThan(before);
  });

  // A canvas laid out at zero height would otherwise put a caption at a negative
  // coordinate, outside its own frustum, where it renders as nothing at all.
  it("survives a canvas with no height yet", () => {
    stubDocument();
    const overlay = buildOverlay();
    overlay.caption("top-right", "figures").set("18:13:30");
    overlay.resize(800, 0);

    expect(overlay.camera.top).toBeGreaterThan(0);
  });
});
