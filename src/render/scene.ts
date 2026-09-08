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

import type { Conditions } from "../core/conditions.js";
import type { LocalPosition } from "../core/geodesy.js";
import { lightingAt, measuredSlopeVariance, type Lit } from "../core/illumination.js";
import {
  ASSUMED_DIRECTION_DEGREES_TRUE,
  seawayFrom,
  surfaceAt,
  waveComponents,
  type Riding,
  type SeaEstimate,
  type SurfacePoint,
  type WaveComponent,
} from "../core/seaway.js";
import type { Environment } from "../core/types.js";
import { sampleAt, type PreparedPoint, type PreparedTrack } from "../core/track.js";
import { buildBasemap, type Basemap, type Frame } from "./basemap.js";
import { toWorld } from "./coords.js";
import { applyCurvature, makeCurvatureUniforms, type CurvatureUniforms } from "./curvature.js";
import { setLamps, type LitLamp } from "./lamps.js";
import { buildSkyDome, setSkyBody, towardsBody } from "./sky.js";
import { buildTerrain, type Terrain } from "./terrain.js";
import {
  applyWaves,
  displacedFraction,
  drawable,
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
   * Which body is up, where, and how wide a path it lays on the water.
   *
   * **Takes `Conditions` rather than the scenario's own fields**, which is the rule this
   * whole layer answers to - and it takes them at an INSTANT, because the sky is the one
   * part of the environment that is never constant. This project's reference case runs for
   * eighty-seven minutes and nautical twilight ends eleven minutes before the collision; a
   * sky set once when the scene was built would freeze the moon where it stood at the
   * opening frame.
   *
   * It moves the key light too. One direction for the whole frame, or the water hands back
   * a moon from one bearing while the hulls are lit from another.
   */
  setSky(conditions: Conditions): void;
  /**
   * The lamps lit over this water, each of which lays a streak on it.
   *
   * Handed in rather than found, because what is lit is a question about the scenario's
   * clock and its rhythms - `render/player.ts` already answers it for the lamps themselves,
   * and asking twice is how a streak ends up under a light that is out.
   */
  setLamps(lamps: LitLamp[]): void;
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
const NIGHT = {
  sky: 0x05080e,
  zenith: 0x02030a,
  water: 0x0a121d,
  land: 0x03050a,
  ambient: 0.28,
  bodyLobe: 1,
  streak: 1,
  lampPool: 0.03,
  luxToScreen: 4,
};
const DAY = {
  sky: 0x9dc0e6,
  zenith: 0x3d7ac4,
  water: 0x1d4360,
  land: 0x6b7a5e,
  ambient: 0.55,
  bodyLobe: 0.6,
  streak: 1,
  lampPool: 0.03,
  luxToScreen: 6e-6,
};

/**
 * **How bright a reflection may draw, which is a property of the CONDITION and not of what is
 * reflected.**
 *
 * `bodyLobe` is the sun's or a full moon's own peak. `streak` and `lampPool` are what a lamp
 * gives back off the water - the first its image in it, the second the light it lands ON it,
 * which is there from every bearing and is what makes a lamp look like a lamp. Both are now
 * REFLECTANCES rather than brightnesses: a lamp's candela comes out of Rule 22 by Annex I's
 * own relation, the lux on the water are computed from it, and `luxToScreen` is the single
 * figure per condition that says what a lux draws as.
 *
 * **It is chosen so the moon and the lamps land on one scale.** A full moon is about 0.25 lx
 * and draws at `bodyLobe`, so a lux draws at four - which puts a 6 mile masthead light, at
 * 0.0018 lx on the water a hundred metres off, at about a hundredth of the moon. That is the
 * relation the night actually has, and it is why a ship's own lights do not light the sea
 * ahead of her. All of them are declared,
 * for the reason the panels give: Rule 22 states a range and no candela, cloud is never in the
 * file, and this renderer is not photometrically calibrated. What is computed is the RATIO -
 * the sun against a full moon, one phase against another - and only the absolute scale is
 * chosen here.
 *
 * **It has to be per condition, and once was not.** A night sky here is 0.003 and a day sky
 * 0.60, two hundred times apart; one number served both, and the middle of a daylight path
 * came out at 3.1 where 1.0 is white - clipped flat across a cone fifty degrees wide, which
 * is not a path but a hole. `ambient` above has been per condition all along and for exactly
 * the same reason.
 *
 * A full moon still clips at its very centre, which is what a full moon's glitter does to an
 * eye and to a camera. What must not happen is the clipping spreading over the water.
 */

/**
 * `sky` is the HORIZON's colour and `zenith` is overhead, and which is which matters twice.
 *
 * A clear sky is deepest overhead and pales towards the horizon, because a grazing line of
 * sight runs through far more air - so the pair is not decoration, it is the one thing a
 * reflection off water mostly sees. Water reflects almost nothing head-on and almost
 * everything at a graze, which puts the paler end of the gradient exactly where the sea
 * meets the sky.
 *
 * **`sky` is the HORIZON's colour, not the sky's.** The frame above the waterline is covered
 * by the dome in `render/sky.ts`, drawn from this same pair, so what fills the background is
 * only what neither the dome nor anything else covers - the plan view, where a chart is not a
 * sky. Taking the horizon's colour for that fallback is what keeps the join at the waterline
 * from showing if the dome is ever off.
 */

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
  // What shows where nothing is drawn. The dome below covers the bridge view; this is what
  // the plan view sees, and a chart is not a sky.
  scene.background = new Color(palette.sky);
  const fog = buildFog(palette, environment?.visibilityMetres, extentMetres);
  scene.fog = fog;

  const curvature = makeCurvatureUniforms();
  // Split rather than spread whole: the mesh is the scene's, the rest is the sea's.
  const { mesh: water, sky, ...sea } = addWater(scene, palette, curvature, environment);
  const { terrain, basemap } = addGround(scene, palette, curvature, ground);
  const lights = addLighting(scene, palette, night);

  // Before the grid, so the scene's children keep the order they had when this was one
  // function: water, lights, cast, grid.
  const actors = new Group();
  actors.name = "actors";
  scene.add(actors);

  const parts: Switchable = {
    ...sea,
    water,
    sky,
    basemap,
    terrain,
    fog,
    curvature,
    grid: addGrid(scene),
  };
  return { scene, actors, ...viewControls(scene, parts, lights, { extentMetres, palette }) };
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
/**
 * The components the water is built out of, or none where nothing states a sea.
 *
 * Where the source states no direction the sea still has to run somewhere, so it runs the
 * assumed way and `ui/panels.ts` says that it was assumed. A narrow spread makes the bearing
 * plainly readable off the picture, which is exactly why it cannot go undeclared.
 *
 * Filtered here rather than in the shader, so the geometry, the shading and anything floating
 * are all given the same set - and so that `ui/panels.ts`, which reports the band, reports the
 * components the water is actually made of.
 */
function drawnSea(sea: SeaEstimate | null): WaveComponent[] {
  if (!sea) return [];
  return drawable(waveComponents(sea.rough, sea.fromDegreesTrue ?? ASSUMED_DIRECTION_DEGREES_TRUE));
}

/** The water, the sky over it, and everything either of them answers to. */
interface Sea {
  mesh: Mesh;
  sky: Mesh;
  waves: WaveUniforms;
  sea: WaveComponent[];
  estimate: SeaEstimate | null;
}

function addWater(
  scene: Scene,
  palette: Palette,
  curvature: CurvatureUniforms,
  environment: Environment | undefined,
): Sea {
  const sea = seawayFrom(environment);
  // Rougher where nothing states a sea: with no waves to break it up, a glassy surface would
  // be one more thing claiming a calm.
  const material = new MeshStandardMaterial({
    color: palette.water,
    roughness: sea ? 0.34 : 0.95,
    metalness: 0.1,
  });
  applyCurvature(material, curvature);
  const waves = makeWaveUniforms();
  waves.sky.uSkyHorizon.value.setHex(palette.sky);
  waves.sky.uSkyZenith.value.setHex(palette.zenith);
  applyWaves(material, waves);
  const components = drawnSea(sea);
  setWaves(waves, components);

  // The sky goes in with the water because it IS the same sky: one set of uniforms, so the
  // two cannot come to describe different ones - which would show first at the waterline,
  // where water at a graze hands back very nearly the sky just above it.
  const mesh = buildWater(material);
  const sky = buildSkyDome(waves.sky);
  scene.add(mesh);
  scene.add(sky);
  return { mesh, sky, waves, sea: components, estimate: sea };
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
  /** The sky above the waterline. Drawn from a bridge and never over a chart. */
  sky: Mesh;
  basemap: Basemap | null;
  terrain: Terrain | null;
  water: Mesh;
  fog: Fog;
  curvature: CurvatureUniforms;
  waves: WaveUniforms;
  sea: WaveComponent[];
  /**
   * What the file said about the sea, as against what came out of it. Null where nothing
   * states one - which is not the same fact as a sea stated flat, and only this can tell them
   * apart: both draw no components at all.
   */
  estimate: SeaEstimate | null;
  grid: GridControl;
}

/** The switches the view owns, wired to everything that answers to them. */
/** Everything on `SceneParts` that is a switch rather than a thing: the whole of it but the scene. */
type Controls = Omit<SceneParts, "scene" | "actors">;

function viewControls(
  scene: Scene,
  parts: Switchable,
  lights: Lights,
  frame: { extentMetres: number; palette: Palette },
): Controls {
  const { extentMetres, palette } = frame;
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
      centreSeaOn(parts, frame.centre);
    },
    setDiagramView: (on: boolean): void => {
      setDiagram(scene, parts, lights.setDiagram, on);
    },
    setEye: (eye: LocalPosition | null, headingDegreesTrue: number): void => {
      standAt(parts, eye, headingDegreesTrue);
    },
    ...seaControls(parts, lights, palette),
  };
}

/** What a lamp gives back off the water in this condition. See `Palette`. */
function exposureOf(palette: Palette): { streak: number; pool: number; luxToScreen: number } {
  return { streak: palette.streak, pool: palette.lampPool, luxToScreen: palette.luxToScreen };
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
  lights: Lights,
  palette: Palette,
): Pick<Controls, "setSeaClock" | "setPixelAngle" | "setSky" | "setLamps" | "drawnSurfaceAt"> {
  return {
    setLamps: (lamps: LitLamp[]): void => {
      setLamps(parts.waves.lamps, lamps, exposureOf(palette));
    },
    setSky: (conditions: Conditions): void => {
      // The night the PICTURE is drawn in, not the one the sun is in: a file saying night
      // with the sun computed above the horizon is a transcription error, and a sun path
      // over a night palette would report it in a picture instead of in a sentence.
      const lit = lightingAt(conditions, palette === NIGHT);
      lights.pointAt(lit);
      // **The width of the path is the sea's, and the sea is the one that is DRAWN.** Its
      // slope is a third of a real one, so the missing roughness goes into the body's own
      // lobe - and how much is missing is settled per fragment in the shader, because the
      // shading itself drops components with range. See `core/illumination.ts`.
      // **No path on a chart**, which is the judgement the lighting, the map tint and the
      // grid have all already made: a plan view is a diagram, and a glitter path drawn on
      // one would be a picture of a sea seen from twelve kilometres up. `uWaveScale` is the
      // same flag the waves answer to, asked rather than worked out a second time.
      const drawnAsSea = parts.waves.uWaveScale.value > 0;
      setSkyBody(parts.waves.sky, lit, drawnAsSea ? measuredOver(parts) : null, palette.bodyLobe);
    },
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
  // A chart has never had a sky drawn over it - the same judgement this function already
  // makes about the lighting, the map's tint and the grid.
  parts.sky.visible = !on;
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
 * The slope the sea's reflection has to add up to, which the shader shares out per fragment.
 *
 * **Null and zero are different answers.** No sea stated means no slope to take, and a
 * mirror-sharp body on water this tool decided to draw flat would assert a calm nobody
 * recorded. A sea stated flat is a calm on somebody's authority, and calm water mirrors.
 * Asking the components alone would collapse the two, since both come out empty.
 *
 * The height is the DRAWN one, so the target answers to the sea in the picture rather than
 * to a figure the page prints.
 */
function measuredOver(parts: Switchable): number | null {
  if (!parts.estimate) return null;
  const height = parts.sea.reduce((total, wave) => total + wave.amplitudeMetres ** 2 / 2, 0);
  return measuredSlopeVariance(4 * Math.sqrt(height));
}

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

  centreSeaOn(parts, eye);
  parts.terrain?.follow(eye, heading);
}

/**
 * Where the sea is dense, and where every distance in it is measured from. **One call, so the
 * two cannot come apart.**
 *
 * The disc's rings grow from its own centre, and the band-limiting in `waves.ts` asks how far
 * a point is from the eye - so if the eye and the centre were ever different points, the
 * shader would judge the mesh's fineness at the wrong radius and put waves on triangles too
 * big to hold them. They are set together here because the two views set them at different
 * moments: a bridge frame from the watchkeeper's position, a plan frame from what the camera
 * is over, and a bridge view whose own track has run out draws with whichever ran last.
 */
function centreSeaOn(parts: Switchable, at: LocalPosition): void {
  parts.curvature.uEye.value.set(at.east, 0, -at.north);
  parts.water.position.set(at.east, 0, -at.north);
  // The sky goes with them. A dome left at the origin turns as the eye crosses a scenario -
  // fifty kilometres of radius against a few of travel is a visible parallax in a sky, which
  // nothing in the world has.
  parts.sky.position.set(at.east, 0, -at.north);
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

/** The two lights, the switch described on `setDiagramLighting`, and where the key points. */
interface Lights {
  setDiagram: (on: boolean) => void;
  /**
   * Point the key light at the body the water is reflecting, and dim it with that body.
   *
   * **One direction for the whole frame.** A sea handing back a moon on 191 degrees while
   * the hulls are lit from somewhere else is one picture making two claims - the failure
   * this project keeps meeting - and the direction has been computable all along:
   * `core/celestial.ts` has had it since the panels started printing it.
   *
   * **Null puts the directional light out rather than leaving it where it was.** There is
   * then no body: a moonless night has no light with a direction in it, so nothing has a lit
   * side and a shaded one, and the scene is carried by the ambient alone. Leaving the light
   * standing would light the hulls from wherever the moon was before it set - which makes a
   * frame depend on how the viewer got to it, since scrubbing backwards never restores it.
   *
   * **And the phase dims it, as it dims the water.** A page saying a half moon is a ninth of
   * a full one, over a picture whose lane fades while the hulls keep their moonlight, is the
   * same frame making two claims about how much light there was.
   */
  pointAt: (lit: Lit | null) => void;
}

function addLighting(scene: Scene, palette: Palette, night: boolean): Lights {
  const ambient = new AmbientLight(0xffffff, palette.ambient);
  // A clear day is directional: most of the light from one place, little of it diffuse. The
  // warmth is the sun's and belongs to the day - what little a night has comes from a moon,
  // which is not warm, and tinting it would be inventing a sunset.
  const key = new DirectionalLight(night ? 0xffffff : 0xfff4e2, night ? 0.25 : 1.75);
  key.position.set(1, 2, 1);
  scene.add(ambient);
  scene.add(key);

  // Both are held rather than read back off the light, because the two callers arrive in
  // either order within a frame and each has to leave the other's decision standing.
  let diagram = false;
  // How much of the full figure the body is worth: one for the sun and for a full moon, less
  // for every other phase, zero when nothing is up. The night's own 0.25 is therefore a FULL
  // moon's, which is the same declaration `BRIGHTEST_LOBE` makes about the water.
  let share = 1;
  const apply = (): void => {
    ambient.intensity = diagram ? Math.max(palette.ambient, 1.35) : palette.ambient;
    // A chart is lit for reading and answers to nothing in the sky; a bridge view is lit by
    // whatever is up there, and by nothing at all when nothing is.
    key.intensity = diagram ? 0.8 : (night ? 0.25 : 1.75) * share;
  };

  return {
    setDiagram: (on: boolean): void => {
      diagram = on;
      apply();
    },
    // A directional light in three shines from its position towards the origin, so the
    // position IS the direction to the body - scaled up only to keep it clear of the scene.
    pointAt: (lit: Lit | null): void => {
      share = lit ? Math.min(lit.relativeBrightness, 1) : 0;
      if (lit) key.position.copy(towardsBody(lit)).multiplyScalar(1000);
      apply();
    },
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
