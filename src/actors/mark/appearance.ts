/**
 * What a mark actually looks like on screen, and where each part of that came from.
 *
 * **One function, so the page and the picture cannot disagree.** `render/mark.ts` draws from
 * this and `ui/panels.ts` prints from it: the fault this project keeps returning to is a page
 * naming a shape the view is not drawing, and the fix each time has been to make both ask the
 * same question in the same place (`plans/done/antenna-offset-6.md`).
 *
 * Three origins, and they must not collapse into two:
 *
 * - **stated** - the file said so, and that wins over everything.
 * - **from its purpose** - generated from what the mark is FOR, out of IALA R1001. A north
 *   cardinal is black above yellow because it is a north cardinal, not because anybody wrote
 *   the colours down.
 * - **chosen here** - neither was available and something had to be drawn. A pillar of 2.4 m
 *   in yellow says nothing about the world; it is this tool filling a hole, and the page says
 *   so beside the mark.
 */

import { appearanceOf, type Appearance, type BuoyageRegion, type Topmark } from "./buoyage.js";
import type {
  Mark,
  MarkColour,
  MarkConstruction,
  MarkPattern,
  MarkShape,
} from "../../core/types.js";

/**
 * Four, not three - because the buoyage sometimes narrows a thing without fixing it.
 *
 * A north cardinal's colours are black over yellow and nothing else; its body may be a pillar
 * OR a spar, and R1001 does not choose. Reporting the pillar as "from its purpose" would put
 * this tool's pick behind the buoyage's authority, which is the same overclaim as calling an
 * invented colour a stated one - one step further in.
 */
export type Origin =
  "stated" | "from its purpose" | "chosen from what its purpose allows" | "chosen here";

export interface From<T> {
  value: T;
  from: Origin;
}

export interface DrawnMark {
  pattern: From<MarkPattern>;
  /** The IALA body shape, for a buoy. Null for a beacon, which has none (#40). */
  shape: From<MarkShape> | null;
  /**
   * The shape on top - and **absence has an origin too**.
   *
   * Three answers, not two. A `From` carrying a shape is one that is drawn; a `From` carrying
   * null is a file saying the mark had none, which R1001 allows for in so many words; a bare
   * null is nothing known either way. The middle one is a fact about the mark, and printing it
   * the same as the last would lose the only thing the source said.
   */
  topmark: From<{ shape: Topmark; colour: MarkColour } | null> | null;
  /** How a beacon is built, which means nothing. Null for a buoy, which has a shape instead. */
  construction: From<MarkConstruction> | null;
}

/**
 * Where a report says nothing at all. A pillar is the commonest shape in open water and
 * yellow is the colour that claims least - it is the special mark's own colour, which means
 * "something here that is none of the other categories".
 */
export const CHOSEN: { shape: MarkShape; pattern: MarkPattern; construction: MarkConstruction } = {
  shape: "pillar",
  pattern: { kind: "solid", colours: ["yellow"] },
  construction: "column",
};

export function drawnAppearance(mark: Mark, region: BuoyageRegion | null): DrawnMark {
  const meant = mark.purpose === undefined ? null : appearanceOf(mark.purpose, region);
  const pattern = pick(mark.pattern, meant?.pattern, CHOSEN.pattern);
  return {
    pattern: { ...pattern, value: onlyWhatItSays(pattern.value) },
    shape: mark.kind === "beacon" ? null : shapeOf(mark, meant),
    topmark: topmarkOf(mark, meant),
    construction:
      mark.kind === "beacon" ? pick(mark.construction, undefined, CHOSEN.construction) : null,
  };
}

/**
 * The shape on top, where there is one.
 *
 * **The purpose says what a topmark would BE, not whether there was one.** R1001 heads that
 * column "Topmark (if any)" in every table, and notes that an authority may leave them off
 * where weather or ice make them impractical - so a file that says nothing has not said there
 * was one. Drawn anyway, because it is the daylight statement a viewer reads a cardinal mark
 * off, and reported as this tool's decision to draw it: what it looks like comes from the
 * buoyage, that it is there at all does not.
 */
function topmarkOf(
  mark: Mark,
  meant: Appearance | null,
): From<{ shape: Topmark; colour: MarkColour } | null> | null {
  // A stated absence is a statement, and it survives having nothing to draw.
  if (mark.topmark === false) return { value: null, from: "stated" };
  if (!meant?.topmark) return null;
  return {
    value: meant.topmark,
    from: mark.topmark === true ? "from its purpose" : "chosen from what its purpose allows",
  };
}

/**
 * The IALA body shape, which the buoyage narrows without always fixing.
 *
 * A cardinal mark may be a pillar or a spar; a safe-water mark may be a sphere, a pillar or a
 * spar; a port-hand mark a can, a pillar or a spar. Where more than one is allowed, the first
 * is this tool's pick out of a list the buoyage supplied - which is neither "from its purpose"
 * nor "chosen here", and is reported as the third thing it is.
 */
function shapeOf(mark: Mark, meant: Appearance | null): From<MarkShape> {
  if (mark.shape !== undefined) return { value: mark.shape, from: "stated" };
  const allowed = meant?.shapes ?? [];
  const first = allowed[0];
  if (first === undefined) return { value: CHOSEN.shape, from: "chosen here" };
  return {
    value: first,
    from: allowed.length > 1 ? "chosen from what its purpose allows" : "from its purpose",
  };
}

/**
 * A solid pattern is one colour, whatever it was handed.
 *
 * The schema says the same thing, and this says it again because a scenario reaches here by
 * roads other than `validateScenario`. Left alone, `{ solid, [red, green] }` is drawn as two
 * bands by the renderer and printed as "red" by the page - the same field read two ways,
 * which is the fault this whole module exists to close.
 */
function onlyWhatItSays(pattern: MarkPattern): MarkPattern {
  if (pattern.kind !== "solid" || pattern.colours.length <= 1) return pattern;
  return { kind: "solid", colours: pattern.colours.slice(0, 1) };
}

/**
 * The file, then the buoyage, then this tool - in that order, always.
 *
 * The order is the whole point. Letting a purpose override a stated colour would throw away
 * the one thing the source actually said; letting this tool's fallback win would hide the
 * buoyage behind a default. And the origin travels with the value, because on screen a
 * generated black-and-yellow and a reported one look exactly alike.
 */
function pick<T>(stated: T | undefined, meant: T | undefined, chosen: T): From<T> {
  if (stated !== undefined) return { value: stated, from: "stated" };
  if (meant !== undefined) return { value: meant, from: "from its purpose" };
  return { value: chosen, from: "chosen here" };
}
