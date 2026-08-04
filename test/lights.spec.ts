import { describe, expect, it } from "vitest";

import { describeAspect, lightsForVessel, visibleLights } from "../src/actors/vessel/lights.js";
import type { Vessel } from "../src/core/types.js";

const coaster: Vessel = { loaMetres: 49, beamMetres: 9.4, type: "tanker" };
const bigShip: Vessel = { loaMetres: 180, beamMetres: 28, type: "cargo" };

function kinds(vessel: Vessel, relativeBearing: number): string[] {
  return visibleLights(vessel, relativeBearing)
    .map((l) => l.kind)
    .sort();
}

describe("COLREG Rule 21 arcs", () => {
  it("shows both sidelights and the masthead light end-on", () => {
    expect(kinds(coaster, 0)).toEqual(["masthead", "sidelight-starboard"]);
    // Just to port of right ahead, the port sidelight replaces the starboard one.
    expect(kinds(coaster, 359.9)).toEqual(["masthead", "sidelight-port"]);
  });

  it("shows the green sidelight on the starboard bow and quarter up to 22.5 abaft the beam", () => {
    expect(kinds(coaster, 45)).toEqual(["masthead", "sidelight-starboard"]);
    expect(kinds(coaster, 112.4)).toEqual(["masthead", "sidelight-starboard"]);
  });

  it("hands over to the sternlight exactly at 22.5 degrees abaft the beam", () => {
    expect(kinds(coaster, 112.5)).toEqual(["sternlight"]);
    expect(kinds(coaster, 247.4)).toEqual(["sternlight"]);
  });

  it("shows the red sidelight on the port side", () => {
    expect(kinds(coaster, 247.5)).toEqual(["masthead", "sidelight-port"]);
    expect(kinds(coaster, 315)).toEqual(["masthead", "sidelight-port"]);
  });

  // 225 + 135 = 360: the arcs tile the horizon, so no bearing is dark and none is
  // counted twice. A gap here would be a light that vanishes as a ship swings past it.
  it("leaves no bearing without a light and none double-counted", () => {
    for (let bearing = 0; bearing < 360; bearing += 0.1) {
      const seen = visibleLights(coaster, bearing);
      expect(seen.length, `bearing ${bearing.toFixed(1)}`).toBeGreaterThan(0);
      const sidelights = seen.filter((l) => l.kind.startsWith("sidelight"));
      expect(sidelights.length, `bearing ${bearing.toFixed(1)}`).toBeLessThanOrEqual(1);
    }
  });

  it("accepts bearings outside [0, 360)", () => {
    expect(kinds(coaster, -45)).toEqual(kinds(coaster, 315));
    expect(kinds(coaster, 405)).toEqual(kinds(coaster, 45));
  });
});

describe("Rule 22 and Rule 23", () => {
  it("gives a vessel of 50 m and over a second masthead light", () => {
    expect(lightsForVessel(bigShip).map((l) => l.kind)).toContain("masthead-after");
    expect(lightsForVessel(coaster).map((l) => l.kind)).not.toContain("masthead-after");
  });

  it("scales nominal range with length", () => {
    const big = lightsForVessel(bigShip).find((l) => l.kind === "masthead");
    const small = lightsForVessel(coaster).find((l) => l.kind === "masthead");
    expect(big?.nominalRangeNauticalMiles).toBe(6);
    expect(small?.nominalRangeNauticalMiles).toBe(5);
  });
});

describe("describeAspect", () => {
  it("names what the lights mean", () => {
    expect(describeAspect(visibleLights(coaster, 45))).toBe("starboard side visible");
    expect(describeAspect(visibleLights(coaster, 315))).toBe("port side visible");
    expect(describeAspect(visibleLights(coaster, 180))).toBe("stern-on, overtaking");
  });
});
