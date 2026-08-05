import { Box3, LineDashedMaterial } from "three";
import type { AmbientLight, Color, Fog, GridHelper, Line } from "three";
import { describe, expect, it } from "vitest";

import { prepareTrack } from "../src/core/track.js";
import type { Track } from "../src/core/types.js";
import { buildScene, buildTrackLine } from "../src/render/scene.js";
import { ORIGIN } from "./fixtures.js";

function background(scene: { background: unknown }): number {
  return (scene.background as Color).getHex();
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
    parts.setDiagramLighting(true);
    expect(ambient!.intensity).toBeGreaterThan(atNight);
    parts.setDiagramLighting(false);
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

  it("treats an explicit null the same as an absent figure", () => {
    const stated = buildScene({ lightCondition: "night", visibilityMetres: null }, 5000);
    const absent = buildScene({ lightCondition: "night" }, 5000);
    expect((stated.scene.fog as Fog).far).toBe((absent.scene.fog as Fog).far);
  });
});

describe("the grid", () => {
  it("keeps exactly one grid however often the view is reframed", () => {
    const parts = buildScene(undefined, 1000);
    for (const extent of [1000, 4000, 400, 40000, 400]) parts.setViewExtent(extent);
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

    parts.setViewExtent(600);
    const close = sizeOfGrid();
    parts.setViewExtent(30000);
    expect(sizeOfGrid()).toBeGreaterThan(close);
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

  function linesOf(derivations: ("measured" | "interpolated")[]): Line[] {
    const prepared = prepareTrack("A", track(derivations), ORIGIN);
    return buildTrackLine(prepared, 0xff0000).children.filter(
      (child): child is Line => child.type === "Line",
    );
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

    const last = solidEnd.count - 1;
    expect(dashedStart.getX(0)).toBeCloseTo(solidEnd.getX(last), 5);
    expect(dashedStart.getZ(0)).toBeCloseTo(solidEnd.getZ(last), 5);
  });
});
