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
