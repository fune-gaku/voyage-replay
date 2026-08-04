import { describe, expect, it } from "vitest";

import {
  bearingDegrees,
  distanceMetres,
  interpolateDegrees,
  METRES_PER_NAUTICAL_MILE,
  normaliseDegrees,
  parseDegreesMinutesSeconds,
  relativeBearingDegrees,
  toLatLon,
  toLocalPosition,
} from "../src/core/geodesy.js";

describe("parseDegreesMinutesSeconds", () => {
  it("reads the degrees-minutes-seconds form that reports print", () => {
    expect(parseDegreesMinutesSeconds("33-53-12.4")).toBeCloseTo(33 + 53 / 60 + 12.4 / 3600, 9);
    expect(parseDegreesMinutesSeconds("131-57-15.0")).toBeCloseTo(131 + 57 / 60 + 15 / 3600, 9);
  });

  it("reads degrees and decimal minutes", () => {
    expect(parseDegreesMinutesSeconds("33-54.3")).toBeCloseTo(33.905, 9);
  });

  it("reads a bare decimal degree", () => {
    expect(parseDegreesMinutesSeconds("33.905")).toBeCloseTo(33.905, 9);
  });

  // The PDFs these come from are typeset in Japanese and mix full-width digits and
  // hyphens with ASCII in the same table. Half-width-only parsing silently reads zero rows.
  it("reads full-width digits and hyphens", () => {
    expect(parseDegreesMinutesSeconds("３３－５３－１２.４")).toBeCloseTo(
      33 + 53 / 60 + 12.4 / 3600,
      9,
    );
  });

  it("rejects what is not a coordinate", () => {
    expect(() => parseDegreesMinutesSeconds("north a bit")).toThrow();
    expect(() => parseDegreesMinutesSeconds("1-2-3-4")).toThrow();
  });
});

describe("local plane", () => {
  const origin = { lat: 33.905, lon: 131.7116667 };

  it("puts one minute of latitude at one nautical mile north", () => {
    const p = toLocalPosition({ lat: origin.lat + 1 / 60, lon: origin.lon }, origin);
    expect(p.north).toBeCloseTo(METRES_PER_NAUTICAL_MILE, 6);
    expect(p.east).toBeCloseTo(0, 9);
  });

  it("round-trips through lat/lon", () => {
    const point = { lat: 33.91, lon: 131.72 };
    const back = toLatLon(toLocalPosition(point, origin), origin);
    expect(back.lat).toBeCloseTo(point.lat, 9);
    expect(back.lon).toBeCloseTo(point.lon, 9);
  });

  it("measures bearing clockwise from north", () => {
    const here = { east: 0, north: 0 };
    expect(bearingDegrees(here, { east: 0, north: 100 })).toBeCloseTo(0, 9);
    expect(bearingDegrees(here, { east: 100, north: 0 })).toBeCloseTo(90, 9);
    expect(bearingDegrees(here, { east: 0, north: -100 })).toBeCloseTo(180, 9);
    expect(bearingDegrees(here, { east: -100, north: 0 })).toBeCloseTo(270, 9);
  });

  it("measures relative bearing from the bow", () => {
    const observer = { east: 0, north: 0 };
    const dueEast = { east: 100, north: 0 };
    // Heading north, something due east is abeam to starboard.
    expect(relativeBearingDegrees(observer, dueEast, 0)).toBeCloseTo(90, 9);
    // Heading east, the same thing is right ahead.
    expect(relativeBearingDegrees(observer, dueEast, 90)).toBeCloseTo(0, 9);
    // Heading west, it is right astern.
    expect(relativeBearingDegrees(observer, dueEast, 270)).toBeCloseTo(180, 9);
  });

  it("measures distance", () => {
    expect(distanceMetres({ east: 0, north: 0 }, { east: 300, north: 400 })).toBeCloseTo(500, 9);
  });
});

describe("angles", () => {
  it("normalises into [0, 360)", () => {
    expect(normaliseDegrees(-10)).toBeCloseTo(350, 9);
    expect(normaliseDegrees(370)).toBeCloseTo(10, 9);
    expect(normaliseDegrees(360)).toBeCloseTo(0, 9);
  });

  it("interpolates the short way round the compass", () => {
    expect(interpolateDegrees(350, 10, 0.5)).toBeCloseTo(0, 9);
    expect(interpolateDegrees(10, 350, 0.5)).toBeCloseTo(0, 9);
    expect(interpolateDegrees(90, 180, 1 / 3)).toBeCloseTo(120, 9);
  });
});
