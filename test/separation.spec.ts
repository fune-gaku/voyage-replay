import { describe, expect, it } from "vitest";

import {
  hullDimensions,
  isBoxBowed,
  planOutline,
  type HullDimensions,
} from "../src/actors/vessel/hull-shape.js";
import { placementFor, NO_OFFSET } from "../src/actors/vessel/reference-point.js";
import { hullApproach, placedOutline, separationMetres } from "../src/actors/vessel/separation.js";
import { prepareActor } from "../src/core/track.js";
import type { TrackPoint } from "../src/core/types.js";

import { actor, BIG_SHIP, COASTER, ORIGIN } from "./fixtures.js";

/**
 * **The dimensions and the shape had two homes and disagreed in both.** The renderer drew a
 * curved outline at the particulars; a test asked whether two ships had touched using a
 * rectangle at the AIS offsets. Either is defensible and they answer differently, so the
 * question of what a hull IS is settled once, here, and everything that draws or measures one
 * reads the same answer.
 */
describe("how big a hull is", () => {
  it("takes the four offsets over the particulars, and says which", () => {
    // BIG_SHIP's offsets sum to 180 by 28, which is also her particulars - the fixture is
    // deliberately consistent, so this pins the SOURCE rather than a difference.
    expect(hullDimensions(BIG_SHIP)).toEqual({
      lengthMetres: 180,
      beamMetres: 28,
      from: "offsets",
    });
  });

  it("falls back to the particulars where no offsets are stated, and says that too", () => {
    expect(hullDimensions(COASTER)).toEqual({
      lengthMetres: 49,
      beamMetres: 9.4,
      from: "particulars",
    });
  });

  /**
   * **The two sources disagree on real data, which is why this matters.** The Suo-nada
   * tanker's particulars give a 9.4 m beam and her four offsets sum to 9.0 - a difference
   * that moves first contact by a second. Mixing them, taking length from one and beam from
   * the other, would invent a hull neither source describes.
   */
  it("does not mix the two sources", () => {
    const mixed = {
      ...COASTER,
      referencePointOffsets: {
        fromBowMetres: 39,
        fromSternMetres: 10,
        fromPortMetres: 4,
        fromStarboardMetres: 5,
      },
    };
    const dimensions = hullDimensions(mixed);
    expect(dimensions).toEqual({ lengthMetres: 49, beamMetres: 9, from: "offsets" });
    expect(dimensions.beamMetres).not.toBe(mixed.beamMetres);
  });

  /** A pushing unit is a pusher against the stern of a barge, and a barge is a box. */
  it("squares the bow of a pushing unit and rakes everyone else's", () => {
    expect(isBoxBowed({ ...COASTER, type: "pushing-ahead" })).toBe(true);
    expect(isBoxBowed(COASTER)).toBe(false);
  });
});

describe("the shape of a hull from overhead", () => {
  const dimensions: HullDimensions = {
    lengthMetres: 100,
    beamMetres: 20,
    from: "particulars",
  };

  it("spans exactly the length and beam it was given", () => {
    const outline = planOutline(dimensions, false);
    const forward = outline.map((p) => p.forwardMetres);
    const starboard = outline.map((p) => p.starboardMetres);

    expect(Math.max(...forward)).toBeCloseTo(50, 6);
    expect(Math.min(...forward)).toBeCloseTo(-50, 6);
    expect(Math.max(...starboard)).toBeCloseTo(10, 6);
    expect(Math.min(...starboard)).toBeCloseTo(-10, 6);
  });

  /**
   * **This is the whole reason a range between hulls is not a range between rectangles.**
   * Issue #10 proposed rectangles. At the stem a rectangle is half a beam wide where the
   * drawn hull is a point, so a rectangle's corner reaches out past the bow that is drawn -
   * ten metres here - and reports contact where the picture shows clear water.
   */
  it("comes to a point at the stem, where a rectangle has a corner", () => {
    const outline = planOutline(dimensions, false);
    const stem = outline.reduce((best, p) => (p.forwardMetres > best.forwardMetres ? p : best));

    expect(stem.forwardMetres).toBeCloseTo(50, 6);
    expect(stem.starboardMetres).toBeCloseTo(0, 6);
    // Nothing is at full beam anywhere near the stem.
    const nearStem = outline.filter((p) => p.forwardMetres > 45);
    expect(Math.max(...nearStem.map((p) => Math.abs(p.starboardMetres)))).toBeLessThan(10);
  });

  it("takes a box bow square across, because a barge is a box", () => {
    const outline = planOutline(dimensions, true);
    const atStem = outline.filter((p) => p.forwardMetres > 49.9);
    expect(atStem.map((p) => p.starboardMetres).sort((x, y) => x - y)).toEqual([-10, 10]);
  });

  /** And the transom is narrower than the middle, which is what makes a stern read as one. */
  it("draws in the stern", () => {
    const outline = planOutline(dimensions, false);
    const transom = outline.filter((p) => p.forwardMetres < -49.9);
    expect(Math.max(...transom.map((p) => Math.abs(p.starboardMetres)))).toBeCloseTo(8.5, 6);
  });
});

describe("where a hull's outline lies", () => {
  const square = [
    { forwardMetres: 10, starboardMetres: 5 },
    { forwardMetres: 10, starboardMetres: -5 },
    { forwardMetres: -10, starboardMetres: -5 },
    { forwardMetres: -10, starboardMetres: 5 },
  ];
  const origin = { east: 0, north: 0 };

  it("puts the bow north when she heads north", () => {
    const placed = placedOutline(square, placementFor(0, NO_OFFSET), origin);
    expect(placed[0]).toEqual({ east: 5, north: 10 });
  });

  /** Ninety degrees is east, so the bow goes east and the starboard side goes south. */
  it("turns with her heading", () => {
    const placed = placedOutline(square, placementFor(90, NO_OFFSET), origin);
    expect(placed[0]?.east).toBeCloseTo(10, 6);
    expect(placed[0]?.north).toBeCloseTo(-5, 6);
  });

  /**
   * **The offset acts along her own axes, which is the sign the reference case pins.** A ship
   * heading east with her centre 50 m forward of the antenna has that centre 50 m EAST of it,
   * not 50 m north.
   */
  it("applies the offset along the ship, not along the chart", () => {
    const offset = { forwardMetres: 50, starboardMetres: 0 };
    const placed = placedOutline(square, placementFor(90, offset), origin);
    expect(placed[0]?.east).toBeCloseTo(60, 6);
    expect(placed[0]?.north).toBeCloseTo(-5, 6);
  });

  /**
   * **No stated direction, no offset** - the rule `render/player.ts` places her by. Applying
   * it without a heading would invent a displacement of fifty metres due north and move her
   * off the reported position, which is the only thing the source actually says.
   */
  it("declines the offset where nothing states which way she points", () => {
    const offset = { forwardMetres: 50, starboardMetres: 0 };
    const placed = placedOutline(square, placementFor(undefined, offset), origin);
    expect(placed[0]).toEqual({ east: 5, north: 10 });
  });
});

describe("the gap between two hulls", () => {
  const box = (east: number, north: number, half = 5): { east: number; north: number }[] => [
    { east: east + half, north: north + half },
    { east: east + half, north: north - half },
    { east: east - half, north: north - half },
    { east: east - half, north: north + half },
  ];

  it("measures side to side, not centre to centre", () => {
    expect(separationMetres(box(0, 0), box(30, 0))).toBeCloseTo(20, 6);
  });

  it("measures corner to corner on the diagonal", () => {
    expect(separationMetres(box(0, 0), box(15, 15))).toBeCloseTo(Math.hypot(5, 5), 6);
  });

  it("is zero once they are through each other", () => {
    expect(separationMetres(box(0, 0), box(6, 0))).toBe(0);
  });

  it("is zero where they merely touch", () => {
    expect(separationMetres(box(0, 0), box(10, 0))).toBeCloseTo(0, 6);
  });

  /**
   * **Crossing edges alone would miss this.** A small craft wholly inside the outline of a
   * large one crosses no side of it, so containment is asked separately - and both ways
   * round, because either polygon may be the one inside.
   */
  it("is zero where one hull is wholly inside the other", () => {
    expect(separationMetres(box(0, 0, 20), box(0, 0, 2))).toBe(0);
    expect(separationMetres(box(0, 0, 2), box(0, 0, 20))).toBe(0);
  });

  /**
   * **A rectangle reports contact before the drawn hull does**, which is the finding that put
   * this module on the drawn outline rather than on a bounding box. Two ships approaching
   * bow to bow: the rectangles' corners meet while the raked stems still have water between
   * them.
   */
  it("clears a raked bow where a bounding box would not", () => {
    const dimensions: HullDimensions = { lengthMetres: 100, beamMetres: 20, from: "particulars" };
    const rectangle = [
      { forwardMetres: 50, starboardMetres: 10 },
      { forwardMetres: 50, starboardMetres: -10 },
      { forwardMetres: -50, starboardMetres: -10 },
      { forwardMetres: -50, starboardMetres: 10 },
    ];
    // Abeam of each other by nine metres of offset, and overlapping along their length.
    const north = placementFor(0, NO_OFFSET);
    const here = { east: 0, north: 0 };
    const there = { east: 19, north: 80 };

    const hulls = separationMetres(
      placedOutline(planOutline(dimensions, false), north, here),
      placedOutline(planOutline(dimensions, false), north, there),
    );
    const boxes = separationMetres(
      placedOutline(rectangle, north, here),
      placedOutline(rectangle, north, there),
    );

    expect(boxes).toBeLessThan(hulls);
    expect(hulls).toBeGreaterThan(0);
  });
});

/**
 * **Contact over a track, which is where the two faults a review found both lived.**
 *
 * One was that a spell never closed: a second contact after a swing was folded into the first,
 * so the page asserted contact through the clear water between them. The other was that the
 * length of a spell was the NUMBER OF SAMPLES that showed contact rather than the time between
 * its ends - one step out every time.
 */
describe("contact over a track", () => {
  /** Both hulls are 180 m by 28 m, so they touch when their centres are within 28 m abeam. */
  function alongside(lonDegrees: number[]): TrackPoint[] {
    return lonDegrees.map((lon, index) => ({
      t: new Date(Date.UTC(2025, 0, 1, 0, index) * 1).toISOString(),
      lat: 0,
      lon,
      cogDegreesTrue: 0,
      headingDegreesTrue: 0,
    }));
  }

  function approachOf(lonDegrees: number[]) {
    const a = prepareActor(actor("A", alongside([0, 0, 0, 0, 0]), BIG_SHIP), ORIGIN);
    const b = prepareActor(actor("B", alongside(lonDegrees), BIG_SHIP), ORIGIN);
    const ship = { vessel: BIG_SHIP, positionAt: "gps-antenna" } as const;
    return hullApproach({ track: a, ...ship }, { track: b, ...ship });
  }

  /** Clear, in, clear again: one spell, with both ends off the drawn hulls. */
  it("closes a spell when the hulls come clear", () => {
    const approach = approachOf([0.0005, 0.0001, 0.0005, 0.0005, 0.0005]);
    expect(approach?.contacts).toHaveLength(1);
  });

  /**
   * **In, clear, in again: two spells and not one.** Left open, the window would run from the
   * first meeting to the last and assert contact across a minute of clear water - a picture of
   * a collision the data says did not happen.
   */
  it("reports two spells where they come clear and meet again", () => {
    const approach = approachOf([0.0005, 0.0001, 0.0005, 0.0001, 0.0005]);
    expect(approach?.contacts).toHaveLength(2);

    const [first, second] = approach?.contacts ?? [];
    expect(first?.toEpochSeconds).toBeLessThan(second?.fromEpochSeconds ?? 0);
  });

  /**
   * **The length is the time between the ends, not the count of samples inside them.** A spell
   * observed at ten one-second samples is nine seconds long, and this project printed ten.
   */
  it("measures a spell by its ends rather than by its samples", () => {
    const approach = approachOf([0.0005, 0.0001, 0.0005, 0.0005, 0.0005]);
    const [spell] = approach?.contacts ?? [];
    const seconds = (spell?.toEpochSeconds ?? 0) - (spell?.fromEpochSeconds ?? 0);

    // The ends are bisected, so they are not on the one-second grid the search walked.
    expect(Number.isInteger(spell?.fromEpochSeconds)).toBe(false);
    expect(seconds).toBeGreaterThan(0);
    expect(seconds).toBeLessThan(120);
  });

  /** Where they never meet, there are no spells and the least gap is a real distance. */
  it("reports no spell and a gap where they never touch", () => {
    const approach = approachOf([0.002, 0.002, 0.002, 0.002, 0.002]);
    expect(approach?.contacts).toEqual([]);
    expect(approach?.metres).toBeGreaterThan(0);
  });

  /** And the step it walked at is carried, because a contact shorter than it can be missed. */
  it("carries the step it searched at", () => {
    expect(approachOf([0.002, 0.002, 0.002, 0.002, 0.002])?.stepSeconds).toBe(1);
  });

  it("is null where the two tracks never overlap in time", () => {
    const a = prepareActor(actor("A", alongside([0, 0]), BIG_SHIP), ORIGIN);
    const late = actor("B", alongside([0, 0]), BIG_SHIP);
    late.track.points = late.track.points.map((point) => ({
      ...point,
      t: new Date(Date.parse(point.t) + 86400000).toISOString(),
    }));
    const ship = { vessel: BIG_SHIP, positionAt: "gps-antenna" } as const;

    expect(
      hullApproach({ track: a, ...ship }, { track: prepareActor(late, ORIGIN), ...ship }),
    ).toBeNull();
  });
});
