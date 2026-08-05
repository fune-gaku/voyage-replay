/**
 * Physical screening of a track.
 *
 * A reconstruction is only as good as the numbers that went into it, and the numbers are
 * transcribed - by hand, or by a parser, out of a PDF. The cheapest way to catch a
 * transcription error is to ask whether a ship could have done what the data says: a
 * position that implies 40 knots, or a heading that swings 90 degrees in ten seconds, is
 * a typo rather than a manoeuvre.
 *
 * These are screens, not hydrodynamics. They are deliberately generous, because a false
 * alarm costs a glance and a miss costs a wrong video. The one thing they legitimately
 * flag is the moment of impact itself - a hull being struck really does violate them -
 * so a cluster of findings inside a few seconds is a signal, not noise.
 */

import { distanceMetres, normaliseDegrees } from "./geodesy.js";
import type { PreparedPoint, PreparedTrack } from "./track.js";
import { knotsToMetresPerSecond } from "./track.js";
import type { Vessel } from "./types.js";

export type FindingKind = "speed-mismatch" | "implausible-speed" | "implausible-turn-rate";

export interface Finding {
  kind: FindingKind;
  actorId: string;
  fromEpochSeconds: number;
  toEpochSeconds: number;
  message: string;
}

export interface PlausibilityOptions {
  /** How far the speed implied by two positions may differ from the reported one. */
  speedToleranceKnots?: number;
  /**
   * How coarsely positions are quantised, in metres.
   *
   * This matters more than it looks. Reports print latitude and longitude to the second
   * of arc, and one second of longitude is about 26 m in mid-latitudes - so between two
   * samples 20 s apart, rounding alone moves the implied speed by well over a knot. A flat
   * tolerance therefore fires on every short interval in an otherwise clean track. The
   * allowance is widened by `quantisation / interval`, which vanishes over a long interval
   * and dominates over a short one, exactly as the error does.
   */
  positionQuantisationMetres?: number;
  /** Above this, no merchant ship is plausibly making the speed reported. */
  maximumSpeedKnots?: number;
  /**
   * Tightest turn to allow, as a multiple of the vessel's length. A merchant ship at
   * full rudder turns in roughly 2.5 to 5 lengths, so 2.5 is already the hard end;
   * `turnMargin` widens it further so only clear nonsense trips the check.
   */
  tacticalRadiusInShipLengths?: number;
  turnMargin?: number;
}

const DEFAULTS = {
  speedToleranceKnots: 1.0,
  positionQuantisationMetres: 30,
  maximumSpeedKnots: 40,
  tacticalRadiusInShipLengths: 2.5,
  turnMargin: 1.5,
} satisfies Required<PlausibilityOptions>;

type Config = Required<PlausibilityOptions>;

/**
 * One pair of consecutive samples, with everything a screen needs in order to judge it.
 *
 * Passing it as a unit is what keeps each screen down to the single question it asks.
 * Threading five parameters through five functions instead makes every signature longer
 * than the check inside it, and the reader has to match them up at each call.
 */
interface Interval {
  actorId: string;
  a: PreparedPoint;
  b: PreparedPoint;
  seconds: number;
  config: Config;
  vessel: Vessel | undefined;
}

export function checkPlausibility(
  track: PreparedTrack,
  vessel?: Vessel,
  options: PlausibilityOptions = {},
): Finding[] {
  const config = { ...DEFAULTS, ...options };
  const findings: Finding[] = [];
  const points = track.points;

  for (let i = 0; i < points.length - 1; i += 1) {
    const a = points[i];
    const b = points[i + 1];
    if (!a || !b) continue;
    // Two samples sharing a timestamp carry no interval to screen over, and dividing by
    // it would report an infinite speed as a finding.
    const seconds = b.epochSeconds - a.epochSeconds;
    if (seconds <= 0) continue;
    findings.push(...screen({ actorId: track.actorId, a, b, seconds, config, vessel }));
  }

  return findings;
}

/** Every screen that applies to one interval. */
function screen(interval: Interval): Finding[] {
  return [
    tooFastForAnyShip(interval),
    disagreesWithReportedSpeed(interval),
    turnsTighterThanSheCould(interval),
  ].filter((f) => f !== null);
}

/** What the two positions say she did, whatever she reported. */
function impliedSpeedKnots({ a, b, seconds }: Interval): number {
  return distanceMetres(a.position, b.position) / seconds / knotsToMetresPerSecond(1);
}

function tooFastForAnyShip(interval: Interval): Finding | null {
  const impliedKnots = impliedSpeedKnots(interval);
  if (impliedKnots <= interval.config.maximumSpeedKnots) return null;
  return finding(
    interval,
    "implausible-speed",
    `positions imply ${impliedKnots.toFixed(1)} kn over ${interval.seconds} s`,
  );
}

/**
 * Position and speed come from different fields of the same message, so they are two
 * independent statements about one motion. Where they disagree, one of them was
 * mistranscribed - which is the error this whole pass exists to catch.
 */
function disagreesWithReportedSpeed(interval: Interval): Finding | null {
  const { a, b } = interval;
  if (a.sogKnots === undefined || b.sogKnots === undefined) return null;

  const impliedKnots = impliedSpeedKnots(interval);
  const reported = (a.sogKnots + b.sogKnots) / 2;
  const error = impliedKnots - reported;
  const tolerance = speedTolerance(interval);
  if (Math.abs(error) <= tolerance) return null;

  return finding(
    interval,
    "speed-mismatch",
    `positions imply ${impliedKnots.toFixed(1)} kn but ` +
      `${reported.toFixed(1)} kn was reported ` +
      `(${error >= 0 ? "+" : ""}${error.toFixed(1)}, tolerance ${tolerance.toFixed(1)})`,
  );
}

/** See `positionQuantisationMetres`: the allowance has to shrink as the interval grows. */
function speedTolerance({ seconds, config }: Interval): number {
  return (
    config.speedToleranceKnots +
    config.positionQuantisationMetres / seconds / knotsToMetresPerSecond(1)
  );
}

/**
 * A hull cannot pivot. Below her tactical diameter the turn is not a manoeuvre at all, so
 * a heading swinging faster than that is a misread column - or, legitimately, the moment
 * she was struck.
 */
function turnsTighterThanSheCould(interval: Interval): Finding | null {
  const { a, b, seconds, config, vessel } = interval;
  const turn = shortestTurn(a.headingDegreesTrue, b.headingDegreesTrue);
  const speedKnots = a.sogKnots ?? b.sogKnots;
  if (turn === undefined || !vessel || speedKnots === undefined || speedKnots <= 0) return null;

  const radiusMetres = config.tacticalRadiusInShipLengths * vessel.loaMetres;
  const maxDegreesPerSecond = ((knotsToMetresPerSecond(speedKnots) / radiusMetres) * 180) / Math.PI;
  const observed = Math.abs(turn) / seconds;
  if (observed <= maxDegreesPerSecond * config.turnMargin) return null;

  return finding(
    interval,
    "implausible-turn-rate",
    `heading changes ${observed.toFixed(2)} deg/s; a ${vessel.loaMetres} m hull at ` +
      `${speedKnots.toFixed(1)} kn tops out near ${maxDegreesPerSecond.toFixed(2)} deg/s`,
  );
}

function finding({ actorId, a, b }: Interval, kind: FindingKind, message: string): Finding {
  return {
    kind,
    actorId,
    fromEpochSeconds: a.epochSeconds,
    toEpochSeconds: b.epochSeconds,
    message,
  };
}

function shortestTurn(from: number | undefined, to: number | undefined): number | undefined {
  if (from === undefined || to === undefined) return undefined;
  return ((normaliseDegrees(to) - normaliseDegrees(from) + 540) % 360) - 180;
}
