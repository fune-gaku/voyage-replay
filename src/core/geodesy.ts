/**
 * Positions on a local tangent plane.
 *
 * A reconstruction spans a few kilometres at most, so we project once onto a flat plane
 * centred on the scenario origin and do every subsequent calculation in metres. Over 10 km
 * the error from ignoring the curvature of the earth is centimetres - orders of magnitude
 * below the precision of the source data, which is typically 0.1 arc-seconds (~3 m).
 */

import type { LatLon } from "./types.js";

export const METRES_PER_NAUTICAL_MILE = 1852;
export const METRES_PER_DEGREE_LATITUDE = METRES_PER_NAUTICAL_MILE * 60;
export const KNOTS_TO_METRES_PER_SECOND = METRES_PER_NAUTICAL_MILE / 3600;

/** East / north offsets in metres from the scenario origin. */
export interface LocalPosition {
  east: number;
  north: number;
}

/**
 * Parse the degrees-minutes-seconds form that accident reports print, e.g. "33-53-12.4"
 * for latitude or "131-57-15.0" for longitude. Also accepts degrees and decimal minutes
 * ("33-53.207") and a bare decimal degree value.
 *
 * Full-width digits and the full-width hyphen are accepted, because the PDFs these come
 * from are typeset in Japanese and mix them freely with ASCII.
 */
export function parseDegreesMinutesSeconds(input: string): number {
  const normalised = input
    .trim()
    .replace(/[０-９]/g, (d) => String(d.charCodeAt(0) - 0xff10))
    .replace(/[－‐-―−ー]/g, "-")
    .replace(/[°'"′″]/g, "-")
    .replace(/-+$/, "");

  const parts = normalised.split("-").filter((p) => p.length > 0);
  if (parts.length === 0 || parts.length > 3) {
    throw new Error(`not a coordinate: ${JSON.stringify(input)}`);
  }

  let value = 0;
  let scale = 1;
  for (const part of parts) {
    const n = Number(part);
    if (!Number.isFinite(n) || n < 0) {
      throw new Error(`not a coordinate: ${JSON.stringify(input)}`);
    }
    value += n / scale;
    scale *= 60;
  }
  return value;
}

export function toLocalPosition(point: LatLon, origin: LatLon): LocalPosition {
  const metresPerDegreeLongitude = METRES_PER_DEGREE_LATITUDE * Math.cos(toRadians(origin.lat));
  return {
    east: (point.lon - origin.lon) * metresPerDegreeLongitude,
    north: (point.lat - origin.lat) * METRES_PER_DEGREE_LATITUDE,
  };
}

export function toLatLon(position: LocalPosition, origin: LatLon): LatLon {
  const metresPerDegreeLongitude = METRES_PER_DEGREE_LATITUDE * Math.cos(toRadians(origin.lat));
  return {
    lat: origin.lat + position.north / METRES_PER_DEGREE_LATITUDE,
    lon: origin.lon + position.east / metresPerDegreeLongitude,
  };
}

export function distanceMetres(a: LocalPosition, b: LocalPosition): number {
  return Math.hypot(b.east - a.east, b.north - a.north);
}

/** True bearing from `a` to `b`, degrees clockwise from north. */
export function bearingDegrees(a: LocalPosition, b: LocalPosition): number {
  return normaliseDegrees(toDegrees(Math.atan2(b.east - a.east, b.north - a.north)));
}

/**
 * Bearing of `target` as seen from a ship at `observer` whose bow points along
 * `headingDegreesTrue`, measured clockwise from the bow. 0 is right ahead, 90 is
 * abeam to starboard, 180 is right astern.
 */
export function relativeBearingDegrees(
  observer: LocalPosition,
  target: LocalPosition,
  headingDegreesTrue: number,
): number {
  return normaliseDegrees(bearingDegrees(observer, target) - headingDegreesTrue);
}

export function normaliseDegrees(degrees: number): number {
  return ((degrees % 360) + 360) % 360;
}

/**
 * Interpolate between two bearings the short way round, so 350 to 010 passes through
 * 000 rather than sweeping 340 degrees backwards.
 */
export function interpolateDegrees(from: number, to: number, fraction: number): number {
  const delta = ((normaliseDegrees(to) - normaliseDegrees(from) + 540) % 360) - 180;
  return normaliseDegrees(from + delta * fraction);
}

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

function toDegrees(radians: number): number {
  return (radians * 180) / Math.PI;
}
