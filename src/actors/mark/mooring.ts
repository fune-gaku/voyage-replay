/**
 * What a moored buoy swings on, and how far that lets her wander.
 *
 * **A buoy is not at her charted position.** The position a report gives is her sinker's;
 * she lies somewhere on a circle about it whose radius is `sqrt(scope^2 - depth^2)`, and in
 * a stream on its downstream edge. At twenty metres of depth on three times scope that is
 * 57 m - against ships of 49 m and 121 m in this project's reference case, a ship's length
 * of slack.
 *
 * That matters because "which side of the mark did she pass" is regularly the question a
 * report is answering, and the answer can sit inside the circle.
 *
 * **The renderer still draws her at the stated position.** Where in the circle she was is
 * not known, so moving her would invent a placement - the same judgement
 * `plans/done/antenna-offset-6.md` reached about a hull and its antenna. The panel gives
 * the radius instead.
 *
 * In `actors/mark/` beside `actors/vessel/`, because a mooring is a mark's own concern and
 * `core/` is not to carry the concepts of any one kind of thing in the scene.
 */

import type { Mark } from "../../core/types.js";

/**
 * How far a buoy can lie from the position given for her, or null where the file does not
 * say enough to work it out.
 *
 * Null rather than a guess: chain scope is not something a report usually states, and
 * inventing a ratio would put a figure in a reader's hands that nobody wrote down. A beacon
 * is null too, and for a better reason - it has no circle at all.
 */
export function watchCircleMetres(mark: Mark): number | null {
  if (mark.kind !== "buoy") return null;
  const { depthMetres, chainScope } = mark.mooring ?? {};
  if (depthMetres === undefined || chainScope === undefined) return null;
  if (depthMetres <= 0 || chainScope < 1) return null;

  const scope = depthMetres * chainScope;
  // Pythagoras on the chain: the taut length is the hypotenuse, the depth one leg. Scope 1
  // is straight up and down, which gives nought rather than a complex number.
  return Math.sqrt(Math.max(scope * scope - depthMetres * depthMetres, 0));
}

/** Whether this mark floats at all, which decides almost everything else about it. */
export function floats(mark: Mark): boolean {
  return mark.kind === "buoy";
}
