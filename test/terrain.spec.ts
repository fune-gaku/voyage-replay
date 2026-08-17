import { MeshBasicMaterial } from "three";
import type * as THREE from "three";
import type { Group, Mesh } from "three";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { heightAt, SEA_METRES, thin } from "../src/render/dem.js";
import {
  encodeHeights,
  settleTiles,
  stubElevationServer,
  type ElevationServer,
} from "./elevation.js";

/**
 * The tile server and the canvas, stood in for.
 *
 * Both are what a height field needs and a basemap does not: the bytes are counted on the
 * way past, and the pixels are READ rather than sampled, which is a canvas round trip. None
 * of it needs a browser once `fetch`, `createImageBitmap` and `OffscreenCanvas` will answer
 * - which is the same finding as `record.ts` and `player.ts`, where the cheap stand-in
 * turned out to be enough and the exclusion had been guessed at.
 *
 * `TextureLoader` is mocked for the basemap that `buildScene` puts in the same scene; it is
 * the one thing in that layer that really does want an <img>.
 */
vi.mock("three", async (importOriginal) => {
  const actual = await importOriginal<typeof THREE>();
  return {
    ...actual,
    TextureLoader: class {
      setCrossOrigin(): void {
        // Nothing here can reach what it guards against.
      }
      load(): void {
        // The basemap's tiles never arrive in these tests, which is one of the states.
      }
    },
  };
});

const { buildTerrain, heightField, wantedTiles, TERRAIN_CREDIT } =
  await import("../src/render/terrain.js");
const { buildWater } = await import("../src/render/water.js");
const { applyCurvature, makeCurvatureUniforms } = await import("../src/render/curvature.js");
const { buildScene } = await import("../src/render/scene.js");

/** Suo-nada, the reference case's patch of sea. */
const ORIGIN = { lat: 33.905, lon: 131.7116667 };

const TILE_URL = /\/xyz\/dem_png\/(\d+)\/(\d+)\/(\d+)\.png$/;

let server: ElevationServer;
let asked: string[];

beforeEach(() => {
  server = stubElevationServer();
  asked = server.asked;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function landIn(group: Group): Mesh[] {
  return group.children as Mesh[];
}

describe("decoding one pixel", () => {
  it("follows the published formula: x = 2^16 R + 2^8 G + B, one unit a centimetre", () => {
    expect(heightAt(new Uint8ClampedArray([0, 0, 0, 255]), 0)).toBe(0);
    expect(heightAt(new Uint8ClampedArray([0, 0, 1, 255]), 0)).toBeCloseTo(0.01, 6);
    expect(heightAt(new Uint8ClampedArray([0, 1, 0, 255]), 0)).toBeCloseTo(2.56, 6);
    expect(heightAt(new Uint8ClampedArray([1, 0, 0, 255]), 0)).toBeCloseTo(655.36, 6);
  });

  it("reads anything above 2^23 as negative, not as a mountain range", () => {
    // (255,255,255) is one below 2^24, so a centimetre below the datum.
    expect(heightAt(new Uint8ClampedArray([255, 255, 255, 255]), 0)).toBeCloseTo(-0.01, 6);
  });

  it("treats (128, 0, 0) as no data, which over the sea is most of the tile", () => {
    expect(heightAt(new Uint8ClampedArray([128, 0, 0, 255]), 0)).toBe(SEA_METRES);
  });

  it("reads a pixel at an offset rather than only the first", () => {
    const two = new Uint8ClampedArray([0, 0, 0, 255, 0, 1, 0, 255]);
    expect(heightAt(two, 4)).toBeCloseTo(2.56, 6);
  });
});

describe("thinning a tile to the grid that is drawn", () => {
  it("samples the corners, so neighbouring tiles meet at their shared edge", () => {
    const pixels = encodeHeights(Array.from({ length: 16 }, (_, i) => i));
    const grid = thin(pixels, 4, 2);

    // North-west, north-east, south-west, south-east of a 4 x 4 image.
    expect([...grid.metres]).toEqual([0, 3, 12, 15]);
  });

  it("reports the highest sample it kept", () => {
    const grid = thin(
      encodeHeights([0, 5, 5, 0, 5, 900, 900, 5, 5, 900, 900, 5, 0, 5, 5, 0]),
      4,
      2,
    );
    // The summit is in the middle and falls between samples - which is the known cost of
    // nearest-neighbour thinning, recorded in dem.ts rather than papered over here.
    expect(grid.highestMetres).toBe(0);
  });

  it("has nothing above the sea in a tile that is all no-data", () => {
    const pixels = encodeHeights(Array.from({ length: 16 }, () => NaN));
    expect(thin(pixels, 4, 2).highestMetres).toBe(SEA_METRES);
  });
});

describe("laying a height field into the world's axes", () => {
  const grid = { size: 2, metres: new Float32Array([1, 2, 3, 4]), highestMetres: 4 };

  it("spans exactly the tile's own box, so neighbours touch with no seam of their own", () => {
    const vertices = [...heightField(grid, 200, 100)];
    const east = [vertices[0], vertices[3], vertices[6], vertices[9]];
    expect(east).toEqual([-100, 100, -100, 100]);
  });

  it("puts the image's first row at the NORTH edge, which is negative Z", () => {
    const vertices = heightField(grid, 200, 100);
    expect(vertices[2]).toBe(-50);
    expect(vertices[8]).toBe(50);
  });

  it("carries each sample's height into Y", () => {
    const vertices = heightField(grid, 200, 100);
    expect([vertices[1], vertices[4], vertices[7], vertices[10]]).toEqual([1, 2, 3, 4]);
  });
});

describe("choosing which tiles a bridge wants", () => {
  const eye = { east: 0, north: 0 };

  function bearingTo(tile: { z: number; x: number; y: number }): number {
    // The tile's own centre, back through the same projection the layer uses.
    const size = 360 / 2 ** tile.z;
    const lon = -180 + (tile.x + 0.5) * size;
    const north = Math.atan(Math.sinh(Math.PI * (1 - (2 * (tile.y + 0.5)) / 2 ** tile.z)));
    const east = (lon - ORIGIN.lon) * 111_120 * Math.cos((ORIGIN.lat * Math.PI) / 180);
    const northing = ((north * 180) / Math.PI - ORIGIN.lat) * 111_120;
    return {
      bearing: (Math.atan2(east, northing) * 180) / Math.PI,
      distance: Math.hypot(east, northing),
    }.bearing;
  }

  it("wants nothing astern", () => {
    const wanted = wantedTiles(eye, 0, ORIGIN);
    expect(wanted.length).toBeGreaterThan(0);
    for (const tile of wanted) {
      const off = Math.abs(((((bearingTo(tile) - 0) % 360) + 540) % 360) - 180);
      // 90 rather than 45: a tile close to the eye subtends a wide angle and is kept if any
      // of it is in the wedge, which is what stops a notch appearing at the edge of frame.
      expect(off).toBeLessThan(90);
    }
  });

  it("turns the ship and gets a different coast", () => {
    const ahead = new Set(wantedTiles(eye, 0, ORIGIN).map((t) => `${t.z}/${t.x}/${t.y}`));
    const astern = wantedTiles(eye, 180, ORIGIN).map((t) => `${t.z}/${t.x}/${t.y}`);
    const shared = astern.filter((key) => ahead.has(key));
    // The near ring is a couple of tiles across, so the two wedges overlap around the eye;
    // most of what each wants is its own.
    expect(shared.length).toBeLessThan(astern.length / 2);
  });

  it("asks for coarser tiles further out and never finer than the source has", () => {
    const zooms = new Set(wantedTiles(eye, 0, ORIGIN).map((tile) => tile.z));
    expect([...zooms].sort()).toEqual([11, 12, 13, 14]);
  });

  it("stops at the far ring rather than covering the world", () => {
    // Zoom 11 tiles are 16 km across, so the whole set fits in a handful of dozens.
    expect(wantedTiles(eye, 0, ORIGIN).length).toBeLessThan(200);
  });
});

describe("fetching the land", () => {
  const material = new MeshBasicMaterial();

  it("asks the elevation endpoint, not the pale map", async () => {
    buildTerrain(ORIGIN, material, () => undefined).follow({ east: 0, north: 0 }, 270);
    await settleTiles();

    expect(asked.length).toBeGreaterThan(0);
    for (const url of asked) expect(url).toMatch(TILE_URL);
  });

  it("draws a mesh for every tile that came back, and credits the source once", async () => {
    let credits = 0;
    const terrain = buildTerrain(ORIGIN, material, () => (credits += 1));
    terrain.follow({ east: 0, north: 0 }, 270);
    await settleTiles();

    expect(landIn(terrain.group).length).toBe(asked.length);
    expect(credits).toBe(1);
  });

  it("draws nothing, and credits nothing, where the sea answers 404", async () => {
    server.sea = true;
    let credits = 0;
    const terrain = buildTerrain(ORIGIN, material, () => (credits += 1));
    terrain.follow({ east: 0, north: 0 }, 270);
    await settleTiles();

    expect(asked.length).toBeGreaterThan(0);
    expect(landIn(terrain.group).length).toBe(0);
    expect(credits).toBe(0);
  });

  it("says nothing about a network that refused to answer at all", async () => {
    vi.stubGlobal("fetch", () => Promise.reject(new Error("offline")));
    const terrain = buildTerrain(ORIGIN, material, () => undefined);
    terrain.follow({ east: 0, north: 0 }, 270);
    await settleTiles();

    expect(landIn(terrain.group).length).toBe(0);
  });

  it("does not ask again for a ship that has barely moved", async () => {
    const terrain = buildTerrain(ORIGIN, material, () => undefined);
    terrain.follow({ east: 0, north: 0 }, 270);
    await settleTiles();
    const first = asked.length;

    terrain.follow({ east: 300, north: 0 }, 271);
    await settleTiles();
    expect(asked.length).toBe(first);
  });

  it("asks again once she has run far enough for the answer to have changed", async () => {
    const terrain = buildTerrain(ORIGIN, material, () => undefined);
    terrain.follow({ east: 0, north: 0 }, 270);
    await settleTiles();
    const first = asked.length;

    terrain.follow({ east: 9_000, north: 0 }, 270);
    await settleTiles();
    expect(asked.length).toBeGreaterThan(first);
  });

  it("asks again once she has turned far enough, without having moved", async () => {
    const terrain = buildTerrain(ORIGIN, material, () => undefined);
    terrain.follow({ east: 0, north: 0 }, 270);
    await settleTiles();
    const first = asked.length;

    terrain.follow({ east: 0, north: 0 }, 180);
    await settleTiles();
    expect(asked.length).toBeGreaterThan(first);
  });

  it("takes down the land the new view no longer wants", async () => {
    const terrain = buildTerrain(ORIGIN, material, () => undefined);
    terrain.follow({ east: 0, north: 0 }, 0);
    await settleTiles();
    const northward = new Set(landIn(terrain.group).map((mesh) => mesh.id));

    terrain.follow({ east: 0, north: 0 }, 180);
    await settleTiles();
    const southward = landIn(terrain.group).map((mesh) => mesh.id);

    expect(southward.filter((id) => northward.has(id)).length).toBeLessThan(northward.size);
  });
});

describe("the sea as a disc", () => {
  it("reaches past the widest the plan view opens to", () => {
    const water = buildWater(new MeshBasicMaterial());
    water.geometry.computeBoundingSphere();
    expect(water.geometry.boundingSphere?.radius).toBeGreaterThan(1_000_000);
  });

  it("is never culled, because it is moved away from where it was authored", () => {
    expect(buildWater(new MeshBasicMaterial()).frustumCulled).toBe(false);
  });

  it("has a centre vertex, so there is no hole under the observer's feet", () => {
    const position = buildWater(new MeshBasicMaterial()).geometry.getAttribute("position");
    expect([position.getX(0), position.getY(0), position.getZ(0)]).toEqual([0, 0, 0]);
  });
});

describe("bending the world", () => {
  interface FakeShader {
    uniforms: Record<string, unknown>;
    vertexShader: string;
  }

  function compile(): { shader: FakeShader; uniforms: ReturnType<typeof makeCurvatureUniforms> } {
    const uniforms = makeCurvatureUniforms();
    const material = new MeshBasicMaterial();
    applyCurvature(material, uniforms);
    const shader: FakeShader = {
      uniforms: {},
      vertexShader: "void main() {\n#include <begin_vertex>\n}",
    };
    material.onBeforeCompile(shader as never, null as never);
    return { shader, uniforms };
  }

  it("hands the shader the same uniform objects, so one write moves everything", () => {
    const { shader, uniforms } = compile();
    expect(shader.uniforms["uEye"]).toBe(uniforms.uEye);
    expect(shader.uniforms["uCurve"]).toBe(uniforms.uCurve);
  });

  it("displaces the vertex three replaced, rather than appending dead code", () => {
    const { shader } = compile();
    expect(shader.vertexShader).not.toContain("#include <begin_vertex>\n}");
    expect(shader.vertexShader).toContain("transformed.y -=");
  });

  it("starts flat, because the plan view is what opens first", () => {
    expect(makeCurvatureUniforms().uCurve.value).toBe(0);
  });

  it("gives the patched program a cache key of its own", () => {
    const material = new MeshBasicMaterial();
    const before = material.customProgramCacheKey();
    applyCurvature(material, makeCurvatureUniforms());
    expect(material.customProgramCacheKey()).not.toBe(before);
  });
});

describe("a scene that knows where in the world it is", () => {
  function ground(): Parameters<typeof buildScene>[2] {
    return { origin: ORIGIN, onFirstTile: () => undefined, onFirstLandTile: () => undefined };
  }

  it("keeps the land out of the plan view and the grid out of the night", () => {
    const parts = buildScene({ lightCondition: "night" }, 5000, ground());
    const land = parts.scene.getObjectByName("terrain");

    parts.setDiagramView(true);
    parts.setEye(null, 0);
    expect(land?.visible).toBe(false);

    parts.setDiagramView(false);
    parts.setEye({ east: 0, north: 0 }, 90);
    expect(land?.visible).toBe(true);
  });

  it("flattens the earth for the chart and bends it for the bridge", () => {
    const parts = buildScene(undefined, 5000, ground());
    const water = parts.scene.getObjectByName("water");

    parts.setEye({ east: 400, north: -300 }, 45);
    expect(water?.position.x).toBe(400);
    expect(water?.position.z).toBe(300);

    parts.setEye(null, 0);
    parts.setView({ centre: { east: 10, north: 20 }, extentMetres: 5000, aspect: 2 });
    expect(water?.position.x).toBe(10);
    expect(water?.position.z).toBe(-20);
  });

  it("draws no land at all for a scene that was never told where it is", () => {
    const parts = buildScene(undefined, 5000);
    parts.setEye({ east: 0, north: 0 }, 0);
    expect(parts.scene.getObjectByName("terrain")).toBeUndefined();
  });

  it("names the elevation tiles rather than the map they are not", () => {
    expect(TERRAIN_CREDIT).toContain("Geospatial Information Authority of Japan");
    expect(TERRAIN_CREDIT).toContain("elevation");
  });
});
