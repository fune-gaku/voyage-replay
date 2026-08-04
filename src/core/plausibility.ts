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
import type { PreparedTrack } from "./track.js";
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

    const seconds = b.epochSeconds - a.epochSeconds;
    if (seconds <= 0) continue;

    const impliedKnots =
      distanceMetres(a.position, b.position) / seconds / knotsToMetresPerSecond(1);

    if (impliedKnots > config.maximumSpeedKnots) {
      findings.push({
        kind: "implausible-speed",
        actorId: track.actorId,
        fromEpochSeconds: a.epochSeconds,
        toEpochSeconds: b.epochSeconds,
        message: `positions imply ${impliedKnots.toFixed(1)} kn over ${seconds} s`,
      });
    }

    if (a.sogKnots !== undefined && b.sogKnots !== undefined) {
      const reported = (a.sogKnots + b.sogKnots) / 2;
      const error = impliedKnots - reported;
      const tolerance =
        config.speedToleranceKnots +
        config.positionQuantisationMetres / seconds / knotsToMetresPerSecond(1);
      if (Math.abs(error) > tolerance) {
        findings.push({
          kind: "speed-mismatch",
          actorId: track.actorId,
          fromEpochSeconds: a.epochSeconds,
          toEpochSeconds: b.epochSeconds,
          message:
            `positions imply ${impliedKnots.toFixed(1)} kn but ` +
            `${reported.toFixed(1)} kn was reported ` +
            `(${error >= 0 ? "+" : ""}${error.toFixed(1)}, tolerance ${tolerance.toFixed(1)})`,
        });
      }
    }

    const turn = shortestTurn(a.headingDegreesTrue, b.headingDegreesTrue);
    if (turn !== undefined && vessel) {
      const speedKnots = a.sogKnots ?? b.sogKnots;
      if (speedKnots !== undefined && speedKnots > 0) {
        const radiusMetres = config.tacticalRadiusInShipLengths * vessel.loaMetres;
        const maxDegreesPerSecond =
          ((knotsToMetresPerSecond(speedKnots) / radiusMetres) * 180) / Math.PI;
        const observed = Math.abs(turn) / seconds;
        if (observed > maxDegreesPerSecond * config.turnMargin) {
          findings.push({
            kind: "implausible-turn-rate",
            actorId: track.actorId,
            fromEpochSeconds: a.epochSeconds,
            toEpochSeconds: b.epochSeconds,
            message:
              `heading changes ${observed.toFixed(2)} deg/s; a ${vessel.loaMetres} m hull at ` +
              `${speedKnots.toFixed(1)} kn tops out near ${maxDegreesPerSecond.toFixed(2)} deg/s`,
          });
        }
      }
    }
  }

  return findings;
}

function shortestTurn(from: number | undefined, to: number | undefined): number | undefined {
  if (from === undefined || to === undefined) return undefined;
  return ((normaliseDegrees(to) - normaliseDegrees(from) + 540) % 360) - 180;
}
