/**
 * Where a ship's hull sits relative to the position her track reports.
 *
 * An AIS position is the GPS antenna, and message 5 says where that antenna sits by giving
 * its distance to the bow, the stern, the port side and the starboard side. Anything that
 * draws a hull draws it about the hull's own centre, so without this the whole ship is
 * displaced along her heading - on the Suo-nada tanker by 14.5 m and on the pushing unit by
 * 43.5 m, in a case whose final approach is measured in tens of metres.
 *
 * The DIRECTION is the part worth reading twice, and it is the opposite of what it first
 * looks like. On that tanker the antenna sits 39 m from the bow of a 49 m ship - well aft of
 * the middle - so the hull's centre lies FORWARD of the reported position, and drawing the
 * centre at the antenna puts the whole ship astern of where she was. The sign below is the
 * one that brings the two hulls into contact at the time the report gives; reversed, it
 * leaves twenty-one metres of clear water between them and no collision at all.
 * test/examples.spec.ts pins that on the real case, because whether the two ships touch is
 * the only check here that a plausible-looking mistake cannot satisfy.
 */

import type { ReferencePointOffsets, Track } from "../../core/types.js";

/** Metres from the reported position to the hull's centre, along the ship's own axes. */
export interface OffsetMetres {
  /** Towards the bow. */
  forwardMetres: number;
  /** Towards the starboard side. */
  starboardMetres: number;
}

/**
 * The three answers, kept apart because they read differently to anyone checking the
 * reconstruction: a hull that was moved, one that needed no moving, and one that is drawn
 * where it was reported because the source never said where the antenna was.
 */
export type HullOffset =
  ({ kind: "offset" } & OffsetMetres) | { kind: "already-the-hull" } | { kind: "not-stated" };

const NO_OFFSET: OffsetMetres = { forwardMetres: 0, starboardMetres: 0 };

export function hullCentreOffset(
  positionAt: Track["positionAt"],
  offsets: ReferencePointOffsets | undefined,
): HullOffset {
  // A track already reported at the ship's reference point has had this done to it
  // upstream. Applying it again displaces her twice, in a way that still looks like a ship.
  if (positionAt === "reference-point") return { kind: "already-the-hull" };
  if (!offsets) return { kind: "not-stated" };

  // Both halves close inside the four offsets rather than reaching for loaMetres or
  // beamMetres. AIS rounds these to the metre: on the Suo-nada tanker they sum to a beam of
  // 9 against a stated 9.4, and mixing the two sources invents 0.2 m of displacement out of
  // a rounding difference.
  return {
    kind: "offset",
    forwardMetres: (offsets.fromBowMetres - offsets.fromSternMetres) / 2,
    starboardMetres: (offsets.fromStarboardMetres - offsets.fromPortMetres) / 2,
  };
}

/** The metres to apply, with both "nothing to apply" cases collapsed onto zero. */
export function offsetMetres(offset: HullOffset): OffsetMetres {
  return offset.kind === "offset" ? offset : NO_OFFSET;
}
