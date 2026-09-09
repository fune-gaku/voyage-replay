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
  Vector3,
  type ColorRepresentation,
} from "three";

import {
  isWithinArc,
  lightsForVessel,
  type LightKind,
  type NavigationLight,
} from "../actors/vessel/lights.js";
import { hullDimensions } from "../actors/vessel/hull-shape.js";
import type { Vessel } from "../core/types.js";

const COLOURS: Record<string, ColorRepresentation> = {
  white: 0xfff6e0,
  green: 0x2ad04a,
  red: 0xf0323c,
  yellow: 0xf5d020,
};

/**
 * Who the lamps are being drawn for. Three answers, and they are genuinely different -
 * folding "nobody is watching" and "everybody is" into one absent value is how a ship ends
 * up showing both her sidelights to her own wheelhouse.
 */
export type LampAudience =
  /** The plan view, where the sectors annotate the lamps and blanking one strands the other. */
  | { kind: "diagram" }
  /** Her own bridge. A watchkeeper does not see the lights her ship is showing to others. */
  | { kind: "self" }
  /** Another ship's bridge, on this bearing from THIS ship's bow. */
  | { kind: "observer"; relativeBearingDegrees: number };

export interface NavigationLightGroup {
  group: Group;
  /** The translucent arcs. Hidden from a bridge camera. */
  sectors: Group;
  /** Light the lamps this audience can actually see. */
  showFor(audience: LampAudience): void;
  /**
   * Every lamp she carries, wherever it has ended up in the world, and what Rule 21 and 22
   * say about it.
   *
   * **All of them, and not only the ones drawn.** What decides whether a lamp lays a streak
   * is where the water is, measured from her bow - not where the observer is. Her own
   * sidelights colour the water alongside her even though a watchkeeper on her bridge never
   * sees the lamps themselves, which is why `showFor` is the wrong question to ask here.
   */
  lit(): { light: NavigationLight; at: Vector3 }[];
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
  const lamps: { light: NavigationLight; points: Points }[] = [];

  // The sectors are a diagram, not a light-propagation model, so their radius is chosen
  // to be legible next to the hull rather than to equal the Rule 22 range - six miles of
  // translucent wedge would fill the overhead view and show nothing.
  const sectorRadius = Math.max(vessel.loaMetres * 4, 400);

  for (const light of lightsForVessel(vessel)) {
    const points = lampPoints(light, vessel, freeboard);
    group.add(points);
    lamps.push({ light, points });

    const sector = sectorMesh(light, sectorRadius);
    sector.position.set(0, 0.6, 0);
    sectors.add(sector);
  }

  group.add(sectors);
  return {
    group,
    sectors,
    showFor: (audience) => {
      showFor(lamps, audience);
    },
    // Asked of the object rather than recomputed from the hull's dimensions: the lamps hang
    // off groups the player moves and rotates, and a second answer would drift from the first
    // by whatever the antenna offset is.
    lit: () =>
      lamps.map(({ light, points }) => ({ light, at: points.getWorldPosition(new Vector3()) })),
  };
}

/**
 * A lamp is only where it is: the arc it shows over is a screen, and from outside that arc
 * there is nothing to see.
 *
 * Drawing every lamp is what a three.js `Points` does by default, and it looks right until
 * you count the colours. A ship shows one sidelight or the other and never both, because
 * Rule 21 gives them 112.5 degrees each on opposite sides with no overlap - so a picture
 * with a red and a green together says the observer is in two places at once. That is the
 * kind of error this project exists to not make, and the panels already avoid it: they ask
 * `visibleLights` (`ui/panels.ts`) while the renderer used to ask nothing.
 *
 * For an observer the arcs tile the horizon, so something is always lit and this can never
 * blank a ship by accident. Her own bridge is the one case that draws nothing, on purpose.
 */
function showFor(
  lamps: { light: NavigationLight; points: Points }[],
  audience: LampAudience,
): void {
  for (const lamp of lamps) {
    lamp.points.visible =
      audience.kind === "diagram" ||
      (audience.kind === "observer" &&
        isWithinArc(audience.relativeBearingDegrees, lamp.light.arc));
  }
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
  // The hull that is drawn, not the particulars: a sidelight is at the ship's side, and the
  // two sources differ by 0.4 m of beam on the reference case's tanker - enough to hang her
  // sidelights over the water beside her.
  const hull = hullDimensions(vessel);
  const [x, y, z] = lampPosition(light.kind, hull.lengthMetres, hull.beamMetres, freeboard);
  return new Points(
    new BufferGeometry().setAttribute("position", new Float32BufferAttribute([x, y, z], 3)),
    new PointsMaterial({
      color: COLOURS[light.colour] ?? 0xffffff,
      size: 7,
      sizeAttenuation: false,
      transparent: true,
      depthWrite: false,
      // **The one thing in the world picture that is not on the photometric scale, and it
      // has to be said out loud.** The light this lamp puts ON THE WATER is in candela and
      // lux and goes through the tone curve with everything else; the lamp's own point does
      // not. Left tone-mapped, the night exposure of 200 renders red, green, white and
      // yellow at (255,251,251), (249,255,250), (255,255,254) and (255,254,251) - four
      // lamps that a reader cannot tell apart, when the colour IS the identity - and the
      // day exposure of 9.1e-5 renders all four black. Both measured. A 7-pixel sprite's
      // radiance is a property of the sprite rather than of the lamp anyway: at any
      // exposure that shows a moonlit sea, a lamp inside its nominal range saturates. So
      // the point is a declared screen colour and the water it lights is calculated. See
      // `plans/photometric-scale-60.md` and issue #78.
      toneMapped: false,
    }),
  );
}
