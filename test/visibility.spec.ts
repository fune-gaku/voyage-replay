import { describe, expect, it } from "vitest";

import { crestOcclusionMetres, horizonMetres, type Sightline } from "../src/core/horizon.js";
import { exceedanceProbability, seawayFrom, seawayOf } from "../src/core/seaway.js";
import { occludedFraction, occludedFractionBounds } from "../src/core/visibility.js";

/** An eight-metre eye looking for a metre and a half of freeboard, which is the geometry
 * every measured figure in these tests and in `plans/wave-occlusion-30.md` was taken on. */
const look = (rangeMetres: number): Sightline => ({
  eyeHeightMetres: 8,
  targetHeightMetres: 1.5,
  rangeMetres,
});

describe("how much of the time the sea is in the way", () => {
  it("hides nothing in a flat calm, however far off she is", () => {
    for (const range of [2_000, 11_000, 15_000]) {
      expect(occludedFraction(look(range), seawayOf(0)).rigidFraction).toBe(0);
      expect(occludedFraction(look(range), seawayOf(0)).ridingFraction).toBe(0);
    }
  });

  it("hides more of a rougher sea, and more of a longer range", () => {
    const at = (range: number, hs: number) =>
      occludedFraction(look(range), seawayOf(hs, 5.5)).rigidFraction;
    expect(at(11_000, 2)).toBeGreaterThan(at(11_000, 1.25));
    expect(at(13_000, 2)).toBeGreaterThan(at(11_000, 2));
  });

  it("hides less of a taller ship at the same range", () => {
    const sea = seawayOf(2, 5.5);
    const tall = { eyeHeightMetres: 8, targetHeightMetres: 6, rangeMetres: 13_000 };
    expect(occludedFraction(tall, sea).rigidFraction).toBeLessThan(
      occludedFraction(look(13_000), sea).rigidFraction,
    );
  });

  /**
   * The whole reason this is an integral along the line rather than a probability at the
   * grazing point. The clearance is quadratic about that point and takes kilometres to rise
   * by one standard deviation, so hundreds of waves stand within a whisker of the line and
   * the target is hidden if any one of them is over it. A spectral Monte Carlo on this
   * geometry gives 48%; the point probability gives 0.1%.
   */
  it("is far above the probability at the single closest point", () => {
    const sea = seawayOf(1.25, 4.5);
    const sightline = look(13_000);
    const atThePoint = exceedanceProbability(sea, crestOcclusionMetres(sightline));
    const alongTheLine = occludedFraction(sightline, sea).rigidFraction;

    expect(atThePoint).toBeLessThan(0.002);
    expect(alongTheLine).toBeGreaterThan(0.5);
    expect(alongTheLine / atThePoint).toBeGreaterThan(100);
  });

  /**
   * Past the two-horizons range the earth has her without help, so the answer has to be
   * certainty. The crossing rate alone cannot say this - crossings of a level far BELOW the
   * mean surface are rare too, for the opposite reason - which is what the first term of
   * the Rice form is there to catch.
   */
  it("is certain once the earth alone has hidden her", () => {
    const beyond = horizonMetres(8) + horizonMetres(1.5) + 3_000;
    for (const hs of [0.5, 2]) {
      expect(occludedFraction(look(beyond), seawayOf(hs)).rigidFraction).toBeGreaterThan(0.999);
      expect(occludedFraction(look(beyond), seawayOf(hs)).ridingFraction).toBeGreaterThan(0.99);
    }
  });
});

describe("holding her rigid against letting her ride the sea", () => {
  /**
   * The pair exists because neither is the safe side and which one is higher REVERSES with
   * range: close in her drop into a trough matters more than the crests do, and near the
   * horizon her rise on one lifts her clear. Figures from a spectral Monte Carlo on this
   * geometry in a 2 m sea - 8 km 18/36, 11 km 82/64, 13 km 100/94 - and the crossing is the
   * property worth fixing, not the values.
   */
  it("reverses which is worse somewhere between eight and thirteen kilometres", () => {
    const sea = seawayOf(2, 5.5);
    const near = occludedFraction(look(8_000), sea);
    const far = occludedFraction(look(13_000), sea);

    expect(near.ridingFraction).toBeGreaterThan(near.rigidFraction);
    expect(far.ridingFraction).toBeLessThan(far.rigidFraction);
  });

  /**
   * A vessel riding the sea cannot be hidden by the wave she is sitting on: within a
   * wavelength of her, her freeboard and the surface are the same wave. Held here at the
   * limit, where the whole line is inside that stretch and there is no independent sea
   * between the two at all - the rigid model, which does not float, still finds a crest.
   */
  it("is never hidden by her own wave, however rough it is", () => {
    const sea = seawayOf(4, 8);
    const close = { eyeHeightMetres: 8, targetHeightMetres: 1.5, rangeMetres: 40 };
    expect(sea.peakWavelengthMetres).toBeGreaterThan(close.rangeMetres);

    expect(occludedFraction(close, sea).ridingFraction).toBe(0);
    expect(occludedFraction(close, sea).rigidFraction).toBeGreaterThan(0);
  });

  it("keeps riding within reach of rigid rather than answering a different question", () => {
    const sea = seawayOf(2, 5.5);
    for (const range of [8_000, 11_000, 13_000]) {
      const { rigidFraction, ridingFraction } = occludedFraction(look(range), sea);
      expect(Math.abs(ridingFraction - rigidFraction)).toBeLessThan(0.35);
    }
  });
});

describe("the bounds a sea state actually supports", () => {
  it("spans both ends of the class and both ends of her response", () => {
    const estimate = seawayFrom({ seaState: 4 });
    if (!estimate) throw new Error("sea state 4 should give an estimate");
    const bounds = occludedFractionBounds(look(11_000), estimate);

    const ends = [estimate.calm, estimate.rough].flatMap((seaway) => {
      const { rigidFraction, ridingFraction } = occludedFraction(look(11_000), seaway);
      return [rigidFraction, ridingFraction];
    });
    expect(bounds.lowestFraction).toBeCloseTo(Math.min(...ends), 12);
    expect(bounds.highestFraction).toBeCloseTo(Math.max(...ends), 12);
    expect(bounds.lowestFraction).toBeLessThanOrEqual(bounds.highestFraction);
  });

  /**
   * The finding the pair is for. At 11 km the class width straddles the question and the
   * source does not settle it; at 15 km every sea the class allows hides her almost all the
   * time, and that conclusion survives the whole width.
   */
  it("straddles the question at eleven kilometres and settles it at fifteen", () => {
    const estimate = seawayFrom({ seaState: 4 });
    if (!estimate) throw new Error("sea state 4 should give an estimate");

    const straddling = occludedFractionBounds(look(11_000), estimate);
    expect(straddling.highestFraction - straddling.lowestFraction).toBeGreaterThan(0.2);

    const settled = occludedFractionBounds(look(15_000), estimate);
    expect(settled.lowestFraction).toBeGreaterThan(0.9);
  });

  /**
   * Taking the ends of a class is a bracket only while more sea means more hiding. It is not
   * obvious that it does: a taller sea comes with a longer assumed period, whose longer waves
   * cross a sight line LESS often, so the two effects pull opposite ways. The spread wins
   * throughout - but if it ever stopped winning, the interior of a class could sit outside
   * the pair and `occludedFractionBounds` would be silently reporting the wrong thing.
   */
  it("rises with significant height throughout, which is what makes the ends a bracket", () => {
    for (const range of [6_000, 9_000, 11_000, 13_000]) {
      let previousRigid = -1;
      let previousRiding = -1;
      for (let hs = 0.25; hs <= 4.001; hs += 0.25) {
        const { rigidFraction, ridingFraction } = occludedFraction(look(range), seawayOf(hs));
        expect(rigidFraction).toBeGreaterThanOrEqual(previousRigid);
        expect(ridingFraction).toBeGreaterThanOrEqual(previousRiding);
        previousRigid = rigidFraction;
        previousRiding = ridingFraction;
      }
    }
  });

  /**
   * Sea state 9 runs from 14 m upward with nothing over it, so the pair is a floor and not
   * an interval. Reporting it as closed would invent the bound the class does not have.
   */
  it("says when the top is a floor, because state 9 has no upper end", () => {
    const open = seawayFrom({ seaState: 9 });
    const closed = seawayFrom({ seaState: 4 });
    if (!open || !closed) throw new Error("both sea states should give an estimate");

    expect(occludedFractionBounds(look(11_000), open).highestFractionIsFloor).toBe(true);
    expect(occludedFractionBounds(look(11_000), closed).highestFractionIsFloor).toBe(false);
  });

  it("carries the geometry through unchanged, since no sea went into it", () => {
    const estimate = seawayFrom({ seaState: 2 });
    if (!estimate) throw new Error("sea state 2 should give an estimate");
    expect(occludedFractionBounds(look(11_000), estimate).crestThresholdMetres).toBeCloseTo(
      crestOcclusionMetres(look(11_000)),
      12,
    );
  });
});
