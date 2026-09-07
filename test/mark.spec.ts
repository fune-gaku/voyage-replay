import { Mesh, type MeshStandardMaterial } from "three";
import { describe, expect, it } from "vitest";

import type { Mark } from "../src/core/types.js";
import { buildMark } from "../src/render/mark.js";

function mark(overrides: Partial<Mark> = {}): Mark {
  return { id: "no-1", kind: "buoy", at: { lat: 33, lon: 140 }, ...overrides };
}

function meshes(group: { children: unknown[] }): Mesh[] {
  return group.children.filter((child): child is Mesh => child instanceof Mesh);
}

function bodyOf(mark: Mark): Mesh {
  const body = meshes(buildMark(mark).group)[0];
  if (!body) throw new Error("a buoy should have a body");
  return body;
}

function paintOf(mesh: Mesh): MeshStandardMaterial {
  if (Array.isArray(mesh.material)) throw new Error("a buoy is painted one colour");
  return mesh.material as MeshStandardMaterial;
}

describe("a buoy", () => {
  it("takes its colour from the mark, and a lateral green is not a red", () => {
    const green = paintOf(bodyOf(mark({ colour: "green" }))).color;
    const red = paintOf(bodyOf(mark({ colour: "red" }))).color;
    expect(green.getHex()).not.toBe(red.getHex());

    // Green really is green, and red red: the enum is a colour and not a label.
    expect(green.g).toBeGreaterThan(green.r);
    expect(green.g).toBeGreaterThan(green.b);
    expect(red.r).toBeGreaterThan(red.g);
  });

  /**
   * Some of the float has to be under the waterline. A body sitting exactly on the surface
   * shows daylight beneath it whenever it rides into a trough, which reads as a buoy
   * hovering - and the point of drawing one is that it reads as floating.
   */
  it("straddles the waterline rather than resting on it", () => {
    const body = bodyOf(mark({ heightMetres: 3 }));
    body.geometry.computeBoundingBox();
    const box = body.geometry.boundingBox;
    if (!box) throw new Error("the body should have a bounding box");
    const top = body.position.y + box.max.y;
    const bottom = body.position.y + box.min.y;

    expect(top).toBeCloseTo(3, 6);
    expect(bottom).toBeLessThan(0);
  });

  it("reports the height it was given, and assumes one where the source states none", () => {
    expect(buildMark(mark({ heightMetres: 4.5 })).heightMetres).toBe(4.5);
    expect(buildMark(mark()).heightMetres).toBeGreaterThan(0);
  });

  /**
   * A shape is a statement - a can is port hand, a cone starboard - so the drawn buoys have
   * to differ. What they must not do is differ only in ways nobody can see.
   */
  it("draws the shapes differently from one another", () => {
    const widthOf = (shape: NonNullable<Mark["shape"]>): number => {
      const body = bodyOf(mark({ shape, heightMetres: 3 }));
      body.geometry.computeBoundingBox();
      return body.geometry.boundingBox?.max.x ?? 0;
    };
    expect(widthOf("spar")).toBeLessThan(widthOf("pillar"));
    expect(widthOf("pillar")).toBeLessThan(widthOf("can"));
  });

  it("puts a staff on the shapes that carry one, and not on the others", () => {
    expect(meshes(buildMark(mark({ shape: "pillar" })).group)).toHaveLength(2);
    expect(meshes(buildMark(mark({ shape: "spar" })).group)).toHaveLength(2);
    expect(meshes(buildMark(mark({ shape: "can" })).group)).toHaveLength(1);
    expect(meshes(buildMark(mark({ shape: "spherical" })).group)).toHaveLength(1);
  });

  it("names the group after the mark, so one can be found among many", () => {
    expect(buildMark(mark({ id: "fairway" })).group.name).toBe("mark:fairway");
  });
});

describe("a buoy's outline is the shape the page names", () => {
  /**
   * The silhouette at the top, at the bottom, and at its widest, as fractions of the widest.
   * Read off the vertices rather than off the geometry's class, because what has to be right
   * is that a sphere READS as a sphere - a can as a drum, a cone as a cone - not which
   * three.js constructor happened to make it.
   *
   * Only the ends and the maximum, because a plain cylinder has no vertices in between: it
   * is two rings and two caps, and a test that sampled its middle would find nothing there.
   */
  function silhouette(shape: NonNullable<Mark["shape"]>): {
    top: number;
    bottom: number;
  } {
    const body = bodyOf(mark({ shape, heightMetres: 3 }));
    const position = body.geometry.getAttribute("position");
    body.geometry.computeBoundingBox();
    const box = body.geometry.boundingBox;
    if (!box) throw new Error("the body should have a bounding box");

    const span = box.max.y - box.min.y;
    let top = 0;
    let bottom = 0;
    let widest = 0;
    for (let i = 0; i < position.count; i += 1) {
      const height = (position.getY(i) - box.min.y) / span;
      const radius = Math.hypot(position.getX(i), position.getZ(i));
      widest = Math.max(widest, radius);
      if (height > 0.9) top = Math.max(top, radius);
      if (height < 0.1) bottom = Math.max(bottom, radius);
    }
    return { top: top / widest, bottom: bottom / widest };
  }

  /** A can is a drum: as wide at the top as at the bottom, which is what makes it a can. */
  it("draws a can as a drum", () => {
    const { top, bottom } = silhouette("can");
    expect(top).toBeGreaterThan(0.9);
    expect(bottom).toBeGreaterThan(0.9);
  });

  /** A cone narrows all the way up. It is the starboard-hand mark and must not read flat. */
  it("draws a cone narrowing towards the top", () => {
    const { top, bottom } = silhouette("conical");
    expect(top).toBeLessThan(0.3);
    expect(bottom).toBeGreaterThan(0.9);
  });

  /**
   * A sphere closes at BOTH ends, which is the whole difference from a drum. Drawn as one it
   * read as a can - a safe-water mark shown as a port-hand one, with the panel naming it
   * correctly underneath.
   */
  it("draws a sphere closing at both ends, not as a drum of another width", () => {
    const { top, bottom } = silhouette("spherical");
    expect(top).toBeLessThan(0.6);
    expect(bottom).toBeLessThan(0.6);
  });

  it("keeps the three outlines distinguishable from one another", () => {
    const can = silhouette("can");
    const cone = silhouette("conical");
    const sphere = silhouette("spherical");
    expect(can.top).toBeGreaterThan(sphere.top);
    expect(sphere.bottom).toBeLessThan(cone.bottom);
    expect(cone.top).toBeLessThan(sphere.top);
  });

  it("still straddles the waterline whatever the shape", () => {
    for (const shape of ["pillar", "spar", "can", "conical", "spherical"] as const) {
      const body = bodyOf(mark({ shape, heightMetres: 3 }));
      body.geometry.computeBoundingBox();
      const box = body.geometry.boundingBox;
      if (!box) throw new Error("the body should have a bounding box");
      expect(body.position.y + box.max.y).toBeCloseTo(3, 5);
      expect(body.position.y + box.min.y).toBeLessThan(0);
    }
  });
});
