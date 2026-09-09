/**
 * What kind of picture is being drawn, and where it is taken from.
 *
 * **Two questions that used to be one.** `render/player.ts` derived everything about the picture
 * from which camera was selected - `view.kind === "overhead"` - and eight things read that one
 * boolean: whether the earth curves under the hulls, whether the plan view's furniture is up,
 * the lighting and the map tint and the sky, whether marks flash their rhythm, who the
 * navigation lights are drawn for, whether the lamps lay streaks, which credit is printed, and
 * whether there is an eye at all.
 *
 * All eight are right for the two views that existed and none is answerable for a third, so a
 * free viewpoint could not be expressed until they were separated. Issue #63.
 *
 * They live here rather than in `player.ts` because `render/scene.ts` is one of the eight and
 * must not import the player to be told what it is drawing.
 */

import type { LocalPosition } from "../core/geodesy.js";

/**
 * **What kind of picture this is**, which is not the same question as which camera is up.
 *
 * A chart is a drawing: flat earth, lit for reading, the pale basemap under it, nothing
 * flashing, and the lamps annotated by their sectors rather than seen from anywhere. The world
 * is a place: the earth bends away, the sky is the sky, marks keep their rhythm, and a lamp
 * lays a streak on the water.
 *
 * Eight things used to read `view.kind === "overhead"` for this - so a viewpoint that was
 * neither of the two that existed had no answer to any of them. See issue #63.
 */
export type Picture = "chart" | "world";

/**
 * Where the picture is taken from, which decides the picture's kind but is not it.
 *
 * A chart has no eye at all - a drawing is not a place. A bridge puts one at a named ship's
 * wheelhouse. A free viewpoint puts one wherever it is told, aboard nobody, and it is the
 * reason the two above had to stop being a boolean. An orbit names a place and stands off it
 * at a bearing, an elevation and a range, which is what a reader actually asks for.
 *
 * **Only the bridge is relative, and that is the point.** A bridge names a ship and lets the
 * player work out where her wheelhouse has got to, because a watchkeeper's eye goes where the
 * ship goes. Everything else is stated outright: an orbit was relative to the action once and
 * followed the ships about while somebody was trying to read it (#67), which is the opposite
 * of what a chosen viewpoint is for. Issues #65 and #67.
 */
export type ViewSelection =
  | { kind: "chart" }
  | { kind: "bridge"; actorId?: string }
  | {
      kind: "free";
      at: LocalPosition;
      headingDegreesTrue: number;
      heightMetres: number;
      /** Degrees below the horizontal. Zero looks level, as a bridge does. */
      depressionDegrees?: number;
    }
  | {
      kind: "orbit";
      /**
       * The place being watched, and it does not move.
       *
       * **It was relative to the action, and that was wrong.** The centre the chart frames on
       * follows the ships, so an eye stated against it followed them too - and a viewpoint
       * that drifts while a reader is reading it changes the geometry under them without
       * their touching anything. An investigator picks a place - a headland, a buoy the
       * report keeps naming, where the tracks cross - and stays there while the ships come
       * past. Issue #67.
       *
       * There is still ONE answer to where the action is, in `render/player.ts`; whatever
       * opens this view asks for it once and holds what it was told.
       */
      centre: LocalPosition;
      /**
       * True bearing FROM what is being watched TO the eye - so the camera stands on this
       * bearing and looks back down it. Turning it walks the eye round the horizon.
       */
      azimuthDegrees: number;
      /**
       * How high the eye stands, as an angle above the horizontal seen from the action.
       * Ninety is the zenith and zero is on the surface; `ORBIT_ELEVATION` says why neither
       * end is reachable.
       */
      elevationDegrees: number;
      /** From the eye to what it is watching. Not a scale: a perspective picture has none. */
      distanceMetres: number;
    };

/**
 * How far the elevation may be pushed, and why not to the ends.
 *
 * **Ninety degrees is where the camera's own orientation stops being defined.** Looking
 * straight down, the yaw and the roll are the same rotation, so which way is north on screen
 * depends on the order the angles are applied rather than on anything asked for. A tenth of a
 * degree short of it is indistinguishable from overhead - at a kilometre the eye is 1.7 m off
 * the vertical - and is a viewpoint rather than a special case.
 *
 * **Zero is in the water.** The eye stands `distance * sin(elevation)` above the surface, and
 * the sea is a disc centred on the eye (`render/water.ts`): at zero the disc and the line of
 * sight are the same plane, so there is no horizon and nothing between here and it. Half a
 * degree at a kilometre is an eye 8.7 m up - a small ship's bridge - and the floor below keeps
 * it out of the sea when the range closes.
 */
export const ORBIT_ELEVATION = { minimumDegrees: 0.5, maximumDegrees: 89.9 };

/** Never nearer the surface than this, however close in the orbit is pulled. */
export const ORBIT_FLOOR_METRES = 2;

/** Which of the two pictures a viewpoint draws. */
export function pictureOf(view: ViewSelection): Picture {
  return view.kind === "chart" ? "chart" : "world";
}

/** Where an orbit puts the eye, and which way it then looks. */
export interface OrbitEye {
  at: LocalPosition;
  headingDegreesTrue: number;
  heightMetres: number;
  depressionDegrees: number;
}

/**
 * Resolve an orbit into an eye.
 *
 * **The limits are applied here as well as wherever the control keeps its own state**, and
 * both come from the constants above. A control has to hold a clamped value or dragging past
 * an end and back leaves it dead for a while; a function that is exported has callers that
 * never went through a control. Same rule twice from one statement of it, and `test/view.spec`
 * ties the two together - the pattern `core/seaway.ts` uses for the schema's own bounds.
 *
 * **The camera is aimed from where the eye ENDED UP.** Push the range in far enough and the
 * floor lifts the eye above the angle asked for; keeping the asked-for depression would then
 * point it under the thing it is orbiting, which is the one job an orbit has.
 */
export function orbitEye(view: Extract<ViewSelection, { kind: "orbit" }>): OrbitEye {
  const centre = view.centre;
  const elevation = clampElevation(view.elevationDegrees);
  const azimuth = ((view.azimuthDegrees % 360) + 360) % 360;
  const bearing = (azimuth * Math.PI) / 180;

  const range = Math.max(view.distanceMetres, 0) * Math.cos((elevation * Math.PI) / 180);
  const height = Math.max(
    Math.max(view.distanceMetres, 0) * Math.sin((elevation * Math.PI) / 180),
    ORBIT_FLOOR_METRES,
  );

  return {
    at: {
      east: centre.east + range * Math.sin(bearing),
      north: centre.north + range * Math.cos(bearing),
    },
    // Standing on that bearing FROM the centre means looking back down the reciprocal.
    headingDegreesTrue: (azimuth + 180) % 360,
    heightMetres: height,
    depressionDegrees: (Math.atan2(height, range) * 180) / Math.PI,
  };
}

/** The one statement of the limits, for the control and for the resolver alike. */
export function clampElevation(degrees: number): number {
  return Math.min(
    Math.max(degrees, ORBIT_ELEVATION.minimumDegrees),
    ORBIT_ELEVATION.maximumDegrees,
  );
}
