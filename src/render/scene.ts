/**
 * The world everything else sits in: water, sky, light, and the tracks themselves.
 *
 * At night there is almost nothing to see, which is the point - a dark sea is why the
 * navigation lights carry the scene. The grid is the concession: without some reference
 * on the water you cannot judge how fast anything is moving or how far apart they are,
 * and a reconstruction whose scale you cannot read is a cartoon.
 */

import {
  AmbientLight,
  BufferAttribute,
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

import type { LocalPosition } from "../core/geodesy.js";
import type { Environment } from "../core/types.js";
import { sampleAt, type PreparedPoint, type PreparedTrack } from "../core/track.js";
import { buildBasemap, type Basemap, type Frame } from "./basemap.js";
import { toWorld } from "./coords.js";
import type { LatLon } from "../core/types.js";

/**
 * Where in the world this scenario is, and what to do when a map tile arrives.
 *
 * Optional as a pair rather than as two arguments, because they are useless apart: a scene
 * asked to draw a map has to be able to say where the map came from, and one that draws no
 * map must not say it anyway.
 */
export interface MapRequest {
  origin: LatLon;
  onFirstTile: () => void;
}

export interface SceneParts {
  scene: Scene;
  /** Actors are added here so the whole cast can be found in one place. */
  actors: Group;
  /**
   * Tell the scene what the plan camera is looking at, so the grid can pick a spacing that
   * is readable. A fixed spacing is wrong at both ends: 500 m squares are a solid wash
   * across a 20 km view and a single line across a 700 m one, and a plan view whose scale
   * cannot be read is a cartoon.
   *
   * The basemap needs the whole frame rather than its width alone, because it fetches the
   * ground the frame is over.
   */
  setView(frame: Frame): void;
  /**
   * The plan view is a diagram; a bridge view is the night.
   *
   * Lit for night, a hull renders almost black - which is exactly right from a bridge,
   * where a ship at two miles IS her lights and nothing else. In the overhead view it is
   * useless: an investigator has to tell the two apart and read their aspect, and a chart
   * has never been drawn in the dark. So the plan view lifts the light; the bridge view
   * does not.
   *
   * The map goes the same way. Drawn flat on the water it is a chart seen from above and a
   * pale sheet lying on the sea from a wheelhouse window, where the land it describes would
   * be a dark shape on the horizon or nothing at all.
   */
  setDiagramView(on: boolean): void;
}

/**
 * Spacings a chart would use. The grid takes the first that gives a legible count.
 *
 * The top of it is not decoration: the plan view can be taken out to hundreds of
 * kilometres, and stopping the ladder at ten would draw a hundred squares across the frame
 * - which is the same unreadable wash as five-hundred-metre squares across twenty km, at
 * the other end.
 */
const GRID_LADDER = [25, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000, 100000];

const NIGHT = { sky: 0x05080e, water: 0x0a121d, ambient: 0.28 };
const DAY = { sky: 0x9fb8cf, water: 0x2b4a63, ambient: 0.95 };

/**
 * What the tiles are multiplied by - and it does NOT follow the light condition.
 *
 * That was tried both ways. Tinted down to something like the water it lies on, the night
 * map was a dark smudge: the pale sheet carries only about a tenth of its brightness
 * between land and sea, so multiplying it down takes that difference with it and leaves a
 * plan view whose coastline cannot be made out at all. Dark enough to read as night is dark
 * enough to be useless, because the two are the same amount of dark.
 *
 * Which is the conclusion `setDiagramView` had already reached about the lighting: the plan
 * view is a diagram, a chart has never been drawn in the dark, and this map appears nowhere
 * else. The bridge view is still the night, because from a wheelhouse the dark IS the
 * evidence.
 *
 * The cue that is given up here - a dark plan view meaning a night incident - is put back
 * somewhere it can be read rather than guessed at: the clock in the corner of every frame.
 * See `render/overlay.ts`.
 */
const MAP_TINT = 0xe6ecf0;

type Palette = typeof NIGHT;

export function buildScene(
  environment: Environment | undefined,
  extentMetres: number,
  map?: MapRequest,
): SceneParts {
  const night = isNight(environment);
  const palette = night ? NIGHT : DAY;

  const scene = new Scene();
  scene.background = new Color(palette.sky);
  const fog = buildFog(palette, environment?.visibilityMetres, extentMetres);
  scene.fog = fog;
  scene.add(waterMesh(palette));

  const basemap = map ? buildBasemap(map.origin, MAP_TINT, map.onFirstTile) : null;
  if (basemap) scene.add(basemap.group);

  const setLighting = addLighting(scene, palette, night);

  // Before the grid, so the scene's children keep the order they had when this was one
  // function: water, lights, cast, grid.
  const actors = new Group();
  actors.name = "actors";
  scene.add(actors);

  return { scene, actors, ...viewControls(scene, { basemap, fog }, setLighting, extentMetres) };
}

/** What the view switches between, as opposed to what it leaves alone. */
interface Switchable {
  basemap: Basemap | null;
  fog: Fog;
}

/** The two switches the view owns, wired to everything that answers to them. */
function viewControls(
  scene: Scene,
  { basemap, fog }: Switchable,
  setLighting: (on: boolean) => void,
  extentMetres: number,
): Pick<SceneParts, "setView" | "setDiagramView"> {
  const setGridSpacing = addGrid(scene);
  // The grid only, and only here. What the map fetches is a question about where the camera
  // is pointing, and at this moment it has not been framed on anything yet - the first real
  // frame arrives before anything is drawn.
  setGridSpacing(extentMetres);

  return {
    setView: (frame: Frame): void => {
      setGridSpacing(frame.extentMetres);
      basemap?.setView(frame);
    },
    setDiagramView: (on: boolean): void => {
      setLighting(on);
      if (basemap) basemap.group.visible = on;
      // Fog is weather seen from a bridge; a chart is not drawn through it. Leaving it on
      // fades the plan view by the distance from an eye twelve kilometres up - so a
      // scenario a few hundred metres across renders as a sheet of empty sky, and any view
      // taken far enough out does the same whatever the scenario.
      scene.fog = on ? null : fog;
    },
  };
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

/**
 * Sea to the edge of anything anyone will look at.
 *
 * Sized once rather than from the scenario, because neither view's need for it has much to
 * do with how far the ships travelled: a bridge camera wants water out to the horizon, and
 * the plan view can be taken out to hundreds of kilometres to ask where in the world this
 * is. Cut to the tracks, both run off the end of it and into the background colour.
 */
const WATER_METRES = 10_000_000;

function waterMesh(palette: Palette): Mesh {
  const water = new Mesh(
    new PlaneGeometry(WATER_METRES, WATER_METRES),
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

/** Just above the water, and above the map, so a track is never hidden by either. */
const TRACK_HEIGHT_METRES = 1.2;

/**
 * How strongly each part of a track is drawn.
 *
 * Two things have to be read off one line, so they are carried by two different properties:
 *
 * - **Solid or dashed says where the figures CAME FROM** - recorded, or reconstructed by a
 *   human or by this tool. That is the claim the whole project rests on, it is the
 *   convention the Japan Transport Safety Board uses in its own track charts, and nothing
 *   else may be allowed to take it over.
 * - **Bright or faint says whether she has BEEN there yet**, at the moment on the clock.
 *
 * Putting the second one on the dashes as well - dashed for the part still to come - would
 * read perfectly until the first scenario with an inferred leg, where the two meanings
 * would land on the same line and neither could be trusted again.
 */
const BEHIND = { solid: 0.9, dashed: 0.6 };
const AHEAD = { solid: 0.22, dashed: 0.16 };

/** One derivation-run of a track, drawn twice: what she has covered, and what is to come. */
interface Leg {
  points: PreparedPoint[];
  behind: Line;
  ahead: Line;
}

export interface TrackLine {
  group: Group;
  /** Move the join between what she has covered and what is still ahead of her. */
  setNow(epochSeconds: number): void;
}

/**
 * A track drawn on the water, split at the moment on the clock.
 *
 * Segments the tool synthesised or a human inferred are dashed, so what was recorded and
 * what was reconstructed are told apart at a glance - the same convention the Japan
 * Transport Safety Board uses in its own track charts. Ahead of the ship the same line is
 * drawn faintly: the route is known, because the whole record is, and drawing it at full
 * strength makes a replay look like a plan that was followed rather than a course that was
 * steered.
 */
export function buildTrackLine(track: PreparedTrack, colour: number): TrackLine {
  const group = new Group();
  const legs: Leg[] = [];

  for (const run of derivationRuns(track.points)) {
    if (run.length < 2) continue;
    // The SECOND point, not the first. The first is the join shared with the previous run
    // and still carries the previous run's derivation, so reading the style off it labels
    // every run after the first with the kind it just stopped being - drawing reconstructed
    // track solid, which is the one thing this line must never do.
    const solid = run[1]?.derivation === "measured";
    const leg = {
      points: run,
      behind: polyline(run, colour, solid, true),
      ahead: polyline(run, colour, solid, false),
    };
    group.add(leg.behind, leg.ahead);
    legs.push(leg);
  }

  return {
    group,
    setNow: (epochSeconds: number): void => {
      splitAt(track, legs, epochSeconds);
    },
  };
}

/** Put the covered part of every leg behind her and the rest ahead, joined at her position. */
function splitAt(track: PreparedTrack, legs: Leg[], epochSeconds: number): void {
  for (const leg of legs) {
    const covered = leg.points.filter((point) => point.epochSeconds <= epochSeconds).length;
    // The join is her position at this instant, so the two parts meet under the hull rather
    // than at whichever sample happens to be nearest - which at a minute between samples
    // would have the line change strength up to half a mile from the ship.
    const inside = covered > 0 && covered < leg.points.length;
    const join = inside ? (sampleAt(track, epochSeconds)?.position ?? null) : null;

    const behind = leg.points.slice(0, covered).map((point) => point.position);
    const ahead = leg.points.slice(covered).map((point) => point.position);
    drawInto(leg.behind, join ? [...behind, join] : behind);
    drawInto(leg.ahead, join ? [join, ...ahead] : ahead);
  }
}

/**
 * Write a run of positions into a line that was allocated once.
 *
 * Allocated once, and the draw range moved, rather than rebuilt: the split moves every
 * frame of playback, and replacing two geometries per leg per frame churns GPU buffers for
 * no gain on tracks of a few dozen points.
 */
function drawInto(line: Line, positions: LocalPosition[]): void {
  line.visible = positions.length >= 2 && !allInOnePlace(positions);
  if (!line.visible) return;

  const attribute = line.geometry.getAttribute("position");
  for (const [index, position] of positions.entries()) {
    const vertex = toWorld(position, TRACK_HEIGHT_METRES);
    attribute.setXYZ(index, vertex.x, vertex.y, vertex.z);
  }
  attribute.needsUpdate = true;
  line.geometry.setDrawRange(0, positions.length);
  // Dashes are measured along the line, so they have to be measured again when it moves.
  if (line.material instanceof LineDashedMaterial) line.computeLineDistances();
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

/**
 * Two vertices in one place are not a line.
 *
 * It happens at both ends of every leg: at the first sample the covered part is her
 * position and the sample she is standing on, and at the last the part still ahead is the
 * same pair. Drawn, a dashed one of those is a dot on the water at the exact moment a
 * reader is looking hardest at where she is.
 */
function allInOnePlace(positions: LocalPosition[]): boolean {
  const first = positions[0];
  if (!first) return true;
  return positions.every((p) => p.east === first.east && p.north === first.north);
}

/**
 * A line with room for one vertex more than the run has, which is the join under the hull.
 *
 * Filled with the run at full length so the bounding sphere covers wherever the split can
 * put it; frustum culling reads that once and never again, so a geometry that started empty
 * would be culled away at exactly the zooms this view is for.
 */
function polyline(run: PreparedPoint[], colour: number, solid: boolean, covered: boolean): Line {
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(new Float32Array((run.length + 1) * 3), 3));

  const opacity = covered ? BEHIND : AHEAD;
  const line = new Line(
    geometry,
    solid
      ? new LineBasicMaterial({ color: colour, transparent: true, opacity: opacity.solid })
      : new LineDashedMaterial({
          color: colour,
          transparent: true,
          opacity: opacity.dashed,
          dashSize: 40,
          gapSize: 26,
        }),
  );
  line.name = covered ? "behind" : "ahead";

  const positions = run.map((point) => point.position);
  drawInto(line, [...positions, positions.at(-1) ?? { east: 0, north: 0 }]);
  geometry.computeBoundingSphere();
  return line;
}
