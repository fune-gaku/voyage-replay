import {
  distanceMetres,
  interpolateDegrees,
  KNOTS_TO_METRES_PER_SECOND,
  toLocalPosition,
  type LocalPosition,
} from "./geodesy.js";
import type { Actor, Derivation, LatLon, Track } from "./types.js";

export interface PreparedPoint {
  epochSeconds: number;
  position: LocalPosition;
  headingDegreesTrue: number | undefined;
  cogDegreesTrue: number | undefined;
  sogKnots: number | undefined;
  derivation: Derivation;
}

export interface PreparedTrack {
  actorId: string;
  points: PreparedPoint[];
  startSeconds: number;
  endSeconds: number;
}

export interface SampledState {
  epochSeconds: number;
  position: LocalPosition;
  headingDegreesTrue: number | undefined;
  cogDegreesTrue: number | undefined;
  sogKnots: number | undefined;
  derivation: Derivation;
}

/** Project a track onto the scenario's local plane and put its clock on one axis. */
export function prepareTrack(actorId: string, track: Track, origin: LatLon): PreparedTrack {
  const points = track.points
    .map((p) => preparedPoint(actorId, p, track.derivation, origin))
    .sort((a, b) => a.epochSeconds - b.epochSeconds);

  const first = points[0];
  const last = points[points.length - 1];
  if (!first || !last) throw new Error(`${actorId}: track has no points`);

  return { actorId, points, startSeconds: first.epochSeconds, endSeconds: last.epochSeconds };
}

/**
 * One source point on the local plane. A point may state its own derivation - part of a
 * track can be measured and part reconstructed - and falls back to the track's otherwise.
 */
function preparedPoint(
  actorId: string,
  point: Track["points"][number],
  trackDerivation: Derivation,
  origin: LatLon,
): PreparedPoint {
  const epochSeconds = Date.parse(point.t) / 1000;
  if (!Number.isFinite(epochSeconds)) {
    throw new Error(`${actorId}: unparseable timestamp ${JSON.stringify(point.t)}`);
  }
  return {
    epochSeconds,
    position: toLocalPosition({ lat: point.lat, lon: point.lon }, origin),
    headingDegreesTrue: point.headingDegreesTrue,
    cogDegreesTrue: point.cogDegreesTrue,
    sogKnots: point.sogKnots,
    derivation: point.derivation ?? trackDerivation,
  };
}

export function prepareActor(actor: Actor, origin: LatLon): PreparedTrack {
  return prepareTrack(actor.id, actor.track, origin);
}

/**
 * State at an instant, or null outside the track's own span - we do not extrapolate,
 * because a track that runs out is a fact about the source, not something to paper over.
 *
 * PLACEHOLDER: positions are interpolated straight between samples. A ship does not move
 * that way - she carries her turn, and her bow points off her track by the drift angle -
 * so a straight line between two samples a minute apart reads as a hull sliding sideways
 * to anyone who has handled a ship. Replacing this with a first-order (Nomoto) response
 * fitted to the vessel's length is the next piece of work; see plans/ and docs/domain-notes.md.
 * Everything synthesised here is reported as derivation "interpolated" so the renderer can
 * draw it differently from what was measured.
 */
export function sampleAt(track: PreparedTrack, epochSeconds: number): SampledState | null {
  if (epochSeconds < track.startSeconds || epochSeconds > track.endSeconds) return null;

  const points = track.points;
  for (let i = 0; i < points.length - 1; i += 1) {
    const a = points[i];
    const b = points[i + 1];
    if (!a || !b) continue;
    if (epochSeconds < a.epochSeconds || epochSeconds > b.epochSeconds) continue;
    return blendPoints(a, b, epochSeconds);
  }
  return null;
}

/**
 * The straight-line blend itself. Landing exactly on a sample keeps that sample's own
 * derivation; anything between them is this tool's own construction and says so.
 */
function blendPoints(a: PreparedPoint, b: PreparedPoint, epochSeconds: number): SampledState {
  const span = b.epochSeconds - a.epochSeconds;
  const fraction = span === 0 ? 0 : (epochSeconds - a.epochSeconds) / span;
  const exact = fraction === 0 ? a : fraction === 1 ? b : undefined;

  return {
    epochSeconds,
    position: {
      east: a.position.east + (b.position.east - a.position.east) * fraction,
      north: a.position.north + (b.position.north - a.position.north) * fraction,
    },
    headingDegreesTrue: blendDegrees(a.headingDegreesTrue, b.headingDegreesTrue, fraction),
    cogDegreesTrue: blendDegrees(a.cogDegreesTrue, b.cogDegreesTrue, fraction),
    sogKnots: blendNumbers(a.sogKnots, b.sogKnots, fraction),
    derivation: exact ? exact.derivation : "interpolated",
  };
}

export interface RangeSample {
  epochSeconds: number;
  metres: number;
}

/** Distance between two actors over the window in which both tracks exist. */
export function rangeSeries(a: PreparedTrack, b: PreparedTrack, stepSeconds = 1): RangeSample[] {
  const from = Math.ceil(Math.max(a.startSeconds, b.startSeconds));
  const to = Math.floor(Math.min(a.endSeconds, b.endSeconds));
  const samples: RangeSample[] = [];
  for (let t = from; t <= to; t += stepSeconds) {
    const pa = sampleAt(a, t);
    const pb = sampleAt(b, t);
    if (!pa || !pb) continue;
    samples.push({ epochSeconds: t, metres: distanceMetres(pa.position, pb.position) });
  }
  return samples;
}

/**
 * Closest point of approach. Note this is the distance between the two REPORTED
 * positions - which for an AIS track is the GPS antenna, not the hull. On a 180 m ship
 * the antenna can sit over a hundred metres from the bow, so a CPA of 50 m between
 * antennae is contact between hulls, not a near miss.
 */
export function closestPointOfApproach(
  a: PreparedTrack,
  b: PreparedTrack,
  stepSeconds = 1,
): RangeSample | null {
  let best: RangeSample | null = null;
  for (const sample of rangeSeries(a, b, stepSeconds)) {
    if (!best || sample.metres < best.metres) best = sample;
  }
  return best;
}

function blendDegrees(
  a: number | undefined,
  b: number | undefined,
  fraction: number,
): number | undefined {
  if (a === undefined || b === undefined) return fraction < 0.5 ? a : b;
  return interpolateDegrees(a, b, fraction);
}

function blendNumbers(
  a: number | undefined,
  b: number | undefined,
  fraction: number,
): number | undefined {
  if (a === undefined || b === undefined) return fraction < 0.5 ? a : b;
  return a + (b - a) * fraction;
}

/** Metres travelled per second at a given speed over ground. */
export function knotsToMetresPerSecond(knots: number): number {
  return knots * KNOTS_TO_METRES_PER_SECOND;
}
