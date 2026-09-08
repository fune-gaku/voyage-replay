/**
 * The world everything else sits in: water, sky, light, and the tracks themselves.
 *
 * At night there is almost nothing to see, which is the point - a dark sea is why the
 * navigation lights carry the scene. The grid is the concession: without some reference
 * on the water you cannot judge how fast anything is moving or how far apart they are,
 * and a reconstruction whose scale you cannot read is a cartoon.
 */

import type { Mesh } from "three";
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
  MeshStandardMaterial,
  Scene,
} from "three";

import type { LocalPosition } from "../core/geodesy.js";
import {
  ASSUMED_DIRECTION_DEGREES_TRUE,
  seawayFrom,
  surfaceAt,
  waveComponents,
  type Riding,
  type SurfacePoint,
  type WaveComponent,
} from "../core/seaway.js";
import type { Environment } from "../core/types.js";
import { sampleAt, type PreparedPoint, type PreparedTrack } from "../core/track.js";
import { buildBasemap, type Basemap, type Frame } from "./basemap.js";
import { toWorld } from "./coords.js";
import { applyCurvature, makeCurvatureUniforms, type CurvatureUniforms } from "./curvature.js";
import { buildTerrain, type Terrain } from "./terrain.js";
import {
  applyWaves,
  displacedFraction,
  makeWaveUniforms,
  meshCarries,
  setWaves,
  type WaveUniforms,
} from "./waves.js";
import { buildWater } from "./water.js";
import type { LatLon } from "../core/types.js";

/**
 * Where in the world this scenario is, and what to do when a piece of ground arrives.
 *
 * Optional as a group rather than as separate arguments, because they are useless apart: a
 * scene asked to draw the ground has to be able to say where the ground came from, and one
 * that draws none must not say it anyway. The two callbacks are separate because the two
 * layers appear in different views, and each credit answers only for its own.
 */
export interface Ground {
  origin: LatLon;
  /** A basemap tile has landed. The plan view now has a map to credit. */
  onFirstTile: () => void;
  /** An elevation tile has landed. The bridge view now has land to credit. */
  onFirstLandTile: () => void;
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
   *
   * So does the grid, and that one is a correction. It was drawn in both views, and a
   * glowing lattice on the sea outside a wheelhouse window is the same kind of fiction as a
   * track line - which this renderer already knew, and hid. The grid is the concession that
   * makes a CHART's scale readable; it has no business in the night.
   */
  setDiagramView(on: boolean): void;
  /**
   * Where the watchkeeper is standing and which way her bow points, or null for the plan
   * view and for a bridge whose own track has run out.
   *
   * One call, because these all answer to the same fact and disagreeing about it shows: the
   * earth bends away from THIS eye, the sea's dense middle sits under THIS eye, and the
   * land is fetched ahead of THIS bow. See `render/curvature.ts`.
   */
  setEye(eye: LocalPosition | null, headingDegreesTrue: number): void;
  /**
   * How far into the scenario playback has got, in seconds from its start.
   *
   * Seconds from the START rather than the epoch, and that is not tidiness: a uniform is a
   * float, an epoch second is past 1.7e9, and at that size a float's steps are longer than
   * a wave period. The sea would advance in jumps of a minute or stop altogether.
   *
   * The sea therefore runs on the SCENARIO's clock, so it is time-lapsed along with
   * everything else. A sea moving at its own rate while the ships run at sixty times theirs
   * would be the only thing in the frame telling the truth about time, which reads as a
   * still sea rather than as honesty.
   */
  setSeaClock(secondsFromStart: number): void;
  /** How much of the picture the shortest drawable wave has to fill - a property of the frame. */
  setPixelAngle(radians: number): void;
  /**
   * The sea under a point, as the water is DRAWN there.
   *
   * Anything that floats has to ask this rather than the sea itself. The water's geometry
   * fades to flat past a few hundred metres - the disc runs out of vertices, not the sea
   * out of waves - and a buoy riding the true field over visibly still water would be a
   * buoy hovering. One function, so the two cannot come apart.
   *
   * **The band is part of that, not only the range.** Each component is dropped where the
   * mesh beneath it runs out of vertices for it, so the sea here is the swell everywhere and
   * the chop near the eye alone - the same rule the vertex shader applies, mirrored in
   * `waves.ts` because nothing in Node can compile a shader to ask it.
   */
  drawnSurfaceAt(position: LocalPosition, secondsFromStart: number, riding?: Riding): SurfacePoint;
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

/**
 * `land` is the terrain's own colour, and at night it is nearly black on purpose: from a
 * wheelhouse a coast at ten miles IS a shape slightly darker than the sky, and painting it
 * any lighter would be inventing a moon. Only the skyline is meant to be readable.
 *
 * ## The day palette is a fine day, and that is a claim
 *
 * It was an overcast one before - a grey-blue sky with almost all of the light arriving as
 * ambient - which is no less of a claim and a worse one for looking at a sea: with the
 * light coming from everywhere, a wave face and its back are lit alike and the swell goes
 * flat. A clear sky puts most of the light in one direction, so the sea has a lit side and
 * a shaded one, and the water hands back a blue rather than a grey.
 *
 * **Neither is in the source.** Cloud is what decides this and no report this project has
 * met states it - the same gap `ui/panels.ts` already declares about how much moonlight
 * reached the sea. Saying which one is drawn belongs in the format (`environment` has no
 * cloud field yet) rather than in a constant; until it does, this is the honest default,
 * because a fine day is the condition a reader assumes when nothing says otherwise.
 *
 * The sun's DIRECTION is still arbitrary, and deliberately left so. It is computable from
 * the time and the place - `core/conditions.ts` already computes it - and pointing it
 * somewhere that flatters the picture instead would be the kind of thing this project
 * spends its time undoing. Issue #15.
 */
const NIGHT = { sky: 0x05080e, water: 0x0a121d, land: 0x03050a, ambient: 0.28 };
const DAY = { sky: 0x74a5dc, water: 0x1d4360, land: 0x6b7a5e, ambient: 0.55 };

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
  ground?: Ground,
): SceneParts {
  const night = isNight(environment?.lightCondition);
  const palette = night ? NIGHT : DAY;

  const scene = new Scene();
  scene.background = new Color(palette.sky);
  const fog = buildFog(palette, environment?.visibilityMetres, extentMetres);
  scene.fog = fog;

  const curvature = makeCurvatureUniforms();
  const water = addWater(scene, palette, curvature, environment);
  const { terrain, basemap } = addGround(scene, palette, curvature, ground);
  const setLighting = addLighting(scene, palette, night);

  // Before the grid, so the scene's children keep the order they had when this was one
  // function: water, lights, cast, grid.
  const actors = new Group();
  actors.name = "actors";
  scene.add(actors);

  const parts = {
    basemap,
    terrain,
    water: water.mesh,
    fog,
    curvature,
    waves: water.waves,
    sea: water.sea,
    grid: addGrid(scene),
  };
  return { scene, actors, ...viewControls(scene, parts, setLighting, extentMetres) };
}

/**
 * The sea, which both views stand on, only one of them lets bend, and only one has waves.
 *
 * The roughest sea the source allows is the one drawn. Not the calm end and not a midpoint:
 * among the seas a class permits, the calmer the picture the stronger its claim about what
 * the watchkeeper could see - which is the same argument that made a FLAT sea the strongest
 * claim of all and is the reason any of this exists. The panels carry the whole interval.
 *
 * **Sea state 9 is the exception, and it goes the wrong way.** Its class is "over 14 m"
 * with nothing above, so `rough` is the FLOOR - the calmest sea the class allows, and
 * therefore the strongest claim available - and drawing it is the one case where this
 * picture understates. Nothing here can fix that, since the class states no upper bound to
 * draw; `ui/panels.ts` says outright which end was drawn and what it implies.
 *
 * **Roughness drops a long way where there are waves, and that is what makes them visible
 * at all.** Daylight sea texture is specular: what the eye reads as waves is the sky and
 * the sun reflected at angles that change across a crest. At the flat sea's roughness the
 * shading is almost pure ambient diffuse, a perturbed normal moves it by a few per cent,
 * and a correct wave field renders as a flat sheet - measured before this was changed.
 */
function addWater(
  scene: Scene,
  palette: Palette,
  curvature: CurvatureUniforms,
  environment: Environment | undefined,
): { mesh: Mesh; waves: WaveUniforms; sea: WaveComponent[] } {
  const sea = seawayFrom(environment);
  const material = new MeshStandardMaterial({
    color: palette.water,
    roughness: sea ? 0.34 : 0.95,
    metalness: 0.1,
  });
  applyCurvature(material, curvature);

  const waves = makeWaveUniforms();
  waves.uSkyColour.value.setHex(palette.sky);
  applyWaves(material, waves);
  // Where the source states no direction the sea still has to run somewhere, so it runs the
  // assumed way and `ui/panels.ts` says that it was assumed. A narrow spread makes the
  // bearing plainly readable off the picture, which is exactly why it cannot go undeclared.
  const components = sea
    ? waveComponents(sea.rough, sea.fromDegreesTrue ?? ASSUMED_DIRECTION_DEGREES_TRUE)
    : [];
  setWaves(waves, components);

  const mesh = buildWater(material);
  scene.add(mesh);
  return { mesh, waves, sea: components };
}

/**
 * The two layers that need to know where in the world this is, which is the one thing they
 * have in common: neither exists without a `Ground`, and each answers for its own credit.
 */
function addGround(
  scene: Scene,
  palette: Palette,
  curvature: CurvatureUniforms,
  ground: Ground | undefined,
): { terrain: Terrain | null; basemap: Basemap | null } {
  const terrain = addTerrain(scene, palette, curvature, ground);
  const basemap = ground ? buildBasemap(ground.origin, MAP_TINT, ground.onFirstTile) : null;
  if (basemap) scene.add(basemap.group);
  return { terrain, basemap };
}

/** The land, if this scene knows where in the world it is. Hidden until a bridge asks. */
function addTerrain(
  scene: Scene,
  palette: Palette,
  curvature: CurvatureUniforms,
  ground: Ground | undefined,
): Terrain | null {
  if (!ground) return null;
  const material = new MeshStandardMaterial({ color: palette.land, roughness: 1, metalness: 0 });
  applyCurvature(material, curvature);
  const terrain = buildTerrain(ground.origin, material, ground.onFirstLandTile);
  terrain.group.visible = false;
  scene.add(terrain.group);
  return terrain;
}

/** What the view switches between, as opposed to what it leaves alone. */
interface Switchable {
  basemap: Basemap | null;
  terrain: Terrain | null;
  water: Mesh;
  fog: Fog;
  curvature: CurvatureUniforms;
  waves: WaveUniforms;
  sea: WaveComponent[];
  grid: GridControl;
}

/** The switches the view owns, wired to everything that answers to them. */
function viewControls(
  scene: Scene,
  parts: Switchable,
  setLighting: (on: boolean) => void,
  extentMetres: number,
): Pick<
  SceneParts,
  "setView" | "setDiagramView" | "setEye" | "setSeaClock" | "setPixelAngle" | "drawnSurfaceAt"
> {
  // The grid only, and only here. What the map fetches is a question about where the camera
  // is pointing, and at this moment it has not been framed on anything yet - the first real
  // frame arrives before anything is drawn.
  parts.grid.setSpacing(extentMetres);

  return {
    setView: (frame: Frame): void => {
      parts.grid.setSpacing(frame.extentMetres);
      parts.basemap?.setView(frame);
      // The sea follows whatever is reading it, so the dense middle of the disc sits under
      // the part of the picture somebody is looking at rather than at the origin.
      parts.water.position.set(frame.centre.east, 0, -frame.centre.north);
    },
    setDiagramView: (on: boolean): void => {
      setDiagram(scene, parts, setLighting, on);
    },
    setEye: (eye: LocalPosition | null, headingDegreesTrue: number): void => {
      standAt(parts, eye, headingDegreesTrue);
    },
    ...seaControls(parts),
  };
}

/**
 * The three that answer to the water rather than to the camera: when it is, how finely it can
 * be drawn, and what it comes to under a given point.
 *
 * Together because they are one surface seen three ways, and a caller that had the clock but
 * not the band would be asking about a sea nobody is drawing.
 */
function seaControls(
  parts: Switchable,
): Pick<SceneParts, "setSeaClock" | "setPixelAngle" | "drawnSurfaceAt"> {
  return {
    setSeaClock: (secondsFromStart: number): void => {
      parts.waves.uWaveTime.value = secondsFromStart;
    },
    setPixelAngle: (radians: number): void => {
      parts.waves.uPixelAngle.value = radians;
    },
    drawnSurfaceAt: (
      position: LocalPosition,
      secondsFromStart: number,
      riding?: Riding,
    ): SurfacePoint => drawnSurface(parts, position, secondsFromStart, riding),
  };
}

function setDiagram(
  scene: Scene,
  parts: Switchable,
  setLighting: (on: boolean) => void,
  on: boolean,
): void {
  setLighting(on);
  // A chart has never had waves drawn on it - the same decision this function already makes
  // about the lighting, the map's tint and the grid.
  parts.waves.uWaveScale.value = on ? 0 : 1;
  if (parts.basemap) parts.basemap.group.visible = on;
  parts.grid.setVisible(on);
  // Fog is weather seen from a bridge; a chart is not drawn through it. Leaving it on
  // fades the plan view by the distance from an eye twelve kilometres up - so a scenario a
  // few hundred metres across renders as a sheet of empty sky, and any view taken far
  // enough out does the same whatever the scenario.
  scene.fog = on ? null : parts.fog;
}

/**
 * The sea under a point, damped by the same fade the shader uses and switched off wherever
 * the shader's is - so a chart, which has no waves, floats nothing.
 */
/**
 * The sea as the mesh draws it HERE, which is less of it the further out the point is.
 *
 * The vertex shader band-limits every component to the vertices under it, so past a couple
 * of hundred metres the geometry holds the swell and none of the chop. **A floating body has
 * to be given the same sea**, or it heaves to waves that are not in the water beneath it -
 * which is the hovering buoy of #34 again, arriving this time through the band rather than
 * through the range fade.
 *
 * The amplitude is scaled rather than the component dropped, because that is what the shader
 * does: a fade, so that a mark crossing the range does not step.
 */
function asDrawn(sea: WaveComponent[], distanceFromEyeMetres: number): WaveComponent[] {
  return sea.map((wave) => ({
    ...wave,
    amplitudeMetres:
      wave.amplitudeMetres *
      meshCarries((2 * Math.PI) / wave.wavenumberPerMetre, distanceFromEyeMetres),
  }));
}

function drawnSurface(
  parts: Switchable,
  position: LocalPosition,
  secondsFromStart: number,
  riding?: Riding,
): SurfacePoint {
  const eye = parts.curvature.uEye.value;
  const away = Math.hypot(position.east - eye.x, -position.north - eye.z);
  const fade = parts.waves.uWaveScale.value * displacedFraction(away);
  // The body's answer goes inside the sum, where each component still has its own frequency;
  // the fade goes outside it, because that is about the water being drawn flat at range and
  // not about anything floating on it.
  const point = surfaceAt(
    asDrawn(parts.sea, away),
    { eastMetres: position.east, northMetres: position.north },
    secondsFromStart,
    riding,
  );
  return {
    heightMetres: point.heightMetres * fade,
    slopeEast: point.slopeEast * fade,
    slopeNorth: point.slopeNorth * fade,
  };
}

/** Everything that answers to where the watchkeeper is standing. */
function standAt(parts: Switchable, eye: LocalPosition | null, heading: number): void {
  // A chart has never been drawn on a curved earth, and a bridge with no track to stand on
  // is being drawn from the plan camera, which wants the same flat world.
  parts.curvature.uCurve.value = eye ? 1 : 0;
  if (parts.terrain) parts.terrain.group.visible = eye !== null;
  if (!eye) return;

  parts.curvature.uEye.value.set(eye.east, 0, -eye.north);
  parts.water.position.set(eye.east, 0, -eye.north);
  parts.terrain?.follow(eye, heading);
}

/**
 * Twilight is drawn as night, and so is an unstated condition.
 *
 * Exported because `ui/panels.ts` has to describe what was actually drawn, and asking this
 * is the only way it can be sure it is describing the same picture. Reimplementing the rule
 * there would be two answers to one question - the fault `isPlacedAt` and `placementOf`
 * were split to avoid - and the page would go on declaring a fine day over a night.
 */
export function isNight(stated: Environment["lightCondition"]): boolean {
  return stated === "night" || stated === "twilight" || stated === undefined;
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

/** Adds the two lights and hands back the switch described on `setDiagramLighting`. */
function addLighting(scene: Scene, palette: Palette, night: boolean): (on: boolean) => void {
  const ambient = new AmbientLight(0xffffff, palette.ambient);
  // A clear day is directional: most of the light from one place, little of it diffuse. The
  // warmth is the sun's and belongs to the day - what little a night has comes from a moon,
  // which is not warm, and tinting it would be inventing a sunset.
  const key = new DirectionalLight(night ? 0xffffff : 0xfff4e2, night ? 0.25 : 1.75);
  key.position.set(1, 2, 1);
  scene.add(ambient);
  scene.add(key);

  return (on: boolean): void => {
    ambient.intensity = on ? Math.max(palette.ambient, 1.35) : palette.ambient;
    key.intensity = on ? 0.8 : night ? 0.25 : 1.75;
  };
}

interface GridControl {
  setSpacing(viewExtentMetres: number): void;
  setVisible(on: boolean): void;
}

/** Owns the one grid, replacing it when the view has moved far enough to want another. */
function addGrid(scene: Scene): GridControl {
  let grid: GridHelper | null = null;
  let spacing = 0;
  let visible = true;

  return {
    setSpacing: (viewExtentMetres: number): void => {
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
      grid.visible = visible;
      scene.add(grid);
    },
    setVisible: (on: boolean): void => {
      visible = on;
      if (grid) grid.visible = on;
    },
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
