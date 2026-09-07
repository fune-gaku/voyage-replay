import { Mesh, type CylinderGeometry, type MeshStandardMaterial } from "three";
import { describe, expect, it } from "vitest";

import type {
  Mark,
  MarkColour,
  MarkConstruction,
  MarkPattern,
  MarkPurpose,
} from "../src/core/types.js";
import { buildMark } from "../src/render/mark.js";

function mark(overrides: Partial<Mark> = {}): Mark {
  return { id: "no-1", kind: "buoy", at: { lat: 33, lon: 140 }, ...overrides };
}

/** One colour all over, which in this system is the exception rather than the rule. */
function solid(colour: MarkColour): MarkPattern {
  return { kind: "solid", colours: [colour] };
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
    const green = paintOf(bodyOf(mark({ pattern: solid("green") }))).color;
    const red = paintOf(bodyOf(mark({ pattern: solid("red") }))).color;
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

/**
 * A beacon is not a kind of buoy. It is built on a foundation on the ground it marks, so it
 * passes THROUGH the waterline rather than straddling one it follows, and it carries no IALA
 * body shape at all - a shape is a statement in the buoyage, and a structure makes none.
 */
describe("a beacon", () => {
  const beacon = (overrides: Partial<Mark> = {}): Mark => ({
    id: "shoal",
    kind: "beacon",
    at: { lat: 33, lon: 140 },
    ...overrides,
  });

  function extent(mark: Mark): { top: number; bottom: number } {
    let top = -Infinity;
    let bottom = Infinity;
    for (const mesh of meshes(buildMark(mark).group)) {
      mesh.geometry.computeBoundingBox();
      const box = mesh.geometry.boundingBox;
      if (!box) throw new Error("every part should have a bounding box");
      top = Math.max(top, mesh.position.y + box.max.y);
      bottom = Math.min(bottom, mesh.position.y + box.min.y);
    }
    return { top, bottom };
  }

  /**
   * The stated height is above the WATER, and that is where the drawn structure has to reach.
   * The footing below the surface is this renderer standing it on something - no depth is
   * stated anywhere - so counting it into the height would sink the top by an amount nobody
   * measured, and the top is the part a sightline asks about.
   */
  it("stands from below the water up to the height it was given, above the water", () => {
    const { top, bottom } = extent(beacon({ heightMetres: 6 }));
    expect(top).toBeCloseTo(6, 5);
    expect(bottom).toBeLessThan(0);
  });

  /**
   * The same claim from the other side: the whole structure is TALLER than the height it was
   * given, and what is reported back is only the part above the water. A beacon that reported
   * its full extent would be handing a sightline a figure measured from a fiction.
   */
  it("keeps the invented footing out of the height it reports", () => {
    const built = buildMark(beacon({ heightMetres: 6 }));
    const { top, bottom } = extent(beacon({ heightMetres: 6 }));

    expect(built.heightMetres).toBe(6);
    expect(top - bottom).toBeGreaterThan(built.heightMetres);
  });

  it("reports the height it was given, and assumes one where the source states none", () => {
    expect(buildMark(beacon({ heightMetres: 9 })).heightMetres).toBe(9);
    expect(buildMark(beacon()).heightMetres).toBeGreaterThan(0);
  });

  /**
   * The two silhouettes have to be told apart at a glance, or a viewer reads a structure on
   * a shoal as a buoy that has stopped bobbing. A beacon is slender for its height, where
   * every buoy body here is at least a fifth of its own height across.
   */
  it("does not read as a buoy of the same height", () => {
    const widthOf = (mark: Mark): number => {
      let widest = 0;
      for (const mesh of meshes(buildMark(mark).group)) {
        mesh.geometry.computeBoundingBox();
        widest = Math.max(widest, mesh.geometry.boundingBox?.max.x ?? 0);
      }
      return widest;
    };
    // Against the widest buoy body there is, so the claim does not rest on which shape the
    // renderer happens to assume when none is stated.
    expect(widthOf(beacon({ heightMetres: 3 }))).toBeLessThan(
      widthOf(mark({ shape: "spherical", heightMetres: 3 })),
    );
  });

  it("takes its colour like any other mark", () => {
    const parts = meshes(buildMark(beacon({ pattern: solid("red") })).group);
    const red = paintOf(parts[0]!).color;
    expect(red.r).toBeGreaterThan(red.g);
  });

  it("names the group after the mark, as a buoy's is", () => {
    expect(buildMark(beacon({ id: "hirase" })).group.name).toBe("mark:hirase");
  });
});

/**
 * The lamp exists only where a file said the mark carried one.
 *
 * **A dark lamp is a claim.** Drawing one on every mark and leaving it switched off would
 * put an unlit buoy in the picture wherever a report simply did not mention the light - and
 * a buoy and a lighted buoy are different marks.
 */
describe("the lamp a mark carries", () => {
  const lit = (overrides: Partial<Mark> = {}): Mark =>
    mark({ light: { character: "Fl(2) R 10s" }, ...overrides });

  it("is there when a light was stated, and absent when none was", () => {
    expect(buildMark(lit()).lamp).not.toBeNull();
    expect(buildMark(mark()).lamp).toBeNull();
  });

  /**
   * Off as it is built. A light that came on the moment the stage was made would flash once
   * out of rhythm before the clock had said anything, and the rhythm is the whole of what a
   * viewer reads off a mark at night.
   */
  it("starts hidden, waiting for a clock rather than for a frame", () => {
    expect(buildMark(lit()).lamp?.visible).toBe(false);
  });

  it("sits above the staff on a buoy that has one, and on top of a beacon", () => {
    const height = 3;
    const onPillar = buildMark(lit({ shape: "pillar", heightMetres: height }));
    const onCan = buildMark(lit({ shape: "can", heightMetres: height }));
    const onBeacon = buildMark({
      id: "shoal",
      kind: "beacon",
      at: { lat: 33, lon: 140 },
      heightMetres: height,
      light: { character: "Fl(2) R 10s" },
    });

    const heightOf = (parts: { lamp: { geometry: Mesh["geometry"] } | null }): number =>
      parts.lamp?.geometry.getAttribute("position").getY(0) ?? 0;

    // The staff is drawn three quarters of the body's height above it, so the lamp clears it.
    expect(heightOf(onPillar)).toBeGreaterThan(height * 1.7);
    expect(heightOf(onCan)).toBeCloseTo(height, 5);
    expect(heightOf(onBeacon)).toBeCloseTo(height, 5);
  });

  it("belongs to the mark's own group, so it heaves and leans with her", () => {
    const parts = buildMark(lit());
    expect(parts.group.children).toContain(parts.lamp);
  });
});

/**
 * What the buoyage says in daylight, drawn. A mark states its meaning three times over, and
 * two of those three are geometry: the colours as they sit on the body, and the shape on top.
 *
 * These are held on the DRAWN mark rather than on the table it came from, because the table
 * being right is not the same as the picture being right - and it is the picture a viewer
 * reads a mark off.
 */
describe("a mark drawn from what it is for", () => {
  const buoy = (overrides: Partial<Mark> = {}): Mark => mark({ heightMetres: 3, ...overrides });

  /**
   * The BODY's parts, with the colour each was painted.
   *
   * The staff and the topmark are excluded by their height: they sit above the body, they are
   * painted from the buoyage's own colours rather than the body's, and a claim about the
   * order of the bands has to be about the bands.
   */
  function paintedParts(mark: Mark, region: "A" | "B" | null = null): { y: number; hex: number }[] {
    const top = mark.heightMetres ?? 0;
    return meshes(buildMark(mark, region).group)
      .filter((mesh) => mesh.position.y < top)
      .map((mesh) => ({ y: mesh.position.y, hex: paintOf(mesh).color.getHex() }));
  }

  /**
   * Black over yellow is north and yellow over black is south, and nothing else on the body
   * tells them apart. Drawn the wrong way up, a mark tells a ship to pass on the other side
   * of a danger.
   */
  it("puts the bands on in the order the buoyage gives them", () => {
    const north = paintedParts(buoy({ purpose: "north-cardinal" }));
    const south = paintedParts(buoy({ purpose: "south-cardinal" }));
    const upper = (parts: { y: number; hex: number }[]): number =>
      [...parts].sort((a, b) => b.y - a.y)[0]?.hex ?? 0;

    expect(upper(north)).not.toBe(upper(south));
    // And the two are each other's mirror: north's upper band is south's lower.
    const lower = (parts: { y: number; hex: number }[]): number =>
      [...parts].sort((a, b) => a.y - b.y)[0]?.hex ?? 0;
    expect(upper(north)).toBe(lower(south));
  });

  /** A striped mark's colours sit around it, so every stripe is at the same height. */
  it("stripes safe water around the body rather than up it", () => {
    const parts = paintedParts(buoy({ purpose: "safe-water" }));
    const heights = new Set(parts.map((part) => part.y.toFixed(6)));

    expect(parts.length).toBeGreaterThan(1);
    expect(heights.size).toBe(1);
    expect(new Set(parts.map((part) => part.hex)).size).toBe(2);
  });

  /**
   * The four cardinal topmarks differ only in how the two cones are turned, and that is the
   * whole message by day. A cone points up when its wide end is at the bottom.
   */
  it("turns the cardinal cones the four ways the buoyage turns them", () => {
    const cones = (purpose: MarkPurpose): number[] =>
      meshes(buildMark(buoy({ purpose })).group)
        .filter((mesh) => mesh.geometry.type === "ConeGeometry")
        .map((mesh) => Math.round(mesh.rotation.z * 100) / 100);

    expect(cones("north-cardinal")).toEqual([0, 0]);
    expect(cones("south-cardinal").every((turn) => turn !== 0)).toBe(true);
    // East is base to base and west point to point: one of each, the other way round.
    expect(cones("east-cardinal")[0]).not.toBe(cones("east-cardinal")[1]);
    expect(cones("west-cardinal")[0]).not.toBe(cones("west-cardinal")[1]);
    expect(cones("east-cardinal")[0]).not.toBe(cones("west-cardinal")[0]);
  });

  /**
   * A special mark's X and a wreck buoy's upright cross are two different daylight statements
   * (R1001 Tables 9 and 11), and the only thing separating them in the picture is how far the
   * arms are turned.
   */
  it("turns a special mark's cross and leaves the wreck buoy's upright", () => {
    const arms = (purpose: MarkPurpose): number[] =>
      meshes(buildMark(buoy({ purpose })).group)
        .filter((mesh) => mesh.geometry.type === "BoxGeometry")
        .map((mesh) => Math.round(Math.abs(mesh.rotation.z) * 100) / 100)
        .sort();

    expect(arms("special")).not.toEqual(arms("emergency-wreck"));
    expect(arms("emergency-wreck")).toContain(0);
    expect(arms("special")).not.toContain(0);
  });

  /**
   * A lamp goes on whatever was actually built. A safe-water mark is a sphere with no staff,
   * and its shape comes from its purpose rather than from a stated field - read the field
   * instead and the lamp is placed three quarters of the mark's height above nothing at all.
   */
  it("puts the lamp on the mark the purpose drew, not on the one the field named", () => {
    const height = 3;
    const lamp = (purpose: MarkPurpose): number => {
      const parts = buildMark(buoy({ purpose, heightMetres: height, light: {} }));
      return parts.lamp?.geometry.getAttribute("position").getY(0) ?? 0;
    };

    // Safe water is a sphere: the lamp sits on the body, at its own height.
    expect(lamp("safe-water")).toBeCloseTo(height, 5);
    // A cardinal mark is a pillar, which carries a staff, and the lamp goes above it.
    expect(lamp("north-cardinal")).toBeGreaterThan(height * 1.7);
  });

  /** Two spheres for an isolated danger, one for safe water - by day that is the difference. */
  it("gives an isolated danger two spheres and safe water one", () => {
    const spheres = (purpose: MarkPurpose): number =>
      meshes(buildMark(buoy({ purpose })).group).filter(
        (mesh) => mesh.geometry.type === "SphereGeometry",
      ).length;

    expect(spheres("isolated-danger")).toBe(2);
    // Safe water's own body is a sphere as well, so its topmark is the one above the rest.
    expect(spheres("safe-water")).toBeGreaterThan(spheres("special"));
  });

  /**
   * The region reverses the lateral colours and nothing else. A tool that ignored it would
   * paint every Japanese channel mark the wrong colour, plausibly and silently.
   */
  it("paints a port-hand mark green in Region B and red in Region A", () => {
    const green = paintedParts(buoy({ purpose: "port-hand" }), "B")[0]?.hex ?? 0;
    const red = paintedParts(buoy({ purpose: "port-hand" }), "A")[0]?.hex ?? 0;
    expect(green).not.toBe(red);
  });

  /** With no region, there is nothing to paint it from, and the fallback is this tool's. */
  it("falls back to what this tool chose where the region is not stated", () => {
    const chosen = paintedParts(buoy({ purpose: "port-hand" }), null)[0]?.hex ?? 0;
    const plain = paintedParts(buoy())[0]?.hex ?? 0;
    expect(chosen).toBe(plain);
  });
});

/**
 * How a beacon is built, which means nothing at all - and is therefore a different field from
 * the buoy's shape, which means a great deal.
 */
describe("a beacon's construction", () => {
  const built = (construction: MarkConstruction): Mesh[] =>
    meshes(
      buildMark({
        id: "shoal",
        kind: "beacon",
        at: { lat: 33, lon: 140 },
        heightMetres: 8,
        construction,
      }).group,
    );

  it("draws a lattice as a framework and the others as one upright", () => {
    expect(built("lattice").length).toBeGreaterThan(built("tower").length);
    expect(built("column")).toHaveLength(2);
  });

  /** A pile is driven into the ground and stands on nothing else. */
  it("gives a pile no plinth, and the others one", () => {
    expect(built("pile")).toHaveLength(1);
    expect(built("tower")).toHaveLength(2);
  });

  it("tapers a tower harder than a column, which is the whole difference", () => {
    const taper = (construction: MarkConstruction): number => {
      const mesh = built(construction)[0];
      const parameters = (mesh?.geometry as CylinderGeometry).parameters;
      return parameters.radiusTop / parameters.radiusBottom;
    };
    expect(taper("tower")).toBeLessThan(taper("column"));
  });
});
