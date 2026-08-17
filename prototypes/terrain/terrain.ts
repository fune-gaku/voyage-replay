/**
 * Land, fetched the way a bridge view actually needs it: coarser with distance, and only
 * where the eye is pointing.
 *
 * The tile arithmetic and the placement rule are the ones already in the renderer -
 * `render/tiles.ts` for the numbering, and one `toLocalPosition` per corner so a Mercator
 * tile lands on the local plane without the 1.2 scale error. Nothing here reinvents them;
 * proving that they carry over unchanged is half the point of this prototype.
 *
 * What is new is two policies, and they are what makes it affordable:
 *
 * - **Zoom by distance.** One screen pixel subtends about 0.0014 of the distance to it in a
 *   55-degree window, so ground samples want to be about 7 m at five kilometres and 55 m at
 *   forty. A single zoom fine enough for the near ring would be an order of magnitude more
 *   bytes over the far one, for detail nothing on screen can resolve.
 * - **Only the wedge ahead.** The other 270 degrees are behind the officer of the watch.
 *
 * Measured from the reference case, all of it land the source actually has: the full circle
 * out to forty-six kilometres is 70 tiles and 3.9 MB, a 90-degree wedge looking west over
 * open water is 949 kB, and the same wedge looking north at the coast is 3.1 MB. **The cost
 * is set by how much land is in front of you, not by the policy.** The cheapest lever left
 * is the far ring: taking 23-46 km at zoom 10 rather than 11 puts that north-facing wedge at
 * 1.9 MB - 40 percent off, for ground samples of 127 m at a distance where a screen pixel is
 * 55 m. Worth doing if the far skyline survives it, which is a thing to look at rather than
 * to reason about.
 */

import { BufferAttribute, BufferGeometry, Group, Mesh, type Material } from "three";

import { toLatLon, toLocalPosition, type LocalPosition } from "../../src/core/geodesy.js";
import type { LatLon } from "../../src/core/types.js";
import { boxOfTile, tileXOf, tileYOf, type Tile } from "../../src/render/tiles.js";
import { loadHeightGrid, type HeightGrid } from "./dem.js";

const TILE_URL = "https://cyberjapandata.gsi.go.jp/xyz/dem_png/{z}/{x}/{y}.png";

export const DEM_CREDIT =
  "Made by processing GSI Tiles (elevation, DEM10B), Geospatial Information Authority of Japan";

/** Zoom by distance band. Metres, and the zoom to cover that band with. */
const RINGS = [
  { zoom: 14, from: 0, to: 6_000 },
  { zoom: 13, from: 6_000, to: 11_000 },
  { zoom: 12, from: 11_000, to: 23_000 },
  { zoom: 11, from: 23_000, to: 46_000 },
];

/** Vertices across one tile. See the note on thinning in `dem.ts`. */
const GRID = 65;

export interface TerrainStats {
  requested: number;
  land: number;
  kilobytes: number;
  pending: number;
  highestMetres: number;
}

export interface Terrain {
  group: Group;
  /** Fetch what this eye and heading want, and drop what they do not. */
  update(eye: LocalPosition, headingDegreesTrue: number, halfAngleDegrees: number): void;
  stats: TerrainStats;
}

/** Everything a tile needs that does not change from one to the next. */
interface Layer {
  group: Group;
  material: Material;
  origin: LatLon;
  stats: TerrainStats;
  /** Null while a tile is in flight, so the same one is not asked for twice. */
  known: Map<string, Mesh | null>;
}

export function buildTerrain(origin: LatLon, material: Material): Terrain {
  const group = new Group();
  group.name = "terrain";
  const stats: TerrainStats = { requested: 0, land: 0, kilobytes: 0, pending: 0, highestMetres: 0 };
  const layer: Layer = { group, material, origin, stats, known: new Map() };

  return {
    group,
    stats,
    update: (eye, heading, halfAngle): void => {
      const wanted = wantedTiles(eye, heading, halfAngle, origin);
      prune(layer, new Set(wanted.map(keyOf)));
      for (const tile of wanted) {
        const key = keyOf(tile);
        if (layer.known.has(key)) continue;
        layer.known.set(key, null);
        void fetchTile(layer, tile);
      }
    },
  };
}

/** Drop what the view no longer wants. Tiles still in flight are left to arrive. */
function prune(layer: Layer, keep: Set<string>): void {
  for (const [key, mesh] of layer.known) {
    if (keep.has(key) || !mesh) continue;
    layer.group.remove(mesh);
    mesh.geometry.dispose();
    layer.known.delete(key);
  }
}

async function fetchTile(layer: Layer, tile: Tile): Promise<void> {
  const { stats } = layer;
  stats.requested += 1;
  stats.pending += 1;
  try {
    const loaded = await loadHeightGrid(urlOf(tile), GRID);
    // Null is the sea. It is the majority answer over a case in open water and costs one
    // request; there is nothing to draw and nothing to record.
    if (!loaded) return;
    stats.land += 1;
    stats.kilobytes += loaded.bytes / 1024;
    stats.highestMetres = Math.max(stats.highestMetres, loaded.grid.highestMetres);
    const mesh = tileMesh(tile, loaded.grid, layer.origin, layer.material);
    layer.known.set(keyOf(tile), mesh);
    layer.group.add(mesh);
  } finally {
    stats.pending -= 1;
  }
}

/**
 * One tile as a height field, placed on its own corners and NOT rotated.
 *
 * Built straight into the world's axes - x east, z south, y up - rather than as a plane
 * turned on its side, because the curvature material subtracts from the local Y and can
 * only do that where the model matrix is a pure translation.
 */
function tileMesh(tile: Tile, grid: HeightGrid, origin: LatLon, material: Material): Mesh {
  const box = boxOfTile(tile);
  const southWest = toLocalPosition({ lat: box.south, lon: box.west }, origin);
  const northEast = toLocalPosition({ lat: box.north, lon: box.east }, origin);
  const width = northEast.east - southWest.east;
  const depth = northEast.north - southWest.north;

  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(heightField(grid, width, depth), 3));
  geometry.setIndex(new BufferAttribute(gridIndices(grid.size), 1));
  geometry.computeVertexNormals();

  const mesh = new Mesh(geometry, material);
  mesh.position.set(
    (southWest.east + northEast.east) / 2,
    0,
    -(southWest.north + northEast.north) / 2,
  );
  // The curvature displacement can sink a vertex by hundreds of metres, which the bounding
  // sphere computed from the flat geometry does not know about.
  mesh.frustumCulled = false;
  return mesh;
}

function heightField(grid: HeightGrid, width: number, depth: number): Float32Array {
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

/** Every tile of every ring that falls in the band and inside the wedge ahead. */
function wantedTiles(
  eye: LocalPosition,
  headingDegreesTrue: number,
  halfAngleDegrees: number,
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
      // is kept rather than leaving a notch in the coastline at the edge of the picture.
      const margin = (Math.atan2(reach, Math.max(distance, 1)) * 180) / Math.PI;
      if (offBow(eye, at, headingDegreesTrue) > halfAngleDegrees + margin) continue;
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
  return toLocalPosition(
    { lat: (box.north + box.south) / 2, lon: (box.east + box.west) / 2 },
    origin,
  );
}

function tileDiagonalMetres(tile: Tile, origin: LatLon): number {
  const box = boxOfTile(tile);
  const southWest = toLocalPosition({ lat: box.south, lon: box.west }, origin);
  const northEast = toLocalPosition({ lat: box.north, lon: box.east }, origin);
  return Math.hypot(northEast.east - southWest.east, northEast.north - southWest.north);
}

/** How far off the bow a point lies, 0 right ahead and 180 right astern. */
function offBow(eye: LocalPosition, target: LocalPosition, headingDegreesTrue: number): number {
  const bearing = (Math.atan2(target.east - eye.east, target.north - eye.north) * 180) / Math.PI;
  const difference = bearing - headingDegreesTrue;
  return Math.abs((((difference % 360) + 540) % 360) - 180);
}

function keyOf(tile: Tile): string {
  return `${tile.z}/${tile.x}/${tile.y}`;
}

function urlOf(tile: Tile): string {
  return TILE_URL.replace("{z}", String(tile.z))
    .replace("{x}", String(tile.x))
    .replace("{y}", String(tile.y));
}
