/**
 * Land, fetched the way a bridge view needs it: coarser with distance, and only where the
 * watchkeeper is looking.
 *
 * The numbering and the placement rule are the ones the basemap already uses - `tiles.ts`
 * for Web Mercator, and one `toLocalPosition` per corner so a tile lands on the local plane
 * without the 1.2 scale error a single uniform scale would introduce. What is new is two
 * policies, and they are the whole reason this is affordable:
 *
 * - **Zoom by distance.** One screen pixel subtends about 0.0014 of the distance to it in a
 *   55-degree window, so ground samples want to be about 7 m at five kilometres and 55 m at
 *   forty. A single zoom fine enough for the near ring is an order of magnitude more bytes
 *   over the far one, buying detail nothing on screen can resolve.
 * - **Only the wedge ahead.** The other 270 degrees are behind the officer of the watch.
 *
 * Measured over the reference case: the full circle to forty-six kilometres is 70 land
 * tiles and 3.9 MB; a 90-degree wedge looking west over open water is 20 tiles and 949 kB;
 * the same wedge looking north at the coast is 46 tiles and 3.09 MB. **The bill is set by
 * how much land is in front of you, not by the policy.**
 *
 * ## Refetching is triggered by movement, not by a timer
 *
 * The basemap waits for the view to stop moving. That is right for a plan view somebody is
 * dragging and useless here: a replay's eye never stops, so a settle timer either never
 * fires or is reset every frame. And a bridge camera has no free look - it points along the
 * heading - so there is no gesture to debounce in the first place.
 *
 * So the land is refetched once the eye has walked far enough or the ship has turned far
 * enough for the answer to have changed. At twenty times speed and twelve knots that is
 * about once every twelve seconds of playback.
 */

import { BufferAttribute, BufferGeometry, Group, Mesh, type Material } from "three";

import { toLatLon, toLocalPosition, type LocalPosition } from "../core/geodesy.js";
import type { LatLon } from "../core/types.js";
import { loadHeightGrid, type HeightGrid } from "./dem.js";
import { boxOfTile, tileXOf, tileYOf, type Tile } from "./tiles.js";

const TILE_URL = "https://cyberjapandata.gsi.go.jp/xyz/dem_png/{z}/{x}/{y}.png";

/**
 * The credit, worded the way the basemap's is: the Authority asks that its tiles be named
 * and that working on them be declared, and a height field built out of them is working on
 * them. Named as the elevation set rather than as "GSI Tiles", because two different tile
 * sets are on screen in two different views and a reader should be able to tell which one
 * they are being told about.
 */
export const TERRAIN_CREDIT =
  "Made by processing GSI Tiles (elevation), Geospatial Information Authority of Japan";

/** Zoom by distance band: metres from the eye, and the zoom that covers that band. */
const RINGS = [
  { zoom: 14, from: 0, to: 6_000 },
  { zoom: 13, from: 6_000, to: 11_000 },
  { zoom: 12, from: 11_000, to: 23_000 },
  { zoom: 11, from: 23_000, to: 46_000 },
];

/** Vertices across one tile. See the note on thinning in `dem.ts`. */
const GRID = 65;

/** Half the wedge fetched. The window is 55 degrees; the rest is margin for turning. */
const HALF_ANGLE_DEGREES = 45;

/** How far the eye walks, or the bow swings, before the answer is worth asking again. */
const REFETCH_METRES = 1_500;
const REFETCH_DEGREES = 15;

export interface Terrain {
  group: Group;
  /**
   * Put the land where this eye is looking. Cheap enough to call every frame - it decides
   * for itself whether anything has moved far enough to be worth fetching.
   */
  follow(eye: LocalPosition, headingDegreesTrue: number): void;
}

/** Everything one tile needs that does not change from one tile to the next. */
interface Layer {
  group: Group;
  material: Material;
  origin: LatLon;
  announce: () => void;
  /** Null while a tile is in flight, so the same one is never asked for twice. */
  known: Map<string, Mesh | null>;
}

/**
 * Build the layer. `onFirstTile` fires once, when a tile has actually arrived - the credit
 * hangs off it, so a scene that got no land does not carry a line crediting some.
 */
export function buildTerrain(origin: LatLon, material: Material, onFirstTile: () => void): Terrain {
  const group = new Group();
  group.name = "terrain";
  const layer: Layer = {
    group,
    material,
    origin,
    announce: onceOnly(onFirstTile),
    known: new Map(),
  };
  let fetched: { eye: LocalPosition; heading: number } | null = null;

  return {
    group,
    follow: (eye, heading): void => {
      if (fetched && !hasMoved(fetched, eye, heading)) return;
      fetched = { eye, heading };
      refetch(layer, wantedTiles(eye, heading, origin));
    },
  };
}

function hasMoved(
  fetched: { eye: LocalPosition; heading: number },
  eye: LocalPosition,
  heading: number,
): boolean {
  const walked = Math.hypot(eye.east - fetched.eye.east, eye.north - fetched.eye.north);
  return walked > REFETCH_METRES || offBearing(heading, fetched.heading) > REFETCH_DEGREES;
}

/** Put what this view wants on the plane and take off what it does not. */
function refetch(layer: Layer, wanted: Tile[]): void {
  const keep = new Set(wanted.map(keyOf));
  for (const [key, mesh] of layer.known) {
    // A tile still in flight is left alone; it books its own place when it lands.
    if (keep.has(key) || !mesh) continue;
    layer.group.remove(mesh);
    mesh.geometry.dispose();
    layer.known.delete(key);
  }

  for (const tile of wanted) {
    const key = keyOf(tile);
    if (layer.known.has(key)) continue;
    layer.known.set(key, null);
    void fetchTile(layer, tile);
  }
}

async function fetchTile(layer: Layer, tile: Tile): Promise<void> {
  const loaded = await loadHeightGrid(urlOf(tile), GRID).catch(() => null);
  // Null is the sea, and it is the majority answer over a case in open water: the server
  // publishes no tile where the source model has no land. Nothing to draw is not a failure.
  if (!loaded) return;
  const mesh = tileMesh(tile, loaded.grid, layer.origin, layer.material);
  layer.known.set(keyOf(tile), mesh);
  layer.group.add(mesh);
  layer.announce();
}

/**
 * One tile as a height field, placed on its own corners and NOT rotated.
 *
 * Built straight into the world's axes - x east, z south, y up - rather than as a plane
 * turned on its side, because `curvature.ts` subtracts its displacement from the local Y
 * and may only do that where the model matrix is a pure translation.
 */
function tileMesh(tile: Tile, grid: HeightGrid, origin: LatLon, material: Material): Mesh {
  const box = boxOfTile(tile);
  const southWest = toLocalPosition({ lat: box.south, lon: box.west }, origin);
  const northEast = toLocalPosition({ lat: box.north, lon: box.east }, origin);

  const geometry = new BufferGeometry();
  const width = northEast.east - southWest.east;
  const depth = northEast.north - southWest.north;
  geometry.setAttribute("position", new BufferAttribute(heightField(grid, width, depth), 3));
  geometry.setIndex(new BufferAttribute(gridIndices(grid.size), 1));
  geometry.computeVertexNormals();

  const mesh = new Mesh(geometry, material);
  mesh.position.set(
    (southWest.east + northEast.east) / 2,
    0,
    -(southWest.north + northEast.north) / 2,
  );
  // The curve can sink a vertex by hundreds of metres, which a bounding sphere computed
  // from the flat geometry knows nothing about.
  mesh.frustumCulled = false;
  return mesh;
}

export function heightField(grid: HeightGrid, width: number, depth: number): Float32Array {
  const vertices = new Float32Array(grid.size * grid.size * 3);
  const last = grid.size - 1;

  for (let row = 0; row < grid.size; row += 1) {
    // Row 0 is the tile's north edge, and north is -Z.
    const z = -depth / 2 + (depth * row) / last;
    for (let column = 0; column < grid.size; column += 1) {
      const at = (row * grid.size + column) * 3;
      vertices[at] = -width / 2 + (width * column) / last;
      vertices[at + 1] = grid.metres[row * grid.size + column] ?? 0;
      vertices[at + 2] = z;
    }
  }
  return vertices;
}

function gridIndices(size: number): Uint32Array {
  const indices = new Uint32Array((size - 1) * (size - 1) * 6);
  let at = 0;
  for (let row = 0; row < size - 1; row += 1) {
    for (let column = 0; column < size - 1; column += 1) {
      const topLeft = row * size + column;
      const bottomLeft = topLeft + size;
      indices[at++] = topLeft;
      indices[at++] = bottomLeft;
      indices[at++] = topLeft + 1;
      indices[at++] = topLeft + 1;
      indices[at++] = bottomLeft;
      indices[at++] = bottomLeft + 1;
    }
  }
  return indices;
}

/** Every tile of every ring that falls in its band and inside the wedge ahead. */
export function wantedTiles(
  eye: LocalPosition,
  headingDegreesTrue: number,
  origin: LatLon,
): Tile[] {
  const tiles: Tile[] = [];
  for (const ring of RINGS) {
    for (const tile of tilesInBand(eye, ring, origin)) {
      const at = centreOf(tile, origin);
      const distance = Math.hypot(at.east - eye.east, at.north - eye.north);
      const reach = tileDiagonalMetres(tile, origin) / 2;
      if (distance < ring.from - reach || distance >= ring.to + reach) continue;
      // Widened by the tile's own angular size, so a tile straddling the edge of the wedge
      // is kept rather than leaving a notch in the coast at the edge of the picture.
      const margin = (Math.atan2(reach, Math.max(distance, 1)) * 180) / Math.PI;
      if (offBearing(bearingOf(eye, at), headingDegreesTrue) > HALF_ANGLE_DEGREES + margin) {
        continue;
      }
      tiles.push(tile);
    }
  }
  return tiles;
}

/** Every tile at this ring's zoom within a square of its outer radius. */
function tilesInBand(eye: LocalPosition, ring: (typeof RINGS)[number], origin: LatLon): Tile[] {
  const corner = (east: number, north: number): { x: number; y: number } => {
    const point = toLatLon({ east: eye.east + east, north: eye.north + north }, origin);
    return { x: tileXOf(point.lon, ring.zoom), y: tileYOf(point.lat, ring.zoom) };
  };
  // North is the SMALLER row index, so the north-west corner is the low end of both.
  const northWest = corner(-ring.to, ring.to);
  const southEast = corner(ring.to, -ring.to);

  const tiles: Tile[] = [];
  for (let x = Math.floor(northWest.x); x <= Math.floor(southEast.x); x += 1) {
    for (let y = Math.floor(northWest.y); y <= Math.floor(southEast.y); y += 1) {
      tiles.push({ z: ring.zoom, x, y });
    }
  }
  return tiles;
}

function centreOf(tile: Tile, origin: LatLon): LocalPosition {
  const box = boxOfTile(tile);
  const middle = { lat: (box.north + box.south) / 2, lon: (box.east + box.west) / 2 };
  return toLocalPosition(middle, origin);
}

function tileDiagonalMetres(tile: Tile, origin: LatLon): number {
  const box = boxOfTile(tile);
  const southWest = toLocalPosition({ lat: box.south, lon: box.west }, origin);
  const northEast = toLocalPosition({ lat: box.north, lon: box.east }, origin);
  return Math.hypot(northEast.east - southWest.east, northEast.north - southWest.north);
}

function bearingOf(from: LocalPosition, to: LocalPosition): number {
  return (Math.atan2(to.east - from.east, to.north - from.north) * 180) / Math.PI;
}

/** How far apart two bearings are, 0 to 180, whichever way round they were given. */
function offBearing(one: number, other: number): number {
  return Math.abs(((((one - other) % 360) + 540) % 360) - 180);
}

function keyOf(tile: Tile): string {
  return `${tile.z}/${tile.x}/${tile.y}`;
}

function urlOf(tile: Tile): string {
  return TILE_URL.replace("{z}", String(tile.z))
    .replace("{x}", String(tile.x))
    .replace("{y}", String(tile.y));
}

function onceOnly(action: () => void): () => void {
  let done = false;
  return (): void => {
    if (done) return;
    done = true;
    action();
  };
}
