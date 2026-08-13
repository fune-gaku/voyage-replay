/**
 * Where the sun and the moon were, from a time and a place.
 *
 * This is arithmetic, not data: given the instant and the position a scenario already
 * carries, the sky is not a thing anybody has to write down. That matters here because
 * light condition is currently a hand-entered field - `"night"` - and a hand-entered field
 * cannot be checked, cannot say how far below the horizon the sun was, and cannot say that
 * there was a half moon forty degrees up at the moment of contact.
 *
 * ## What it is accurate to, and why that is enough
 *
 * Low-precision series: the sun to about 0.01 degrees, the moon to about 0.3. The moon's
 * figure sounds poor and is not, for what is asked of it here - it is a few minutes of
 * moonrise and a fraction of a degree of altitude, against a question ("was there useful
 * moonlight, and from where") whose answer changes with cloud nobody recorded.
 *
 * Checked against physics rather than against itself: the sun's greatest altitude on the
 * solstices is 90 degrees minus the distance from the observer's latitude to the tropic,
 * and at an equinox it rises due east everywhere. See test/celestial.spec.ts.
 *
 * ## Two things that are easy to get wrong
 *
 * - **Altitude here is geometric**, before atmospheric refraction. That is deliberate: the
 *   thresholds it gets compared against already carry it. Sunset is defined as the sun's
 *   centre at -0.833 degrees, which IS refraction (34') plus the sun's semidiameter (16'),
 *   so refracting the altitude as well counts it twice and moves sunset by about three
 *   minutes - and three minutes is an argument, under a rule written as "sunset to sunrise".
 * - **The moon is close enough to need parallax.** An observer on the surface sees it up to
 *   about a degree lower than an observer at the centre of the earth would. Left out, the
 *   moon rises minutes early and sits wrongly high just when it is nearest the horizon and
 *   the error matters most.
 */

import type { LatLon } from "./types.js";

/** Where a body is in the sky, for an observer on the ground. */
export interface Horizontal {
  /** Degrees above the horizon, negative below. Geometric: see the note on refraction. */
  altitudeDegrees: number;
  /** True bearing of the body, degrees clockwise from north. */
  azimuthDegrees: number;
}

export interface MoonState extends Horizontal {
  /** Of the disc, 0 at new and 1 at full. */
  illuminatedFraction: number;
}

/** Right ascension and declination, in radians. */
interface Equatorial {
  rightAscension: number;
  declination: number;
}

/** Ecliptic longitude and latitude in radians, distance in kilometres. */
interface Ecliptic {
  longitude: number;
  latitude: number;
  distanceKm: number;
}

/** Mean radius of the earth, for the moon's parallax. */
const EARTH_RADIUS_KM = 6378.14;

export function sunPosition(epochSeconds: number, at: LatLon): Horizontal {
  const days = daysSinceJ2000(epochSeconds);
  return toHorizontal(sunEquatorial(days), days, at);
}

export function moonPosition(epochSeconds: number, at: LatLon): MoonState {
  const days = daysSinceJ2000(epochSeconds);
  const ecliptic = moonEcliptic(days);
  const moon = equatorialOf(ecliptic, days);
  const seen = toHorizontal(moon, days, at);

  // The observer is on the surface, not at the centre of the earth, which puts the moon
  // lower - by nearly a degree overhead, and by nothing at all on the horizon.
  const parallax = toDegrees(Math.asin(EARTH_RADIUS_KM / ecliptic.distanceKm));
  return {
    altitudeDegrees: seen.altitudeDegrees - parallax * Math.cos(toRadians(seen.altitudeDegrees)),
    azimuthDegrees: seen.azimuthDegrees,
    illuminatedFraction: illuminatedFraction(sunEquatorial(days), moon),
  };
}

function daysSinceJ2000(epochSeconds: number): number {
  // J2000.0 is 2000-01-01T12:00:00Z, which is this many seconds after the Unix epoch.
  // Counting from it directly is what saves this file a Julian date conversion.
  return (epochSeconds - 946_728_000) / 86_400;
}

function sunEquatorial(days: number): Equatorial {
  const meanLongitude = 280.46 + 0.9856474 * days;
  const meanAnomaly = toRadians(357.528 + 0.9856003 * days);
  // The equation of the centre, to two terms: the earth's orbit is an ellipse, so the sun
  // runs ahead of its mean position for half the year and behind it for the other half.
  const longitude =
    meanLongitude + 1.915 * Math.sin(meanAnomaly) + 0.02 * Math.sin(2 * meanAnomaly);
  return equatorialOf({ longitude: toRadians(longitude), latitude: 0, distanceKm: 0 }, days);
}

/**
 * The moon's place on the ecliptic, to the three terms that matter most.
 *
 * The full theory has hundreds. These three - the equation of the centre, the swing above
 * and below the ecliptic, and the varying distance - carry it to about a third of a degree,
 * which is a couple of minutes of moonrise.
 */
function moonEcliptic(days: number): Ecliptic {
  const meanLongitude = 218.316 + 13.176396 * days;
  const meanAnomaly = toRadians(134.963 + 13.064993 * days);
  const argumentOfLatitude = toRadians(93.272 + 13.2293 * days);
  return {
    longitude: toRadians(meanLongitude + 6.289 * Math.sin(meanAnomaly)),
    latitude: toRadians(5.128 * Math.sin(argumentOfLatitude)),
    distanceKm: 385001 - 20905 * Math.cos(meanAnomaly),
  };
}

function equatorialOf(place: Ecliptic, days: number): Equatorial {
  const obliquity = toRadians(23.439 - 0.0000004 * days);
  const { longitude, latitude } = place;
  return {
    rightAscension: Math.atan2(
      Math.sin(longitude) * Math.cos(obliquity) - Math.tan(latitude) * Math.sin(obliquity),
      Math.cos(longitude),
    ),
    declination: Math.asin(
      Math.sin(latitude) * Math.cos(obliquity) +
        Math.cos(latitude) * Math.sin(obliquity) * Math.sin(longitude),
    ),
  };
}

function toHorizontal(body: Equatorial, days: number, at: LatLon): Horizontal {
  // Greenwich mean sidereal time: where the sky has turned to, over Greenwich. Adding the
  // observer's longitude turns it into local sidereal time, and the difference between
  // that and the body's right ascension is how far past the meridian the body is.
  const sidereal = 280.46061837 + 360.98564736629 * days;
  const hourAngle = toRadians(normalise(sidereal + at.lon)) - body.rightAscension;
  const latitude = toRadians(at.lat);

  const altitude = Math.asin(
    Math.sin(latitude) * Math.sin(body.declination) +
      Math.cos(latitude) * Math.cos(body.declination) * Math.cos(hourAngle),
  );
  const azimuth = Math.atan2(
    Math.sin(hourAngle),
    Math.cos(hourAngle) * Math.sin(latitude) - Math.tan(body.declination) * Math.cos(latitude),
  );
  // That azimuth is measured from south; a bearing is measured from north.
  return {
    altitudeDegrees: toDegrees(altitude),
    azimuthDegrees: normalise(toDegrees(azimuth) + 180),
  };
}

/**
 * How much of the disc is lit, from how far the moon has got from the sun in the sky.
 *
 * Not a proxy for how much light it sheds. A full moon is roughly ten times as bright as a
 * half moon rather than twice, because at opposition the shadows on it disappear - so a
 * consumer that scales light by this figure will be wrong by most of an order of magnitude.
 */
function illuminatedFraction(sun: Equatorial, moon: Equatorial): number {
  const elongation = Math.acos(
    Math.sin(sun.declination) * Math.sin(moon.declination) +
      Math.cos(sun.declination) *
        Math.cos(moon.declination) *
        Math.cos(sun.rightAscension - moon.rightAscension),
  );
  return (1 - Math.cos(elongation)) / 2;
}

function normalise(degrees: number): number {
  return ((degrees % 360) + 360) % 360;
}

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

function toDegrees(radians: number): number {
  return (radians * 180) / Math.PI;
}
