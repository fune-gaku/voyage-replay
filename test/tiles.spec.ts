import { describe, expect, it } from "vitest";

import {
  boxOfTile,
  chooseZoom,
  groundResolutionMetres,
  latitudeOfTileY,
  longitudeOfTileX,
  tileCount,
  tileXOf,
  tileYOf,
  tilesCovering,
  type LatLonBox,
} from "../src/render/tiles.js";

/** Suo-nada, roughly the reference case's patch of sea. */
const SUO_NADA: LatLonBox = { south: 33.795, west: 131.402, north: 33.999, east: 132.065 };

describe("ground resolution", () => {
  // The figure every slippy-map implementation is checked against: the equator, divided
  // into 256 pixels.
  it("is the equator over 256 pixels at zoom 0", () => {
    expect(groundResolutionMetres(0, 0)).toBeCloseTo(156543.034, 2);
  });

  it("halves with every zoom level", () => {
    expect(groundResolutionMetres(0, 5)).toBeCloseTo(groundResolutionMetres(0, 4) / 2, 6);
  });

  // Mercator stretches towards the poles, so a pixel there covers less ground. This is
  // what makes a tile's resolution a question about latitude rather than about zoom alone.
  it("shrinks away from the equator", () => {
    expect(groundResolutionMetres(60, 10)).toBeLessThan(groundResolutionMetres(0, 10));
  });
});

describe("tile numbering", () => {
  it("puts a known place in a known tile", () => {
    // Tokyo Station, in the tile every XYZ scheme agrees on.
    expect(Math.floor(tileXOf(139.767125, 14))).toBe(14552);
    expect(Math.floor(tileYOf(35.681236, 14))).toBe(6451);
  });

  it("comes back to where it started", () => {
    expect(longitudeOfTileX(tileXOf(131.7116667, 13), 13)).toBeCloseTo(131.7116667, 9);
    expect(latitudeOfTileY(tileYOf(33.905, 13), 13)).toBeCloseTo(33.905, 9);
  });

  /**
   * The half of the numbering that is easy to get backwards, and it looks plausible either
   * way round until a box is tall enough for the map to read upside down.
   */
  it("counts rows from the north", () => {
    expect(tileYOf(60, 8)).toBeLessThan(tileYOf(-60, 8));
    expect(boxOfTile({ z: 8, x: 0, y: 10 }).north).toBeGreaterThan(
      boxOfTile({ z: 8, x: 0, y: 11 }).north,
    );
  });

  /**
   * The other half. Rows are evenly spaced in the projection, not in latitude - so the
   * boundary a quarter of the way down the world is at 66.5 degrees, not at the 42.5 that
   * interpolating between the pole and the equator would give.
   */
  it("spaces rows by the projection rather than by latitude", () => {
    expect(latitudeOfTileY(0.5, 1)).toBeCloseTo(66.5133, 3);
  });

  it("covers the whole world with tile zero", () => {
    const world = boxOfTile({ z: 0, x: 0, y: 0 });
    expect(world.west).toBeCloseTo(-180, 9);
    expect(world.east).toBeCloseTo(180, 9);
    // Where Mercator is cut off to make the world square.
    expect(world.north).toBeCloseTo(85.0511, 3);
    expect(world.south).toBeCloseTo(-85.0511, 3);
  });

  // The poles are at infinity in this projection. Clamping is what keeps that from
  // arriving as a NaN tile index several functions later.
  it("survives a latitude past the projection's limit", () => {
    expect(Number.isFinite(tileYOf(90, 6))).toBe(true);
    expect(Number.isFinite(tileYOf(-90, 6))).toBe(true);
  });
});

describe("covering a box", () => {
  it("lists exactly as many tiles as it counts", () => {
    expect(tilesCovering(SUO_NADA, 12)).toHaveLength(tileCount(SUO_NADA, 12));
  });

  it("gives every tile the zoom it was asked for", () => {
    expect(tilesCovering(SUO_NADA, 11).every((tile) => tile.z === 11)).toBe(true);
  });

  /**
   * An edge landing exactly on a tile boundary must not pull in the tile beyond it. At
   * zoom 1 the world is four tiles and the prime meridian is a boundary, so the western
   * hemisphere is one column - two would mean every box in the project fetching a strip of
   * tiles it never shows.
   */
  it("stops at a boundary rather than reaching past it", () => {
    const westernHemisphere: LatLonBox = { south: 0, west: -180, north: 85, east: 0 };
    const tiles = tilesCovering(westernHemisphere, 1);
    expect(tiles).toHaveLength(1);
    expect(tiles[0]).toEqual({ z: 1, x: 0, y: 0 });
  });

  // The arithmetic that stops at a boundary would otherwise finish one short of where it
  // started here, and cover nothing at all.
  it("still returns a tile for a box narrower than one", () => {
    const pinprick: LatLonBox = { south: 33.9, west: 131.71, north: 33.9001, east: 131.7101 };
    expect(tilesCovering(pinprick, 13)).toHaveLength(1);
  });
});

describe("choosing a zoom", () => {
  /**
   * The scale of a scenario is not knowable in advance - open water spans tens of
   * kilometres and a berthing spans hundreds of metres - so the rule is a tile budget
   * rather than a fixed zoom, and it has to move in the right direction for both.
   */
  it("goes closer in for a smaller box", () => {
    const berth: LatLonBox = { south: 33.9, west: 131.71, north: 33.905, east: 131.716 };
    expect(chooseZoom(berth, 128, [5, 16])).toBeGreaterThan(chooseZoom(SUO_NADA, 128, [5, 16]));
  });

  it("keeps within the budget it was given", () => {
    const zoom = chooseZoom(SUO_NADA, 128, [5, 16]);
    expect(tileCount(SUO_NADA, zoom)).toBeLessThanOrEqual(128);
  });

  it("takes the sharpest zoom allowed when everything fits", () => {
    const berth: LatLonBox = { south: 33.9, west: 131.71, north: 33.9005, east: 131.7106 };
    expect(chooseZoom(berth, 128, [5, 14])).toBe(14);
  });

  /**
   * A box big enough to blow the budget at every level still deserves whatever map can be
   * drawn over it. Returning nothing would leave a scene that spans an ocean with no map
   * at all, which is the case that most needs one.
   */
  it("falls back to the coarsest zoom rather than refusing", () => {
    const ocean: LatLonBox = { south: -60, west: -170, north: 60, east: 170 };
    expect(chooseZoom(ocean, 4, [5, 16])).toBe(5);
  });
});
