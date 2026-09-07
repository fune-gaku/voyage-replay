import type { CircleGeometry, Mesh, Points } from "three";
import { describe, expect, it } from "vitest";

import { assumedHeights } from "../src/actors/vessel/heights.js";
import { lightsForVessel } from "../src/actors/vessel/lights.js";
import { buildNavigationLights } from "../src/render/navlights.js";
import { BIG_SHIP, COASTER } from "./fixtures.js";

const FREEBOARD = 5;

function lamps(vessel = COASTER, freeboard = FREEBOARD): Points[] {
  return buildNavigationLights(vessel, freeboard).group.children.filter(
    (child): child is Points => child.type === "Points",
  );
}

function lampPosition(
  index: number,
  vessel = COASTER,
  freeboard = FREEBOARD,
): { x: number; y: number; z: number } {
  const attribute = lamps(vessel, freeboard)[index]!.geometry.getAttribute("position");
  return { x: attribute.getX(0), y: attribute.getY(0), z: attribute.getZ(0) };
}

describe("buildNavigationLights", () => {
  it("draws one lamp and one sector for every light the rules require", () => {
    for (const vessel of [COASTER, BIG_SHIP]) {
      const expected = lightsForVessel(vessel).length;
      const built = buildNavigationLights(vessel, FREEBOARD);

      expect(lamps(vessel), `${vessel.loaMetres} m`).toHaveLength(expected);
      expect(built.sectors.children, `${vessel.loaMetres} m`).toHaveLength(expected);
    }
  });

  it("carries the extra masthead light of a vessel of 50 m and over", () => {
    expect(lamps(BIG_SHIP).length).toBe(lamps(COASTER).length + 1);
  });

  // Green to starboard, red to port. The lamps have to sit on the side they show over, or
  // a bridge view puts the red light on the wrong bow at close range.
  it("hangs the sidelights on their own sides of the hull", () => {
    const kinds = lightsForVessel(COASTER).map((l) => l.kind);
    const starboard = lampPosition(kinds.indexOf("sidelight-starboard"));
    const port = lampPosition(kinds.indexOf("sidelight-port"));

    // Only 5 places: the positions are stored in a Float32 buffer attribute.
    expect(starboard.x).toBeCloseTo(COASTER.beamMetres / 2, 5);
    expect(port.x).toBeCloseTo(-COASTER.beamMetres / 2, 5);
  });

  it("keeps every lamp above the waterline", () => {
    for (let i = 0; i < lamps().length; i += 1) {
      expect(lampPosition(i).y).toBeGreaterThan(FREEBOARD);
    }
  });

  /**
   * The one subtlety in this file. A relative bearing runs clockwise from the bow at -Z,
   * while CircleGeometry measures thetaStart anticlockwise from +X, so a bearing b becomes
   * the circle angle (90 - b) and a clockwise arc runs from (90 - end) through (90 -
   * start). Getting it wrong draws every wedge mirrored, which looks entirely plausible.
   */
  it("converts each arc from relative bearing into the circle's own angles", () => {
    const built = buildNavigationLights(COASTER, FREEBOARD);
    const lights = lightsForVessel(COASTER);

    lights.forEach((light, index) => {
      const sector = built.sectors.children[index] as Mesh;
      const { thetaStart, thetaLength } = (sector.geometry as CircleGeometry).parameters;
      const sweep = (light.arc.endDegrees - light.arc.startDegrees + 360) % 360 || 360;

      expect((thetaLength * 180) / Math.PI, light.kind).toBeCloseTo(sweep, 6);
      expect((thetaStart * 180) / Math.PI, light.kind).toBeCloseTo(90 - light.arc.endDegrees, 6);
    });
  });

  // Sized to be legible beside the hull, not to equal the Rule 22 range: six miles of
  // translucent wedge would fill the plan view and show nothing.
  it("sizes the sectors against the hull rather than against the nominal range", () => {
    const built = buildNavigationLights(COASTER, FREEBOARD);
    const sector = built.sectors.children[0] as Mesh;
    const { radius } = (sector.geometry as CircleGeometry).parameters;

    expect(radius).toBeGreaterThan(COASTER.loaMetres);
    expect(radius).toBeLessThan(1852 * 6);
  });
});

describe("where the lamps sit against the hull they are on", () => {
  /**
   * `ui/panels.ts` tells a reader that a ship's lights stand higher than the top of her
   * superstructure, and that the occlusion table therefore does not answer for them. That
   * sentence is true because of two fractions of the beam living in two different files -
   * `actors/vessel/heights.ts` and this one - with nothing between them. Changing either
   * makes the page state something the geometry no longer supports, silently.
   */
  it("puts the masthead light above the top of the superstructure", () => {
    for (const vessel of [COASTER, BIG_SHIP]) {
      const heights = assumedHeights(vessel);
      const kinds = lightsForVessel(vessel).map((l) => l.kind);
      const masthead = lampPosition(kinds.indexOf("masthead"), vessel, heights.freeboardMetres);

      expect(masthead.y).toBeGreaterThan(heights.superstructureMetres);
    }
  });
});
