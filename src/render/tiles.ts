/**
 * Web Mercator tile arithmetic - the numbering every XYZ tile server uses.
 *
 * Nothing here touches three.js or the network. It answers three questions: which tiles
 * cover a box of latitude and longitude, what box one tile covers, and how many metres of
 * ground one of its pixels is worth. The last is what decides whether a raster basemap is
 * still telling the truth at a given zoom.
 *
 * Two things about the numbering are easy to get backwards and both look plausible:
 *
 * - **Y counts from the north.** Tile (0,0) is the top-left of the world, so the tile row
 *   for the NORTH edge of a box is the SMALLER index. Reading it the other way produces a
 *   map that is upside down only where the box is tall enough to notice.
 * - **Y is not linear in latitude.** Mercator stretches towards the poles, which is why
 *   this file computes it through a logarithm rather than by interpolation. Placing tiles
 *   by linear interpolation of latitude puts the coastline tens of metres out - see
 *   `render/basemap.ts` for the measured figure.
 */

/** Degrees. `west`/`east` are longitudes, `south`/`north` latitudes. */
export interface LatLonBox {
  south: number;
  west: number;
  north: number;
  east: number;
}

export interface Tile {
  z: number;
  x: number;
  y: number;
}

const TILE_PIXELS = 256;
const EARTH_RADIUS_METRES = 6378137;
const EQUATOR_METRES = 2 * Math.PI * EARTH_RADIUS_METRES;

/**
 * Where Web Mercator stops. The projection sends the poles to infinity, so every tile
 * scheme cuts it off at the latitude that makes the world square - about 85.05 degrees.
 * Nothing this project reconstructs happens there, but a clamp is cheaper than an
 * Infinity propagating silently into a tile index.
 */
const MERCATOR_LIMIT_DEGREES = 85.05112878;

/** Metres of ground per tile pixel. Falls with latitude, because Mercator stretches. */
export function groundResolutionMetres(latitudeDegrees: number, zoom: number): number {
  return (EQUATOR_METRES * Math.cos(toRadians(latitudeDegrees))) / (TILE_PIXELS * 2 ** zoom);
}

/** Fractional tile column. The whole part is the tile, the rest is the position in it. */
export function tileXOf(longitudeDegrees: number, zoom: number): number {
  return ((longitudeDegrees + 180) / 360) * 2 ** zoom;
}

/** Fractional tile row, counted from the north. */
export function tileYOf(latitudeDegrees: number, zoom: number): number {
  const latitude = toRadians(
    clamp(latitudeDegrees, -MERCATOR_LIMIT_DEGREES, MERCATOR_LIMIT_DEGREES),
  );
  const mercator = Math.log(Math.tan(Math.PI / 4 + latitude / 2));
  return ((1 - mercator / Math.PI) / 2) * 2 ** zoom;
}

export function longitudeOfTileX(x: number, zoom: number): number {
  return (x / 2 ** zoom) * 360 - 180;
}

export function latitudeOfTileY(y: number, zoom: number): number {
  return toDegrees(Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / 2 ** zoom))));
}

/** The ground one tile covers. Its north edge is at the SMALLER row index. */
export function boxOfTile(tile: Tile): LatLonBox {
  return {
    north: latitudeOfTileY(tile.y, tile.z),
    south: latitudeOfTileY(tile.y + 1, tile.z),
    west: longitudeOfTileX(tile.x, tile.z),
    east: longitudeOfTileX(tile.x + 1, tile.z),
  };
}

/** Inclusive tile indices. */
interface TileRange {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

function rangeCovering(box: LatLonBox, zoom: number): TileRange {
  const last = 2 ** zoom - 1;
  const minX = clamp(Math.floor(tileXOf(box.west, zoom)), 0, last);
  const minY = clamp(Math.floor(tileYOf(box.north, zoom)), 0, last);
  return {
    minX,
    minY,
    // `ceil - 1` rather than `floor`, so an edge landing exactly on a tile boundary does
    // not pull in the next tile along. The max() is for a box narrower than one tile,
    // where that arithmetic would otherwise end one short of where it started.
    maxX: Math.max(minX, clamp(Math.ceil(tileXOf(box.east, zoom)) - 1, 0, last)),
    maxY: Math.max(minY, clamp(Math.ceil(tileYOf(box.south, zoom)) - 1, 0, last)),
  };
}

export function tileCount(box: LatLonBox, zoom: number): number {
  const range = rangeCovering(box, zoom);
  return (range.maxX - range.minX + 1) * (range.maxY - range.minY + 1);
}

export function tilesCovering(box: LatLonBox, zoom: number): Tile[] {
  const range = rangeCovering(box, zoom);
  const tiles: Tile[] = [];
  for (let x = range.minX; x <= range.maxX; x += 1) {
    for (let y = range.minY; y <= range.maxY; y += 1) {
      tiles.push({ z: zoom, x, y });
    }
  }
  return tiles;
}

/**
 * The sharpest zoom whose tile count fits the budget.
 *
 * A budget rather than a fixed zoom, because the scale of a scenario is not knowable in
 * advance: a collision in open water spans forty kilometres and one alongside a berth
 * spans four hundred metres, and the same rule has to serve both. Counting tiles asks the
 * question the right way round - how much detail can this scene afford - instead of
 * fixing a resolution that is wasteful at one end and useless at the other.
 *
 * Falls back to the coarsest zoom rather than refusing: a box big enough to blow the
 * budget at every level still deserves whatever map can be drawn over it.
 */
export function chooseZoom(box: LatLonBox, maxTiles: number, zoomLimits: [number, number]): number {
  const [minZoom, maxZoom] = zoomLimits;
  for (let zoom = maxZoom; zoom > minZoom; zoom -= 1) {
    if (tileCount(box, zoom) <= maxTiles) return zoom;
  }
  return minZoom;
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), high);
}

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

function toDegrees(radians: number): number {
  return (radians * 180) / Math.PI;
}
