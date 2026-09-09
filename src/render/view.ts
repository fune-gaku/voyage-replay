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
 * reason the two above had to stop being a boolean.
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
    };

/** Which of the two pictures a viewpoint draws. */
export function pictureOf(view: ViewSelection): Picture {
  return view.kind === "chart" ? "chart" : "world";
}
