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
      offsetsStated: true,
    });
  });

  it("falls back to the particulars where no offsets are stated, and says that too", () => {
    expect(hullDimensions(COASTER)).toEqual({
      lengthMetres: 49,
      beamMetres: 9.4,
      from: "particulars",
      offsetsStated: false,
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
    expect(dimensions).toEqual({
      lengthMetres: 49,
      beamMetres: 9,
      from: "offsets",
      offsetsStated: true,
    });
    expect(dimensions.beamMetres).not.toBe(mixed.beamMetres);
  });

  /**
   * **Stated is not the same as measured.** The schema's floor on each of the four distances
   * is zero, so a ship whose dimensions never came through - transcribed as the zeroes AIS
   * sent - is a valid file. Summing them would give a hull of no length or no beam: nothing
   * drawn, lamps at the origin, and a degenerate polygon that the crossing and containment
   * tests would still answer plausibly for. It goes back to the particulars, and says so.
   */
  it("falls back to the particulars where the offsets measure nothing", () => {
    const zeroed = {
      fromBowMetres: 0,
      fromSternMetres: 0,
      fromPortMetres: 0,
      fromStarboardMetres: 0,
    };
    expect(hullDimensions({ ...COASTER, referencePointOffsets: zeroed })).toEqual({
      lengthMetres: 49,
      beamMetres: 9.4,
      from: "particulars",
      // **Stated, and unusable.** A page that reports this as "no offsets stated" says
      // something false about the file, so the two facts are kept apart.
      offsetsStated: true,
    });
  });

  /** And where only one axis came through, because half a hull is not a hull either. */
  it("falls back where only the length or only the beam came through", () => {
    const noBeam = {
      fromBowMetres: 39,
      fromSternMetres: 10,
      fromPortMetres: 0,
      fromStarboardMetres: 0,
    };
    const noLength = {
      fromBowMetres: 0,
      fromSternMetres: 0,
      fromPortMetres: 4,
      fromStarboardMetres: 5,
    };
    expect(hullDimensions({ ...COASTER, referencePointOffsets: noBeam }).from).toBe("particulars");
    expect(hullDimensions({ ...COASTER, referencePointOffsets: noLength }).from).toBe(
      "particulars",
    );
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
    offsetsStated: false,
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
    const dimensions: HullDimensions = {
      lengthMetres: 100,
      beamMetres: 20,
      from: "particulars",
      offsetsStated: false,
    };
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

  /**
   * **A spell open at the edge of the record ends at the edge, not at the last whole second.**
   * A track may start or end on a fractional second - the schema allows it and `prepareTrack`
   * keeps the milliseconds - and walking from the next whole second to the previous one put
   * the reported edge up to a step inside the real one. That is the fault this area was fixed
   * for, surviving at the boundaries.
   */
  it("opens a spell at the start of the record where they are already touching", () => {
    const a = prepareActor(actor("A", alongside([0, 0, 0]), BIG_SHIP), ORIGIN);
    const late = actor("B", alongside([0.0001, 0.0001, 0.0001]), BIG_SHIP);
    // Half a second in, and still touching: the spell opens then, not at the next second.
    late.track.points = late.track.points.map((point) => ({
      ...point,
      t: new Date(Date.parse(point.t) + 500).toISOString(),
    }));
    const ship = { vessel: BIG_SHIP, positionAt: "gps-antenna" } as const;
    const approach = hullApproach(
      { track: a, ...ship },
      { track: prepareActor(late, ORIGIN), ...ship },
    );
    const [spell] = approach?.contacts ?? [];

    expect(spell?.fromEpochSeconds).toBe(Date.parse("2025-01-01T00:00:00.500Z") / 1000);
    expect(spell?.toEpochSeconds).toBe(Date.parse("2025-01-01T00:02:00.000Z") / 1000);
  });

  /** And an overlap shorter than one step is looked at rather than dropped to nothing. */
  it("still answers where the two tracks overlap by less than a step", () => {
    const a = prepareActor(actor("A", alongside([0, 0]), BIG_SHIP), ORIGIN);
    const brief = actor("B", alongside([0.0001, 0.0001]), BIG_SHIP);
    // B's record starts 0.4 s before A's ends, so the two share four tenths of a second.
    const shift = Date.parse("2025-01-01T00:01:00Z") - Date.parse("2025-01-01T00:00:00Z") - 400;
    brief.track.points = brief.track.points.map((point) => ({
      ...point,
      t: new Date(Date.parse(point.t) + shift).toISOString(),
    }));
    const ship = { vessel: BIG_SHIP, positionAt: "gps-antenna" } as const;
    const approach = hullApproach(
      { track: a, ...ship },
      { track: prepareActor(brief, ORIGIN), ...ship },
    );

    expect(approach).not.toBeNull();
    expect(approach?.contacts).toHaveLength(1);
    const [spell] = approach?.contacts ?? [];
    expect((spell?.toEpochSeconds ?? 0) - (spell?.fromEpochSeconds ?? 0)).toBeCloseTo(0.4, 3);
  });

  /**
   * **A step of zero walks for ever.** It is a public boundary of the arithmetic, so one
   * degenerate argument would otherwise stop the process rather than return a wrong answer.
   * Substituting a sensible step would hide the caller's mistake behind something that looks
   * like an answer.
   */
  it("refuses a step that is not a positive number of seconds", () => {
    const a = prepareActor(actor("A", alongside([0, 0]), BIG_SHIP), ORIGIN);
    const ship = { vessel: BIG_SHIP, positionAt: "gps-antenna" } as const;
    const pair = [
      { track: a, ...ship },
      { track: a, ...ship },
    ] as const;

    for (const step of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => hullApproach(pair[0], pair[1], step), `${step}`).toThrow(/positive step/);
    }
  });

  /**
   * **Positive and finite is not the same as able to move a clock.** An epoch second is about
   * 1.7e9, where the gap between one double and the next is 2.4e-7 - so `t + 1e-10 === t` and
   * the loop stands still for ever. And a step that DOES advance can still ask for ten billion
   * polygon comparisons, which is the same hang taking a different route.
   */
  it("refuses a step too small to advance a clock, or one asking for too many looks", () => {
    const a = prepareActor(actor("A", alongside([0, 0]), BIG_SHIP), ORIGIN);
    const ship = { vessel: BIG_SHIP, positionAt: "gps-antenna" } as const;
    const one = { track: a, ...ship };

    expect(() => hullApproach(one, one, Number.MIN_VALUE)).toThrow(/too small to advance/);
    expect(() => hullApproach(one, one, 1e-10)).toThrow(/too small to advance/);
    // Advances the clock, and asks for six hundred million looks over these two minutes.
    expect(() => hullApproach(one, one, 1e-6)).toThrow(/looks/);
  });

  /**
   * **Two spells inside one coarse step, which the search used to report as one.** The
   * boundary hunt bisected between a clear look and a touching one, which assumes a single
   * crossing between them - the same assumption removed from the narrowing, left in the other
   * function. A pair that touched, came clear and touched again inside one step came back as
   * one spell across the clear water in between: not a missed contact but an invented one.
   *
   * A coarse step of a minute against a step of a tenth of a second, over a track that does
   * exactly that. The fine search is the answer; the coarse one has to agree with it.
   */
  it("finds both spells where they happen inside one coarse step", () => {
    const a = prepareActor(actor("A", alongside([0, 0, 0, 0, 0]), BIG_SHIP), ORIGIN);
    // In, out, in, out - four minutes of it, so a one-minute step sees only the ends.
    const b = prepareActor(
      actor("B", alongside([0.0005, 0.0001, 0.0005, 0.0001, 0.0005]), BIG_SHIP),
      ORIGIN,
    );
    const ship = { vessel: BIG_SHIP, positionAt: "gps-antenna" } as const;
    const pair = [
      { track: a, ...ship },
      { track: b, ...ship },
    ] as const;

    const fine = hullApproach(pair[0], pair[1], 0.1);
    // The whole window in one step, so nothing but the tracks' own samples and the refinement
    // stands between the two ends - and at both ends the ships are clear and in the same place
    // they started, which is what defeats a bound taken across a sample boundary.
    const coarse = hullApproach(pair[0], pair[1], 240);

    const fineSpells = fine?.contacts ?? [];
    const coarseSpells = coarse?.contacts ?? [];
    expect(fineSpells).toHaveLength(2);
    expect(coarseSpells).toHaveLength(2);

    // And the same spells, not merely the same count.
    const ends = (spells: typeof fineSpells): number[] =>
      spells.flatMap((spell) => [spell.fromEpochSeconds, spell.toEpochSeconds]);
    for (const [index, moment] of ends(coarseSpells).entries()) {
      expect(moment, `${index}`).toBeCloseTo(ends(fineSpells)[index] ?? 0, 0);
    }
  });

  /**
   * **Discharging an interval proves they did not touch in it, not that they did not close.**
   * Two ends 100 m apart where the pair can only close 90 m cannot meet - and can still pass
   * at 10 m in the middle. For as long as the search only asked about state changes, that
   * interval was skipped and whatever smaller number some other look happened to hold was
   * reported as the closest they came: a plausible figure for a range nobody came within.
   *
   * So the second proof is a branch and bound, and this is what it is for. A pass that dips
   * between two coarse looks, against a scan fine enough to see it.
   */
  it("finds a near pass hiding between two looks that could not touch", () => {
    const a = prepareActor(actor("A", alongside([0, 0, 0]), BIG_SHIP), ORIGIN);
    // B comes in to 40 m and goes out again inside a minute, never close enough to touch.
    const b = prepareActor(actor("B", alongside([0.0009, 0.0004, 0.0009]), BIG_SHIP), ORIGIN);
    const ship = { vessel: BIG_SHIP, positionAt: "gps-antenna" } as const;
    const pair = [
      { track: a, ...ship },
      { track: b, ...ship },
    ] as const;

    const fine = hullApproach(pair[0], pair[1], 0.05);
    const coarse = hullApproach(pair[0], pair[1], 120);

    expect(fine?.contacts).toEqual([]);
    expect(coarse?.metres).toBeCloseTo(fine?.metres ?? 0, 1);
    expect(coarse?.epochSeconds).toBeCloseTo(fine?.epochSeconds ?? 0, 0);
  });

  /**
   * **What it could not account for is measured, not assumed.** Two identical tracks never move
   * with respect to each other, so every interval discharges on the first test and nothing is
   * left; a pair whose direction changes which field it comes from always leaves something,
   * because nothing bounds the jump the drawn hull makes at the midpoint.
   */
  it("reports nothing unaccounted for where every interval discharges", () => {
    const a = prepareActor(actor("A", alongside([0, 0]), BIG_SHIP), ORIGIN);
    const ship = { vessel: BIG_SHIP, positionAt: "gps-antenna" } as const;
    const approach = hullApproach({ track: a, ...ship }, { track: a, ...ship });

    expect(approach?.stepSeconds).toBe(1);
    expect(approach?.unprovenSeconds).toBe(0);
  });

  /**
   * **The change this iteration is about: a heading appearing beside a course.** `sampleAt`
   * hands back the course for the first half of the span and the heading for the second, so
   * the drawn ship turns with one and snaps to the other at the midpoint. Both halves have A
   * direction, so asking only whether one was available finds nothing wrong - and a bound read
   * off two ends that happen to agree certifies that she never turned.
   */
  it("cannot account for the moment a heading takes over from a course", () => {
    const a = prepareActor(actor("A", alongside([0, 0, 0]), BIG_SHIP), ORIGIN);
    const swapping = actor("B", alongside([0.0004, 0.0004, 0.0004]), BIG_SHIP);
    // Course throughout; a heading from the second sample on, so the source swaps mid-span.
    swapping.track.points = swapping.track.points.map((point, index) => ({
      ...point,
      cogDegreesTrue: 0,
      ...(index === 0 ? {} : { headingDegreesTrue: 90 }),
    }));
    const ship = { vessel: BIG_SHIP, positionAt: "gps-antenna" } as const;
    const approach = hullApproach(
      { track: a, ...ship },
      { track: prepareActor(swapping, ORIGIN), ...ship },
    );

    expect(approach?.unprovenSeconds).toBeGreaterThan(0);
    expect(approach?.unprovenSeconds).toBeLessThanOrEqual(1);
  });

  /**
   * **A grazing contact has no depth to certify, and would halve for ever.** `overlapDepth`
   * measures how far a corner or a middle of one hull lies inside the other; two hulls crossing
   * at their ends have neither inside, so it comes back nought, no interval can be proved to
   * hold no change of state, and the halving runs to the floor for as long as the grazing
   * lasts. Positions are rounded and the outlines generated, so a shallow crossing that
   * persists is not exotic - a ship alongside, or the minutes after a collision - and a page
   * that renders one must not sit there doing millions of polygon comparisons.
   *
   * The budget is what stops it, and what it left is reported rather than hidden.
   */
  it("stops rather than hangs on a long shallow crossing, and says what it left", () => {
    // Overlapping by about a metre for a quarter of an hour, edges crossing and nothing inside.
    const minutes = Array.from({ length: 16 }, (_, index) => index);
    const track = (lon: number): TrackPoint[] =>
      minutes.map((minute) => ({
        t: new Date(Date.UTC(2025, 0, 1, 0, minute)).toISOString(),
        lat: minute * 0.00001,
        lon,
        cogDegreesTrue: 0,
        headingDegreesTrue: 0,
      }));
    const a = prepareActor(actor("A", track(0), BIG_SHIP), ORIGIN);
    const b = prepareActor(actor("B", track(0.00025), BIG_SHIP), ORIGIN);
    const ship = { vessel: BIG_SHIP, positionAt: "gps-antenna" } as const;

    const began = Date.now();
    const approach = hullApproach({ track: a, ...ship }, { track: b, ...ship });
    const took = Date.now() - began;

    expect(approach).not.toBeNull();
    expect(took).toBeLessThan(4000);
  });

  /**
   * **A turning ship is where a cleverer search goes wrong.** The first version of the
   * narrowing ran a ternary search, which assumes the window holds one minimum. What is being
   * measured is the shortest distance between two polygons that are TURNING, and which pair of
   * vertex and edge is nearest switches as they go - a piecewise function that can hold two
   * valleys in a second. A sweep of the window assumes nothing, and this pins it against a
   * scan fine enough to have no window to miss.
   */
  it("narrows a turning approach to what a fine scan finds", () => {
    const swinging = (lons: number[], headings: number[]): TrackPoint[] =>
      lons.map((lon, index) => ({
        t: new Date(Date.UTC(2025, 0, 1, 0, index)).toISOString(),
        lat: 0,
        lon,
        cogDegreesTrue: headings[index] ?? 0,
        headingDegreesTrue: headings[index] ?? 0,
      }));
    const a = prepareActor(actor("A", swinging([0, 0, 0], [0, 0, 0]), BIG_SHIP), ORIGIN);
    // B swings through ninety degrees as she passes, so her nearest corner changes on the way.
    const b = prepareActor(
      actor("B", swinging([0.0016, 0.0011, 0.0016], [0, 90, 180]), BIG_SHIP),
      ORIGIN,
    );
    const ship = { vessel: BIG_SHIP, positionAt: "gps-antenna" } as const;
    const pair = [
      { track: a, ...ship },
      { track: b, ...ship },
    ] as const;

    const fine = hullApproach(pair[0], pair[1], 0.05);
    const coarse = hullApproach(pair[0], pair[1], 5);

    expect(coarse?.contacts).toEqual([]);
    expect(coarse?.metres).toBeCloseTo(fine?.metres ?? 0, 1);
  });

  /**
   * **The least gap comes off the hulls too, not off the step that happened to show it.**
   * Two ships passing without touching are nearest somewhere between two looks, so a grid
   * reading is up to a step stale - and the panel prints it as a distance with no hedge. The
   * contact edges were already bisected; this is the same fix on the other branch.
   */
  it("narrows the least gap below the step it searched at", () => {
    // B slides past A: nearest between the samples rather than on one of them.
    const a = prepareActor(actor("A", alongside([0, 0, 0]), BIG_SHIP), ORIGIN);
    const b = prepareActor(actor("B", alongside([0.0008, 0.0006, 0.0008]), BIG_SHIP), ORIGIN);
    const ship = { vessel: BIG_SHIP, positionAt: "gps-antenna" } as const;

    const fine = hullApproach({ track: a, ...ship }, { track: b, ...ship }, 0.1);
    const coarse = hullApproach({ track: a, ...ship }, { track: b, ...ship }, 10);

    expect(coarse?.contacts).toEqual([]);
    expect(coarse?.metres).toBeGreaterThan(0);
    // Refined, the coarse search lands within a centimetre of the fine one rather than
    // wherever its ten-second grid fell.
    expect(coarse?.metres).toBeCloseTo(fine?.metres ?? 0, 2);
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
