import { Texture } from "three";
import type * as THREE from "three";
import type { Group, Mesh, MeshBasicMaterial, PlaneGeometry } from "three";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Frame } from "../src/render/basemap.js";

const server = vi.hoisted(() => ({
  requests: [] as { url: string; onLoad: (texture: unknown) => void; onError: () => void }[],
}));

/**
 * The tile server, stood in for.
 *
 * `TextureLoader` is the only thing in this layer that needs a browser - it builds an
 * <img> and waits for it - and standing in for it is what turns "did the right tiles get
 * asked for, and what happens to the ones that never come back" into questions a test can
 * put. Holding the callbacks rather than calling them is the point: a tile that has not
 * arrived yet and one that never will are different states, and both are ordinary.
 */
vi.mock("three", async (importOriginal) => {
  const actual = await importOriginal<typeof THREE>();
  return {
    ...actual,
    TextureLoader: class {
      setCrossOrigin(): void {
        // Recorded nowhere: what it guards against is a browser refusing to sample the
        // texture, which no test here can reach.
      }
      load(
        url: string,
        onLoad: (texture: unknown) => void,
        _onProgress: undefined,
        onError: () => void,
      ): void {
        server.requests.push({ url, onLoad, onError });
      }
    },
  };
});

const { buildBasemap } = await import("../src/render/basemap.js");
const { buildScene } = await import("../src/render/scene.js");

/** Suo-nada, near enough the reference case's patch of sea. */
const ORIGIN = { lat: 33.905, lon: 131.7116667 };

const TILE_URL = /^https:\/\/cyberjapandata\.gsi\.go\.jp\/xyz\/pale\/(\d+)\/(\d+)\/(\d+)\.png$/;

type TileMesh = Mesh<PlaneGeometry, MeshBasicMaterial>;

function frame(extentMetres: number, east = 0, north = 0): Frame {
  return { centre: { east, north }, extentMetres, aspect: 2 };
}

function meshesOf(group: Group): TileMesh[] {
  return group.children as TileMesh[];
}

function mapOver(view: Frame, onFirstTile: () => void = () => undefined): Group {
  const basemap = buildBasemap(ORIGIN, 0xffffff, onFirstTile);
  basemap.setView(view);
  return basemap.group;
}

function zoomOf(index: number): number {
  const parts = TILE_URL.exec(server.requests[index]!.url);
  return Number(parts![1]);
}

function deliver(index: number): void {
  server.requests[index]!.onLoad(new Texture());
}

beforeEach(() => {
  server.requests = [];
  // The layer holds a fetch back until the view has stopped moving, so these have to be
  // able to say when it has.
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

/** Let the view settle, which is what releases a fetch that was waiting on it. */
function settle(): void {
  vi.advanceTimersByTime(500);
}

describe("what it asks for", () => {
  /**
   * What to fetch is a question about the frame, and at construction there is not one yet.
   * A layer that guessed would spend a page load's worth of requests on ground the camera
   * turns out not to be looking at.
   */
  it("fetches nothing until it has been told what is in view", () => {
    buildBasemap(ORIGIN, 0xffffff, () => undefined);
    expect(server.requests).toHaveLength(0);
  });

  it("fetches the pale sheet from the Authority's own server", () => {
    mapOver(frame(20000));

    expect(server.requests.length).toBeGreaterThan(0);
    for (const request of server.requests) expect(request.url).toMatch(TILE_URL);
  });

  // A public server, asked on every page load and again whenever the view moves.
  it("stays within a page load's worth of tiles", () => {
    mapOver(frame(20000));
    expect(server.requests.length).toBeLessThanOrEqual(128);
  });

  /**
   * The whole point of following the view. One level cannot serve a range of more than a
   * hundred to one, and the first version of this layer - a fixed patch at a fixed zoom -
   * showed a map over a middling band of zooms and nothing at either end.
   */
  it("asks for a sharper level when the view closes in", () => {
    mapOver(frame(50000));
    const wide = zoomOf(0);

    server.requests = [];
    mapOver(frame(2000));
    expect(zoomOf(0)).toBeGreaterThan(wide);
  });

  /**
   * A continuous zoom passes through every level between where it started and where it
   * stops. Fetching each of them asked a public server for something like four hundred
   * images on every press of play, three levels' worth of which were on screen for a few
   * hundred milliseconds on the way past.
   */
  it("does not fetch the levels a moving view passes through", () => {
    const basemap = buildBasemap(ORIGIN, 0xffffff, () => undefined);
    basemap.setView(frame(400000));
    const opening = server.requests.length;

    for (const extent of [200000, 100000, 50000, 20000]) basemap.setView(frame(extent));
    expect(server.requests, "nothing yet: it is still moving").toHaveLength(opening);

    settle();
    expect(server.requests.length, "one level, once it has stopped").toBeGreaterThan(opening);
    expect(zoomOf(opening), "and it is the level it stopped at").toBe(
      zoomOf(server.requests.length - 1),
    );
  });

  // An empty plane has no picture to hold while waiting, so the first fetch does not wait.
  it("fetches the first level without waiting", () => {
    const basemap = buildBasemap(ORIGIN, 0xffffff, () => undefined);
    basemap.setView(frame(20000));
    expect(server.requests.length).toBeGreaterThan(0);
  });
});

describe("when it goes back for more", () => {
  // The fetched box is padded well past the frame precisely so that following two ships
  // across the picture does not refetch on every frame of the replay.
  it("says nothing while the view moves inside what it already has", () => {
    const basemap = buildBasemap(ORIGIN, 0xffffff, () => undefined);
    basemap.setView(frame(10000));
    const asked = server.requests.length;

    basemap.setView(frame(10000, 500, 200));
    expect(server.requests).toHaveLength(asked);
  });

  it("goes back when the view leaves it", () => {
    const basemap = buildBasemap(ORIGIN, 0xffffff, () => undefined);
    basemap.setView(frame(10000));
    const asked = server.requests.length;

    basemap.setView(frame(10000, 40000));
    settle();
    expect(server.requests.length).toBeGreaterThan(asked);
  });

  /**
   * Zooming in never leaves the box that was fetched, so a layer that only asked "is the
   * frame still inside it" would hold whatever level it first loaded - a map that is right
   * at one scale and wrong at every other, which is the fault this replaced.
   */
  it("goes back when the view zooms in without leaving it", () => {
    const basemap = buildBasemap(ORIGIN, 0xffffff, () => undefined);
    basemap.setView(frame(10000));
    const asked = server.requests.length;

    basemap.setView(frame(2500));
    settle();
    expect(server.requests.length).toBeGreaterThan(asked);
    expect(zoomOf(asked)).toBeGreaterThan(zoomOf(0));
  });

  /**
   * The replacement's tiles are invisible until their images land, so clearing the old
   * level first blinks the map out every time the zoom crosses a power of two.
   */
  it("keeps the level it is showing until the next one has something to show", () => {
    const basemap = buildBasemap(ORIGIN, 0xffffff, () => undefined);
    basemap.setView(frame(10000));
    deliver(0);
    const showing = meshesOf(basemap.group).filter((mesh) => mesh.visible);

    const asked = server.requests.length;
    basemap.setView(frame(2500));
    settle();
    expect(meshesOf(basemap.group)).toEqual(expect.arrayContaining(showing));

    deliver(asked);
    expect(meshesOf(basemap.group)).not.toEqual(expect.arrayContaining(showing));
  });

  // Outside the tile set's coverage nothing ever arrives. Holding what was already drawn
  // beats clearing the plane for a level that is never going to appear.
  it("keeps it indefinitely if the next level never arrives", () => {
    const basemap = buildBasemap(ORIGIN, 0xffffff, () => undefined);
    basemap.setView(frame(10000));
    deliver(0);

    const asked = server.requests.length;
    basemap.setView(frame(2500));
    settle();
    for (const request of server.requests.slice(asked)) request.onError();

    expect(meshesOf(basemap.group).some((mesh) => mesh.visible)).toBe(true);
  });
});

describe("where the tiles are put", () => {
  /**
   * The claim this layer rests on. Tiles are Web Mercator and the scene is metres on a
   * flat local plane, and the two agree only if each tile is placed on its own corner
   * coordinates. Scale the whole sheet by one factor instead - the obvious shortcut - and
   * the rows stop meeting: the gaps or overlaps are metres wide, and they accumulate into
   * a coastline tens of metres from where the land is.
   *
   * Checked as abutment rather than against expected coordinates, because a test that
   * recomputed the placement would agree with the code however wrong both were.
   */
  it("lays every row exactly against the next, with no gap and no overlap", () => {
    const group = mapOver(frame(20000));
    const first = meshesOf(group)[0]!;
    const column = meshesOf(group)
      .filter((mesh) => Math.abs(mesh.position.x - first.position.x) < 0.001)
      .sort((a, b) => a.position.z - b.position.z);

    expect(column.length).toBeGreaterThan(2);
    for (const [index, mesh] of column.slice(1).entries()) {
      const above = column[index]!;
      const southEdgeOfAbove = above.position.z + above.geometry.parameters.height / 2;
      expect(mesh.position.z - mesh.geometry.parameters.height / 2).toBeCloseTo(
        southEdgeOfAbove,
        6,
      );
    }
  });

  // Rows differ in height by the projection's stretch, which is the whole reason they are
  // placed one at a time. Equal heights would mean the shortcut had crept back in.
  it("gives the rows different heights, because Mercator stretches", () => {
    const basemap = buildBasemap({ lat: 60, lon: 0 }, 0xffffff, () => undefined);
    basemap.setView(frame(200000));

    const heights = meshesOf(basemap.group).map((mesh) => mesh.geometry.parameters.height);
    expect(new Set(heights.map((h) => h.toFixed(3))).size).toBeGreaterThan(1);
  });

  it("lies flat on the water, just clear of it", () => {
    const mesh = meshesOf(mapOver(frame(20000)))[0]!;
    expect(mesh.rotation.x).toBeCloseTo(-Math.PI / 2, 9);
    expect(mesh.position.y).toBeGreaterThan(0);
    expect(mesh.position.y).toBeLessThan(1);
  });
});

describe("tiles that arrive, and tiles that do not", () => {
  /**
   * A tile shown before its image lands is a flat rectangle of the tint colour. Over water
   * that reads as a feature - a shoal, a bank - rather than as a tile that is still on its
   * way, which is the one thing a reconstruction must not draw.
   */
  it("keeps a tile hidden until its own image arrives", () => {
    const group = mapOver(frame(20000));
    expect(meshesOf(group).some((mesh) => mesh.visible)).toBe(false);

    deliver(0);
    expect(meshesOf(group)[0]!.visible).toBe(true);
    expect(meshesOf(group)[1]!.visible).toBe(false);
  });

  // The tile set covers Japan, so any scene near its edge asks for tiles that were never
  // drawn and gets a 404. That is the ordinary case, not a failure to report.
  it("leaves out a tile the server does not have", () => {
    const group = mapOver(frame(20000));
    server.requests[0]!.onError();
    expect(meshesOf(group)[0]!.visible).toBe(false);
  });

  /**
   * The credit hangs off this, so it is the difference between attributing a map and
   * claiming one. A scene outside the tile set's coverage draws no map, and must not carry
   * a line saying where its map came from.
   */
  it("reports the first tile once, and only once one has arrived", () => {
    const arrivals = vi.fn();
    mapOver(frame(20000), arrivals);
    expect(arrivals).not.toHaveBeenCalled();

    deliver(0);
    deliver(1);
    expect(arrivals).toHaveBeenCalledTimes(1);
  });

  it("never reports one when every tile fails", () => {
    const arrivals = vi.fn();
    mapOver(frame(20000), arrivals);
    for (const request of server.requests) request.onError();
    expect(arrivals).not.toHaveBeenCalled();
  });
});

describe("closer in than any published tile", () => {
  function opacityAt(extentMetres: number): number {
    return meshesOf(mapOver(frame(extentMetres)))[0]!.material.opacity;
  }

  it("draws the map at every zoom the tiles reach", () => {
    for (const extent of [100000, 20000, 3000, 400]) {
      expect(opacityAt(extent), `${extent} m across`).toBe(1);
    }
  });

  /**
   * The one case the pyramid cannot answer, kept as a guard rather than as behaviour
   * anybody sees: the plan view will not frame closer than a few ship lengths, and the
   * sharpest published level resolves that comfortably. Past it, a few dozen map pixels
   * stretched over the screen are not a coastline but a smear whose edge is tens of metres
   * from the land.
   */
  it("fades out below the sharpest level that exists", () => {
    expect(opacityAt(30)).toBeLessThan(1);
    expect(opacityAt(10)).toBe(0);
  });
});

describe("through the scene", () => {
  it("asks for nothing when the scene was built without a map", () => {
    const parts = buildScene({ lightCondition: "night" }, 5000);
    parts.setView(frame(5000));

    expect(server.requests).toHaveLength(0);
    expect(parts.scene.children.some((child) => child.name === "basemap")).toBe(false);
  });

  it("puts the map in the scene when it was", () => {
    const parts = buildScene({ lightCondition: "night" }, 20000, {
      origin: ORIGIN,
      onFirstTile: () => undefined,
      onFirstLandTile: () => undefined,
    });
    parts.setView(frame(20000));

    expect(parts.scene.children.some((child) => child.name === "basemap")).toBe(true);
    expect(server.requests.length).toBeGreaterThan(0);
  });

  /**
   * Flat on the water the map is a chart seen from above and a pale sheet lying on the sea
   * from a wheelhouse window, where the land it describes would be a dark shape on the
   * horizon or nothing at all. It goes the same way as the light arcs and the track lines.
   */
  it("shows the map from above and not from a bridge", () => {
    const parts = buildScene(undefined, 20000, {
      origin: ORIGIN,
      onFirstTile: () => undefined,
      onFirstLandTile: () => undefined,
    });
    const map = parts.scene.children.find((child) => child.name === "basemap")!;

    parts.setDiagramView(true);
    expect(map.visible).toBe(true);
    parts.setDiagramView(false);
    expect(map.visible).toBe(false);
  });
});
