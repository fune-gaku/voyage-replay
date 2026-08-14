import { Box3, LineDashedMaterial } from "three";
import type { AmbientLight, Color, Fog, GridHelper, Line, LineBasicMaterial } from "three";
import { describe, expect, it } from "vitest";

import { prepareTrack, sampleAt } from "../src/core/track.js";
import type { Track } from "../src/core/types.js";
import type { Frame } from "../src/render/basemap.js";
import { toWorld } from "../src/render/coords.js";
import { buildScene, buildTrackLine } from "../src/render/scene.js";
import { ORIGIN } from "./fixtures.js";

function background(scene: { background: unknown }): number {
  return (scene.background as Color).getHex();
}

/** A plan view of a given width, centred on the scenario origin. */
function frameOf(extentMetres: number): Frame {
  return { centre: { east: 0, north: 0 }, extentMetres, aspect: 16 / 9 };
}

function gridsIn(scene: { children: { type: string }[] }): GridHelper[] {
  return scene.children.filter((child): child is GridHelper => child.type === "GridHelper");
}

describe("light condition", () => {
  it("darkens the sky and the water at night", () => {
    const night = buildScene({ lightCondition: "night" }, 1000);
    const day = buildScene({ lightCondition: "day" }, 1000);

    expect(background(night.scene)).toBeLessThan(background(day.scene));
  });

  it("treats twilight, and an unstated condition, as night", () => {
    const night = background(buildScene({ lightCondition: "night" }, 1000).scene);

    expect(background(buildScene({ lightCondition: "twilight" }, 1000).scene)).toBe(night);
    expect(background(buildScene(undefined, 1000).scene)).toBe(night);
    expect(background(buildScene({}, 1000).scene)).toBe(night);
  });

  /**
   * The plan view is a diagram and a bridge view is the night. Lit for night a hull renders
   * almost black, which is right from a wheelhouse and useless from above, where an
   * investigator has to tell two ships apart and read their aspect.
   */
  it("lifts the light for the plan view and drops it again for a bridge", () => {
    const parts = buildScene({ lightCondition: "night" }, 1000);
    const ambient = parts.scene.children.find(
      (child): child is AmbientLight => child.type === "AmbientLight",
    );

    const atNight = ambient!.intensity;
    parts.setDiagramView(true);
    expect(ambient!.intensity).toBeGreaterThan(atNight);
    parts.setDiagramView(false);
    expect(ambient!.intensity).toBe(atNight);
  });
});

describe("visibility", () => {
  it("brings the fog in to the stated visibility", () => {
    const { scene } = buildScene({ lightCondition: "night", visibilityMetres: 2000 }, 50000);
    expect((scene.fog as Fog).far).toBe(2000);
  });

  // Where the report gives no figure the fog is pushed beyond the scene rather than
  // invented, so nothing fades that the source did not say faded.
  it("pushes it past everything when the source gives no figure", () => {
    const extent = 5000;
    const { scene } = buildScene({ lightCondition: "night" }, extent);
    expect((scene.fog as Fog).far).toBeGreaterThan(extent);
  });

  /**
   * Fog is weather seen from a bridge; a chart is not drawn through it. It fades by the
   * distance from the eye, and the plan camera's eye is twelve kilometres up - so a
   * scenario a few hundred metres across renders as a sheet of empty sky, and so does any
   * view taken far enough out, whatever the scenario.
   */
  it("clears the fog for the plan view and puts it back for a bridge", () => {
    const parts = buildScene({ lightCondition: "night", visibilityMetres: 2000 }, 1000);

    parts.setDiagramView(true);
    expect(parts.scene.fog).toBeNull();
    parts.setDiagramView(false);
    expect((parts.scene.fog as Fog).far).toBe(2000);
  });

  it("treats an explicit null the same as an absent figure", () => {
    const stated = buildScene({ lightCondition: "night", visibilityMetres: null }, 5000);
    const absent = buildScene({ lightCondition: "night" }, 5000);
    expect((stated.scene.fog as Fog).far).toBe((absent.scene.fog as Fog).far);
  });
});

describe("the water", () => {
  /**
   * Sized once rather than from the scenario. Neither view's need for it has much to do
   * with how far the ships travelled - a bridge camera wants water out to the horizon, and
   * the plan view can be taken out to hundreds of kilometres - so a plane cut to the tracks
   * runs off the end into the background colour in both.
   */
  it("reaches far beyond the tracks, whatever they span", () => {
    const sizeOf = (extentMetres: number): number => {
      const { scene } = buildScene(undefined, extentMetres);
      const water = scene.children.find((child) => child.type === "Mesh")!;
      const box = new Box3().setFromObject(water);
      return box.max.x - box.min.x;
    };

    const harbour = sizeOf(500);
    expect(harbour, "hundreds of kilometres of it, for a scenario 500 m across").toBeGreaterThan(
      500_000,
    );
    expect(sizeOf(50_000), "and no more for one a hundred times bigger").toBe(harbour);
  });
});

describe("the grid", () => {
  it("keeps exactly one grid however often the view is reframed", () => {
    const parts = buildScene(undefined, 1000);
    for (const extent of [1000, 4000, 400, 40000, 400]) parts.setView(frameOf(extent));
    expect(gridsIn(parts.scene)).toHaveLength(1);
  });

  // A fixed spacing is wrong at both ends: 500 m squares wash out a 20 km view and draw a
  // single line across a 700 m one, and a plan view whose scale cannot be read is a cartoon.
  it("opens the squares out as the view widens", () => {
    const parts = buildScene(undefined, 1000);
    const sizeOfGrid = (): number => {
      const box = new Box3().setFromObject(gridsIn(parts.scene)[0]!);
      return box.max.x - box.min.x;
    };

    parts.setView(frameOf(600));
    const close = sizeOfGrid();
    parts.setView(frameOf(30000));
    expect(sizeOfGrid()).toBeGreaterThan(close);
  });

  /**
   * The ladder has to reach as far as the view does. Stopped at ten kilometres it would
   * draw a hundred squares across a thousand-kilometre frame, which is the same unreadable
   * wash as five-hundred-metre squares across twenty km, at the other end.
   */
  it("keeps a legible count of squares out to the widest view offered", () => {
    const parts = buildScene(undefined, 1000);
    parts.setView(frameOf(1_000_000));

    const box = new Box3().setFromObject(gridsIn(parts.scene)[0]!);
    const spacing = (box.max.x - box.min.x) / 400;
    expect(1_000_000 / spacing, "squares across the frame").toBeLessThan(25);
  });
});

describe("buildTrackLine", () => {
  function track(derivations: ("measured" | "interpolated")[]): Track {
    return {
      derivation: "measured",
      positionAt: "gps-antenna",
      points: derivations.map((derivation, i) => ({
        t: new Date(Date.UTC(2025, 0, 1, 0, i)).toISOString(),
        lat: i * 0.001,
        lon: 0,
        derivation,
      })),
    };
  }

  /**
   * The line as it stands once she has covered the whole track. Every leg is drawn twice -
   * behind her and ahead of her - so a test about which legs exist has to say which half of
   * the pair it means.
   */
  function linesOf(
    derivations: ("measured" | "interpolated")[],
    which: "behind" | "ahead" = "behind",
  ): Line[] {
    const prepared = prepareTrack("A", track(derivations), ORIGIN);
    const line = buildTrackLine(prepared, 0xff0000);
    line.setNow(prepared.endSeconds);
    return line.group.children.filter((child): child is Line => child.name === which);
  }

  /** How many vertices are actually being drawn, which is not how many were allocated. */
  function drawn(line: Line): number {
    return line.geometry.drawRange.count;
  }

  it("draws a wholly recorded track as one solid line", () => {
    const lines = linesOf(["measured", "measured", "measured"]);
    expect(lines).toHaveLength(1);
    expect(lines[0]!.material).not.toBeInstanceOf(LineDashedMaterial);
  });

  /**
   * Recorded and reconstructed have to be told apart at a glance. This is the convention
   * the Japan Transport Safety Board uses in its own track charts, and it is the whole
   * basis on which this tool can call itself a reconstruction rather than an animation.
   */
  it("breaks the line where the track stops being recorded, and dashes that part", () => {
    const lines = linesOf(["measured", "measured", "interpolated", "interpolated"]);

    expect(lines).toHaveLength(2);
    expect(lines[0]!.material).not.toBeInstanceOf(LineDashedMaterial);
    expect(lines[1]!.material).toBeInstanceOf(LineDashedMaterial);
  });

  // The runs overlap by one point so the line has no gap, which means the first point of
  // every run after the first still carries the PREVIOUS run's derivation. Reading the
  // style off it drew reconstructed track solid.
  it("dashes a reconstructed opening and returns to solid where the record resumes", () => {
    const lines = linesOf(["interpolated", "interpolated", "measured", "measured"]);

    expect(lines).toHaveLength(2);
    expect(lines[0]!.material).toBeInstanceOf(LineDashedMaterial);
    expect(lines[1]!.material).not.toBeInstanceOf(LineDashedMaterial);
  });

  it("joins the runs rather than leaving a gap between them", () => {
    const lines = linesOf(["measured", "measured", "interpolated"]);
    const solidEnd = lines[0]!.geometry.getAttribute("position");
    const dashedStart = lines[1]!.geometry.getAttribute("position");

    const last = drawn(lines[0]!) - 1;
    expect(dashedStart.getX(0)).toBeCloseTo(solidEnd.getX(last), 5);
    expect(dashedStart.getZ(0)).toBeCloseTo(solidEnd.getZ(last), 5);
  });

  /**
   * A single reconstructed point between two recorded ones is the hardest case for the
   * overlap-by-one scheme, because the runs on either side of it are two points long and
   * the lone point is the join for both. It is also a real shape: one sample dropped out
   * of an otherwise complete AIS track.
   *
   * The line goes dashed on the way in and solid on the way out, so the reconstructed
   * point is never presented as if the whole leg were recorded.
   */
  it("handles a single reconstructed point between recorded ones", () => {
    const lines = linesOf(["measured", "interpolated", "measured"]);

    expect(lines).toHaveLength(2);
    expect(lines[0]!.material).toBeInstanceOf(LineDashedMaterial);
    expect(lines[1]!.material).not.toBeInstanceOf(LineDashedMaterial);
  });

  /**
   * The second thing one line has to carry, and it is deliberately NOT carried by the
   * dashes: those already say where the figures came from. Bright behind her, faint ahead.
   */
  it("draws what she has covered apart from what is still ahead of her", () => {
    const prepared = prepareTrack("A", track(["measured", "measured", "measured"]), ORIGIN);
    const line = buildTrackLine(prepared, 0xff0000);
    const halfway = (prepared.startSeconds + prepared.endSeconds) / 2;
    line.setNow(halfway);

    const [behind, ahead] = line.group.children as Line[];
    expect(behind!.visible).toBe(true);
    expect(ahead!.visible).toBe(true);
    expect((behind!.material as LineBasicMaterial).opacity).toBeGreaterThan(
      (ahead!.material as LineBasicMaterial).opacity,
    );
  });

  /**
   * The join is her position at that instant, not the nearest sample. A minute between
   * samples is most of a mile, and a line that changed strength that far from the hull
   * would be answering a different question from the one it looks like it is answering.
   */
  it("joins the two under the hull, wherever between samples she is", () => {
    const prepared = prepareTrack("A", track(["measured", "measured", "measured"]), ORIGIN);
    const line = buildTrackLine(prepared, 0xff0000);
    const between = prepared.startSeconds + 30;
    line.setNow(between);

    const [behind, ahead] = line.group.children as Line[];
    const covered = behind!.geometry.getAttribute("position");
    const rest = ahead!.geometry.getAttribute("position");
    const last = behind!.geometry.drawRange.count - 1;

    const here = toWorld(sampleAt(prepared, between)!.position, 0);
    expect(covered.getZ(last), "the covered part ends under her").toBeCloseTo(here.z, 5);
    expect(rest.getZ(0), "and the rest starts there").toBeCloseTo(here.z, 5);
  });

  it("draws nothing behind her before she has started", () => {
    const prepared = prepareTrack("A", track(["measured", "measured"]), ORIGIN);
    const line = buildTrackLine(prepared, 0xff0000);
    line.setNow(prepared.startSeconds);

    const [behind, ahead] = line.group.children as Line[];
    expect(behind!.visible, "she has covered none of it").toBe(false);
    expect(ahead!.visible, "and all of it is still to come").toBe(true);
  });

  it("draws nothing ahead of her once she has finished", () => {
    const prepared = prepareTrack("A", track(["measured", "measured"]), ORIGIN);
    const line = buildTrackLine(prepared, 0xff0000);
    line.setNow(prepared.endSeconds);

    const [behind, ahead] = line.group.children as Line[];
    expect(behind!.visible).toBe(true);
    expect(ahead!.visible).toBe(false);
  });

  it("draws a two-point track as one line rather than dropping it", () => {
    expect(linesOf(["measured", "measured"])).toHaveLength(1);
    expect(linesOf(["measured", "interpolated"])).toHaveLength(1);
  });

  // Every point of every run has to appear on some line. A run shorter than two points is
  // skipped as undrawable, and the arithmetic that decides where the next run starts is
  // the sort that loses a segment quietly.
  it("leaves no stretch of an alternating track undrawn", () => {
    const lines = linesOf(["measured", "interpolated", "measured", "interpolated", "measured"]);
    const segments = lines.reduce((n, line) => n + drawn(line) - 1, 0);

    // Four segments between five points, each drawn exactly once.
    expect(segments).toBe(4);
  });
});
