/**
 * Navigation lights, drawn.
 *
 * Two things are rendered for each light, and they answer different questions:
 *
 *   the lamp    - a small emissive point on the hull. This is what a watchkeeper sees,
 *                 and in the bridge view it is all there is.
 *   the sector  - a translucent wedge covering the arc the light shows over. Nobody at
 *                 sea sees this; it exists so that in the overhead view you can watch
 *                 which arc the other ship is sitting in, which is the thing a collision
 *                 enquiry turns on.
 *
 * So the sectors are on in the overhead view and off from a bridge. Leaving them on from
 * a bridge would be a picture of the rules rather than a picture of the night.
 *
 * Arc geometry comes from lightsForVessel, i.e. from COLREG Rule 21 - see
 * src/actors/vessel/lights.ts. Nothing about the angles is decided here.
 */

import {
  AdditiveBlending,
  BufferGeometry,
  CircleGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshBasicMaterial,
  Points,
  PointsMaterial,
  type ColorRepresentation,
} from "three";

import { lightsForVessel, type LightKind, type NavigationLight } from "../actors/vessel/lights.js";
import type { Vessel } from "../core/types.js";

const COLOURS: Record<string, ColorRepresentation> = {
  white: 0xfff6e0,
  green: 0x2ad04a,
  red: 0xf0323c,
  yellow: 0xf5d020,
};

export interface NavigationLightGroup {
  group: Group;
  /** The translucent arcs. Hidden from a bridge camera. */
  sectors: Group;
}

/** Where on the hull each lamp sits, as fractions of length and beam. */
function lampPosition(
  kind: LightKind,
  length: number,
  beam: number,
  freeboard: number,
): [number, number, number] {
  const forward = (fraction: number) => -fraction * length;
  switch (kind) {
    case "masthead":
      return [0, freeboard + beam * 1.15, forward(0.18)];
    case "masthead-after":
      return [0, freeboard + beam * 1.55, forward(-0.26)];
    case "sidelight-starboard":
      return [beam / 2, freeboard + beam * 0.5, forward(-0.28)];
    case "sidelight-port":
      return [-beam / 2, freeboard + beam * 0.5, forward(-0.28)];
    case "sternlight":
      return [0, freeboard + beam * 0.4, forward(-0.48)];
  }
}

/**
 * A wedge lying flat on the water, covering the light's arc.
 *
 * CircleGeometry measures thetaStart anticlockwise from +X, while a relative bearing runs
 * clockwise from the bow at -Z. Converting between the two is the whole subtlety here: a
 * relative bearing b maps to the circle angle (90 - b) degrees, and an arc that runs
 * clockwise from start to end therefore runs from (90 - end) through (90 - start).
 */
function sectorMesh(light: NavigationLight, radius: number): Mesh {
  const { startDegrees, endDegrees } = light.arc;
  const sweepDegrees = (endDegrees - startDegrees + 360) % 360 || 360;
  const thetaStart = ((90 - endDegrees) * Math.PI) / 180;
  const thetaLength = (sweepDegrees * Math.PI) / 180;

  const geometry = new CircleGeometry(radius, 64, thetaStart, thetaLength);
  geometry.rotateX(-Math.PI / 2);

  return new Mesh(
    geometry,
    new MeshBasicMaterial({
      color: COLOURS[light.colour] ?? 0xffffff,
      transparent: true,
      opacity: 0.16,
      side: DoubleSide,
      depthWrite: false,
      blending: AdditiveBlending,
    }),
  );
}

export function buildNavigationLights(vessel: Vessel, freeboard: number): NavigationLightGroup {
  const group = new Group();
  const sectors = new Group();

  // The sectors are a diagram, not a light-propagation model, so their radius is chosen
  // to be legible next to the hull rather than to equal the Rule 22 range - six miles of
  // translucent wedge would fill the overhead view and show nothing.
  const sectorRadius = Math.max(vessel.loaMetres * 4, 400);

  for (const light of lightsForVessel(vessel)) {
    group.add(lampPoints(light, vessel, freeboard));

    const sector = sectorMesh(light, sectorRadius);
    sector.position.set(0, 0.6, 0);
    sectors.add(sector);
  }

  group.add(sectors);
  return { group, sectors };
}

/**
 * One lamp, drawn at a fixed size in PIXELS rather than in metres.
 *
 * This is both the realistic choice and the one that works. A navigation light seen from
 * another ship is a point of light whose apparent size barely changes with range - you
 * judge distance from its brightness and from the other lights around it, never from how
 * big it looks. And a lamp modelled at true scale is sub-pixel at any range worth
 * reconstructing: a 1 m lamp two miles off does not survive rasterisation, so the one
 * thing the whole tool is about would render as nothing.
 */
function lampPoints(light: NavigationLight, vessel: Vessel, freeboard: number): Points {
  const [x, y, z] = lampPosition(light.kind, vessel.loaMetres, vessel.beamMetres, freeboard);
  return new Points(
    new BufferGeometry().setAttribute("position", new Float32BufferAttribute([x, y, z], 3)),
    new PointsMaterial({
      color: COLOURS[light.colour] ?? 0xffffff,
      size: 7,
      sizeAttenuation: false,
      transparent: true,
      depthWrite: false,
    }),
  );
}
