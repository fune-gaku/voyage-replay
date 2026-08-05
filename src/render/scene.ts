/**
 * The world everything else sits in: water, sky, light, and the tracks themselves.
 *
 * At night there is almost nothing to see, which is the point - a dark sea is why the
 * navigation lights carry the scene. The grid is the concession: without some reference
 * on the water you cannot judge how fast anything is moving or how far apart they are,
 * and a reconstruction whose scale you cannot read is a cartoon.
 */

import type { Vector3 } from "three";
import {
  AmbientLight,
  BufferGeometry,
  Color,
  DirectionalLight,
  Fog,
  GridHelper,
  Group,
  Line,
  LineBasicMaterial,
  LineDashedMaterial,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  Scene,
} from "three";

import type { Environment } from "../core/types.js";
import type { PreparedPoint, PreparedTrack } from "../core/track.js";
import { toWorld } from "./coords.js";

export interface SceneParts {
  scene: Scene;
  /** Actors are added here so the whole cast can be found in one place. */
  actors: Group;
  /**
   * Tell the scene how wide the camera is currently looking, so the grid can pick a
   * spacing that is readable. A fixed spacing is wrong at both ends: 500 m squares are a
   * solid wash across a 20 km view and a single line across a 700 m one, and a plan view
   * whose scale cannot be read is a cartoon.
   */
  setViewExtent(extentMetres: number): void;
  /**
   * The plan view is a diagram; a bridge view is the night.
   *
   * Lit for night, a hull renders almost black - which is exactly right from a bridge,
   * where a ship at two miles IS her lights and nothing else. In the overhead view it is
   * useless: an investigator has to tell the two apart and read their aspect, and a chart
   * has never been drawn in the dark. So the plan view lifts the light; the bridge view
   * does not.
   */
  setDiagramLighting(on: boolean): void;
}

/** Spacings a chart would use. The grid takes the first that gives a legible count. */
const GRID_LADDER = [25, 50, 100, 200, 500, 1000, 2000, 5000, 10000];

const NIGHT = { sky: 0x05080e, water: 0x0a121d, ambient: 0.28 };
const DAY = { sky: 0x9fb8cf, water: 0x2b4a63, ambient: 0.95 };

type Palette = typeof NIGHT;

export function buildScene(environment: Environment | undefined, extentMetres: number): SceneParts {
  const night = isNight(environment);
  const palette = night ? NIGHT : DAY;

  const scene = new Scene();
  scene.background = new Color(palette.sky);
  scene.fog = buildFog(palette, environment?.visibilityMetres, extentMetres);
  scene.add(waterMesh(palette, extentMetres));

  const setDiagramLighting = addLighting(scene, palette, night);

  // Before the grid, so the scene's children keep the order they had when this was one
  // function: water, lights, cast, grid.
  const actors = new Group();
  scene.add(actors);

  const setViewExtent = addGrid(scene);
  setViewExtent(extentMetres);

  return { scene, actors, setViewExtent, setDiagramLighting };
}

/** Twilight is drawn as night, and so is an unstated condition. */
function isNight(environment: Environment | undefined): boolean {
  return (
    environment?.lightCondition === "night" ||
    environment?.lightCondition === "twilight" ||
    environment?.lightCondition === undefined
  );
}

/**
 * In fog the far ship should fade, which is half the explanation in a restricted
 * visibility case. Where the report gives no figure, the fog is set far enough away to
 * be invisible rather than invented.
 */
function buildFog(
  palette: Palette,
  visibilityMetres: number | null | undefined,
  extentMetres: number,
): Fog {
  return new Fog(
    palette.sky,
    visibilityMetres ? visibilityMetres * 0.25 : extentMetres * 1.4,
    visibilityMetres ?? extentMetres * 3,
  );
}

function waterMesh(palette: Palette, extentMetres: number): Mesh {
  const water = new Mesh(
    new PlaneGeometry(extentMetres * 6, extentMetres * 6),
    new MeshStandardMaterial({ color: palette.water, roughness: 0.95, metalness: 0.1 }),
  );
  water.rotation.x = -Math.PI / 2;
  return water;
}

/** Adds the two lights and hands back the switch described on `setDiagramLighting`. */
function addLighting(scene: Scene, palette: Palette, night: boolean): (on: boolean) => void {
  const ambient = new AmbientLight(0xffffff, palette.ambient);
  const key = new DirectionalLight(0xffffff, night ? 0.25 : 1.1);
  key.position.set(1, 2, 1);
  scene.add(ambient);
  scene.add(key);

  return (on: boolean): void => {
    ambient.intensity = on ? Math.max(palette.ambient, 1.35) : palette.ambient;
    key.intensity = on ? 0.8 : night ? 0.25 : 1.1;
  };
}

/** Owns the one grid, replacing it when the view has moved far enough to want another. */
function addGrid(scene: Scene): (viewExtentMetres: number) => void {
  let grid: GridHelper | null = null;
  let spacing = 0;

  return (viewExtentMetres: number): void => {
    // Aim for roughly a dozen squares across the frame.
    const wanted = viewExtentMetres / 12;
    const chosen = GRID_LADDER.find((step) => step >= wanted) ?? GRID_LADDER.at(-1) ?? 1000;
    if (chosen === spacing) return;
    spacing = chosen;

    if (grid) {
      scene.remove(grid);
      grid.geometry.dispose();
    }
    // Cover many frames' worth so following the ships never runs off the grid's edge.
    const divisions = 400;
    grid = new GridHelper(chosen * divisions, divisions, 0x2c4055, 0x18283a);
    grid.position.y = 0.05;
    scene.add(grid);
  };
}

/**
 * A track drawn on the water. Segments the tool synthesised or a human inferred are
 * dashed, so what was recorded and what was reconstructed are told apart at a glance -
 * the same convention the Japan Transport Safety Board uses in its own track charts.
 */
export function buildTrackLine(track: PreparedTrack, colour: number): Group {
  const group = new Group();
  for (const run of derivationRuns(track.points)) {
    if (run.length < 2) continue;
    group.add(
      polyline(
        run.map((p) => toWorld(p.position, 1.2)),
        colour,
        // The SECOND point, not the first. The first is the join shared with the previous
        // run and still carries the previous run's derivation, so reading the style off it
        // labels every run after the first with the kind it just stopped being - drawing
        // reconstructed track solid, which is the one thing this line must never do.
        run[1]?.derivation === "measured",
      ),
    );
  }
  return group;
}

/**
 * Cut the track where it crosses between recorded and reconstructed. Consecutive runs
 * share their boundary point, so the dashed length starts where the solid one ends rather
 * than leaving a gap the width of one interval.
 */
function derivationRuns(points: PreparedPoint[]): PreparedPoint[][] {
  const runs: PreparedPoint[][] = [];
  let runStart = 0;
  for (let i = 1; i <= points.length; i += 1) {
    const previous = points[i - 1];
    const next = points[i];
    const sameKind =
      next && previous && (next.derivation === "measured") === (previous.derivation === "measured");
    if (sameKind) continue;
    runs.push(points.slice(runStart, i));
    runStart = i - 1;
  }
  return runs;
}

function polyline(vertices: Vector3[], colour: number, solid: boolean): Line {
  const geometry = new BufferGeometry().setFromPoints(vertices);
  const line = new Line(
    geometry,
    solid
      ? new LineBasicMaterial({ color: colour, transparent: true, opacity: 0.85 })
      : new LineDashedMaterial({
          color: colour,
          transparent: true,
          opacity: 0.55,
          dashSize: 40,
          gapSize: 26,
        }),
  );
  if (!solid) line.computeLineDistances();
  return line;
}
