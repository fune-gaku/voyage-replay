/**
 * A map under the water: raster tiles, fetched as the view needs them, laid on the plane
 * the tracks are drawn on.
 *
 * The overhead view was water and a grid. That is a correct coordinate system and it says
 * nothing about where the incident happened, and for a reconstruction meant to be watched,
 * land is the difference between a diagram and a place.
 *
 * ## Why tiles, and what it costs
 *
 * Tiles are fetched at run time rather than baked into the page. That is the opposite of
 * what the rest of this project does - `scripts/build-single.mjs` exists to leave nothing
 * to fetch - so the reason matters:
 *
 * - **The licence is written for exactly this.** The Geospatial Information Authority of
 *   Japan asks only that its tiles be credited when they are displayed live, and says the
 *   same for using them as a background in video. Downloading and storing them is
 *   reproduction, which is a different question with a different answer. On-demand keeps
 *   this in the lane that needs no permission.
 * - **Baking them is not affordable anyway.** Covering this project's reference case at a
 *   zoom worth having is about 41 MB of base64 inside the HTML, against tens of kilobytes
 *   for the same coastline as vectors.
 * - **What breaks without the network is only the map.** The ships, their lights, the
 *   tracks, the times and every panel are in the file. Offline, the page opens and replays
 *   exactly as it did before this layer existed. That is a decoration going missing, not a
 *   viewer that has rotted - which is the property `build-single.mjs` is protecting.
 *
 * The costs are real and worth writing down: an offline reader sees no land, a reader in
 * ten years may see none either, and opening the page tells the tile server which sea area
 * is being looked at. A vector coastline carried inside the scenario answers all three and
 * is the follow-up, not the thing being avoided.
 *
 * ## The layer follows the view
 *
 * The plan view zooms from tens of kilometres down to a few hundred metres - a range of
 * more than a hundred to one - and **one zoom level cannot serve that**. The first version
 * of this file fetched a fixed patch once and faded it out at both ends of the range, which
 * is what a slippy map does not do and what it was immediately obvious it should not do
 * either: the map appeared over a middling band of zooms and was missing everywhere else.
 *
 * So the level is chosen from the frame, the way every tile client does it, and the tiles
 * are refetched when the view leaves what is loaded. Two things keep that from thrashing:
 * the fetched box is padded well beyond the frame, so panning inside it costs nothing, and
 * a level is only replaced once a tile of the next one has actually arrived - otherwise the
 * map blinks out every time the zoom crosses a power of two.
 *
 * ## Placing a Mercator tile on a flat local plane
 *
 * Tiles are Web Mercator; this project works in metres east and north of the scenario
 * origin. The scale factor between them at 34 degrees north is 1.20, and the tempting
 * shortcut - one texture, scaled by that factor - is wrong by 40 m over the 22 km this
 * project's reference case spans, which is a coastline in the wrong place by more than the
 * length of the ships being drawn.
 *
 * So each tile is placed on its OWN corner coordinates, projected through the same
 * `toLocalPosition` everything else uses. In this projection a tile is an axis-aligned
 * rectangle - constant longitudes are constant eastings, constant latitudes constant
 * northings - so it is one plane, positioned and sized, with no rotation. What is left is
 * the non-linearity WITHIN a tile, and that is 7.3 m at zoom 13, 3.6 m at 14, 1.8 m at 15:
 * at or below the precision of the source data these scenarios come from, which is a tenth
 * of a second of arc, about 3 m.
 */

import {
  Group,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  SRGBColorSpace,
  TextureLoader,
} from "three";
import type { Object3D, Texture } from "three";

import { toLatLon, toLocalPosition, type LocalPosition } from "../core/geodesy.js";
import type { LatLon } from "../core/types.js";
import {
  boxOfTile,
  chooseZoom,
  groundResolutionMetres,
  tilesCovering,
  type LatLonBox,
  type Tile,
} from "./tiles.js";

/**
 * The pale map from the Geospatial Information Authority of Japan. Pale rather than the
 * standard sheet because a reconstruction is not a road map: what is wanted is the shape
 * of the land and nothing competing with the ships drawn over it.
 */
const TILE_URL = "https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png";

/** Where those tiles exist. Outside Japan the server answers 404 and no map is drawn. */
const ZOOM_LIMITS: [number, number] = [5, 18];

/**
 * How many tile pixels to put across the height of the frame, which is what picks the zoom.
 *
 * A little over a tall canvas's worth of device pixels, so a tile pixel is about a screen
 * pixel. Higher would be sharper and costs tiles as the square: the frame is padded before
 * it is covered, and at a wide aspect ratio this figure already lands near the budget below.
 */
const TARGET_TEXELS = 1024;

/** Enough for a padded frame at any reasonable aspect ratio; a ceiling rather than a target. */
const MAX_TILES = 128;

/**
 * How far past the frame to fetch. Panning inside this costs nothing, so following two
 * ships across the picture does not refetch until the view has really moved.
 */
const PADDING = 1.4;

/**
 * How long the view has to stop moving before the tiles it now wants are fetched.
 *
 * Without this, a continuous zoom fetches every level it passes through. The opening shot
 * crosses four in three and a half seconds, so pressing play asked a public server for
 * something like four hundred images, of which three levels' worth were on screen for a
 * few hundred milliseconds each on the way past.
 *
 * Waiting is also what the eye wants. While the zoom is running, the level already loaded
 * is scaled up to fill the frame - which is what every slippy map does mid-gesture - and
 * the sharper tiles arrive once there is something to be sharp about. The exception is a
 * layer with nothing on it at all: there is no picture to hold, so the first fetch goes
 * at once.
 */
const SETTLE_MS = 250;

/** Just clear of the water, and below the grid so the scale still reads over the land. */
const HEIGHT_METRES = 0.02;

/**
 * The credit, worded for a tinted map.
 *
 * The tint is a modification, and the Authority's own guidance distinguishes reproducing
 * its tiles from making something out of them. Saying "made by processing" covers both and
 * is true whichever palette is in use, so the wording does not have to change with the
 * light condition - which is exactly the sort of coupling that goes wrong quietly.
 *
 * In English, because everything else this project puts on the screen or in the repository
 * is - and a credit nobody in the audience can read is a credit that has not been given.
 * The Authority's requirement is on the substance and not on the language: name the source,
 * and say that it was worked on. Both halves are here, and the Japanese wording it renders
 * - 地理院タイル（淡色地図）を加工して作成 - is the phrasing to fall back on if a Japanese
 * audience is ever the one being addressed.
 */
export const BASEMAP_CREDIT =
  "Made by processing GSI Tiles (Pale map), Geospatial Information Authority of Japan";

/**
 * What is left of the fade, now that the level follows the view.
 *
 * Only one case can still outrun the tiles: a frame closer in than the sharpest level the
 * server publishes. There a few dozen map pixels are stretched over the whole screen, and
 * what is left is not a coastline but a smear whose edge is tens of metres from the land,
 * lying under two hulls whose separation is the thing being read off the picture. Counted
 * in tile pixels across the frame, because that is what "still a map" means independently
 * of zoom and latitude.
 */
const FADE_FULL_TEXELS = 150;
const FADE_GONE_TEXELS = 40;

/** What the plan camera is looking at: the same three numbers it is framed with. */
export interface Frame {
  centre: LocalPosition;
  /** The height of the frame in metres. Its width is this times `aspect`. */
  extentMetres: number;
  aspect: number;
}

export interface Basemap {
  group: Group;
  /** Fetch what this frame needs, drop what it does not, and fade if nothing resolves it. */
  setView(frame: Frame): void;
}

/** The tiles currently on the plane, and the box and zoom they were fetched for. */
interface Level {
  zoom: number;
  box: LatLonBox | null;
  /** Bumped per level, and used as the draw order, so a new level covers the outgoing one. */
  generation: number;
}

/**
 * Build the layer. `onFirstTile` fires once, when a tile has actually arrived - the credit
 * is hung off it, so a scene that got no map does not carry a line crediting one.
 *
 * Nothing is fetched until the first `setView`: what to fetch is a question about the
 * frame, and at construction there is not one yet.
 */
export function buildBasemap(origin: LatLon, tint: number, onFirstTile: () => void): Basemap {
  const loader = new TextureLoader();
  // Stated rather than left to the default, because it is load-bearing and invisible: a
  // texture is read by the GPU, so a cross-origin image fetched without this taints the
  // canvas and WebGL refuses to sample it. A DOM map - Leaflet, an <img> - has no such
  // rule, which is why the same tile URL can work there and fail here.
  loader.setCrossOrigin("anonymous");

  const group = new Group();
  group.name = "basemap";
  const announce = onceOnly(onFirstTile);
  const level: Level = { zoom: -1, box: null, generation: 0 };
  const layer: Layer = { group, loader, origin, tint };
  let settling: ReturnType<typeof setTimeout> | null = null;

  return {
    group,
    setView: (frame: Frame): void => {
      const visible = boxAround(frame, origin, 1);
      const padded = boxAround(frame, origin, PADDING);
      const zoom = zoomFor(padded, frame.extentMetres);

      // The zoom is half the test on purpose. Testing only whether the frame is still
      // inside what was fetched holds the map at whatever level it first loaded at, because
      // zooming IN never leaves the box - which is a map that appears at one scale and is
      // wrong at every other.
      if (zoom !== level.zoom || !level.box || !encloses(level.box, visible)) {
        settling = whenSettled(settling, level.zoom < 0, () => {
          settling = null;
          refetch(layer, level, { box: padded, zoom }, announce);
        });
      }

      const texel = groundResolutionMetres(centreLatitude(visible), level.zoom);
      const opacity = fadeAt(frame.extentMetres, texel);
      for (const mesh of group.children) materialOf(mesh).opacity = opacity;
    },
  };
}

/**
 * Hold a fetch back until the view has stopped moving, replacing any fetch already waiting.
 *
 * `atOnce` is for a layer with nothing on it: waiting is what keeps the picture that is
 * already there from being thrown away for one that has not arrived, and an empty plane has
 * no such picture.
 */
type Settling = ReturnType<typeof setTimeout> | null;

function whenSettled(waiting: Settling, atOnce: boolean, fetch: () => void): Settling {
  if (waiting !== null) clearTimeout(waiting);
  if (!atOnce) return setTimeout(fetch, SETTLE_MS);
  fetch();
  return null;
}

/** Everything a level needs that does not change between them. */
interface Layer {
  group: Group;
  loader: TextureLoader;
  origin: LatLon;
  tint: number;
}

/** What the next level is to be. */
interface Plan {
  box: LatLonBox;
  zoom: number;
}

/**
 * Put a new level on the plane and take the old one off once the new one is showing.
 *
 * Once, not immediately: the replacement's tiles are all invisible until their images land,
 * so clearing the old ones first blinks the map out every time the zoom changes. If nothing
 * of the new level ever arrives - the view has left the tile set's coverage - the old level
 * simply stays, which is better than a blank sea and is what a slippy map does too.
 */
function refetch(layer: Layer, level: Level, plan: Plan, announce: () => void): void {
  const outgoing = [...layer.group.children];
  const retire = onceOnly(() => {
    for (const mesh of outgoing) discard(layer.group, mesh);
  });

  level.zoom = plan.zoom;
  level.box = plan.box;
  level.generation += 1;

  for (const tile of tilesCovering(plan.box, plan.zoom)) {
    const mesh = tileMesh(tile, layer.origin, layer.tint);
    // Hidden until its own image lands. A tile shown before then is a flat rectangle of
    // the tint colour, which over water reads as a feature rather than as a missing one.
    mesh.visible = false;
    mesh.renderOrder = level.generation;
    fetchInto(layer.loader, tile, mesh, () => {
      announce();
      retire();
    });
    layer.group.add(mesh);
  }
}

/**
 * The coarsest level whose pixels are still smaller than the screen's, then as coarse again
 * as the tile budget demands. Asking for resolution first and affordability second is what
 * lets a berthing get metre-scale tiles and an open-water case get kilometre-scale ones
 * without either being written down anywhere.
 */
function zoomFor(box: LatLonBox, frameExtentMetres: number): number {
  const [minZoom, maxZoom] = ZOOM_LIMITS;
  const wantedTexel = frameExtentMetres / TARGET_TEXELS;
  const latitude = centreLatitude(box);

  let sharp = maxZoom;
  for (let zoom = minZoom; zoom < maxZoom; zoom += 1) {
    if (groundResolutionMetres(latitude, zoom) <= wantedTexel) {
      sharp = zoom;
      break;
    }
  }
  return chooseZoom(box, MAX_TILES, [minZoom, sharp]);
}

/** One tile, sized and placed from its own corners. See the note on placement above. */
function tileMesh(
  tile: Tile,
  origin: LatLon,
  tint: number,
): Mesh<PlaneGeometry, MeshBasicMaterial> {
  const box = boxOfTile(tile);
  const southWest = toLocalPosition({ lat: box.south, lon: box.west }, origin);
  const northEast = toLocalPosition({ lat: box.north, lon: box.east }, origin);

  const mesh = new Mesh(
    new PlaneGeometry(northEast.east - southWest.east, northEast.north - southWest.north),
    // Basic rather than standard: this is a map, and a map that dims when the scene's
    // lighting changes is a map that has started reporting the time of day.
    new MeshBasicMaterial({ color: tint, transparent: true, depthWrite: false }),
  );
  // The same rotation the water gets, which sends the plane's +Y to north and leaves the
  // image the right way up: a tile's first row is its northern edge.
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(
    (southWest.east + northEast.east) / 2,
    HEIGHT_METRES,
    -(southWest.north + northEast.north) / 2,
  );
  return mesh;
}

function fetchInto(
  loader: TextureLoader,
  tile: Tile,
  mesh: Mesh<PlaneGeometry, MeshBasicMaterial>,
  announce: () => void,
): void {
  loader.load(
    urlOf(tile),
    (texture: Texture) => {
      texture.colorSpace = SRGBColorSpace;
      mesh.material.map = texture;
      mesh.material.needsUpdate = true;
      mesh.visible = true;
      announce();
    },
    undefined,
    // Expected, not exceptional: the tile set covers Japan, and any scene near its edge
    // asks for tiles that were never drawn. Leaving the mesh hidden is the whole handler.
    () => undefined,
  );
}

function urlOf(tile: Tile): string {
  return TILE_URL.replace("{z}", String(tile.z))
    .replace("{x}", String(tile.x))
    .replace("{y}", String(tile.y));
}

/** The ground a frame shows, optionally widened. Padding is about its centre, not a corner. */
function boxAround(frame: Frame, origin: LatLon, padding: number): LatLonBox {
  const halfHeight = (frame.extentMetres / 2) * padding;
  const halfWidth = halfHeight * frame.aspect;
  const southWest = toLatLon(
    { east: frame.centre.east - halfWidth, north: frame.centre.north - halfHeight },
    origin,
  );
  const northEast = toLatLon(
    { east: frame.centre.east + halfWidth, north: frame.centre.north + halfHeight },
    origin,
  );
  return { south: southWest.lat, west: southWest.lon, north: northEast.lat, east: northEast.lon };
}

function encloses(outer: LatLonBox, inner: LatLonBox): boolean {
  return (
    outer.south <= inner.south &&
    outer.north >= inner.north &&
    outer.west <= inner.west &&
    outer.east >= inner.east
  );
}

function centreLatitude(box: LatLonBox): number {
  return (box.north + box.south) / 2;
}

function materialOf(mesh: Object3D): MeshBasicMaterial {
  return (mesh as Mesh<PlaneGeometry, MeshBasicMaterial>).material;
}

function discard(group: Group, mesh: Object3D): void {
  group.remove(mesh);
  const material = materialOf(mesh);
  material.map?.dispose();
  material.dispose();
  (mesh as Mesh<PlaneGeometry, MeshBasicMaterial>).geometry.dispose();
}

function fadeAt(viewExtentMetres: number, texelMetres: number): number {
  const texels = viewExtentMetres / texelMetres;
  return Math.min(
    Math.max((texels - FADE_GONE_TEXELS) / (FADE_FULL_TEXELS - FADE_GONE_TEXELS), 0),
    1,
  );
}

function onceOnly(action: () => void): () => void {
  let done = false;
  return (): void => {
    if (done) return;
    done = true;
    action();
  };
}
