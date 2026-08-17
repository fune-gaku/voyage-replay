/**
 * Reading the Geospatial Information Authority's elevation tiles.
 *
 * The PNG form, not the text one: on the same tile, `dem_png` is 47.8 kB against 329 kB for
 * `dem/*.txt`. Seven times the bytes for the same numbers.
 *
 * Decoding is the published formula - x = 2^16 R + 2^8 G + B, one unit is a centimetre,
 * x = 2^23 is no data, and above it the value is negative. What the formula does not say is
 * that **the sea is not a height of zero, it is a 404**: outside the coverage of the source
 * model there is no tile at all. That is the single reason this layer is affordable over a
 * case in open water, so it is handled as the normal answer rather than as an error.
 *
 * Unlike a basemap tile, this one has its pixels read rather than sampled, which needs the
 * server to allow it - a canvas tainted by a cross-origin image refuses `getImageData`.
 * These tiles carry `Access-Control-Allow-Origin: *` and survive it. A `fetch` is used
 * rather than three's `TextureLoader` so that the bytes can be counted on the way past.
 */

/** One tile's heights, thinned to a grid of `size` x `size` vertices. */
export interface HeightGrid {
  size: number;
  /** Row-major from the north-west corner - the image's own row order. */
  metres: Float32Array;
  highestMetres: number;
}

export interface LoadedTile {
  grid: HeightGrid;
  bytes: number;
}

const NO_DATA = 0x800000;
const SIGN_WRAP = 0x1000000;
const UNIT_METRES = 0.01;

/**
 * What a no-data pixel becomes. Just below the water rather than exactly on it, so the sea
 * inside a coastal tile and the water surface are not coplanar and no shoreline in the
 * scene z-fights along its whole length.
 */
export const SEA_METRES = -1;

/** Fetch and decode one tile, or null where the server has none - which means sea. */
export async function loadHeightGrid(url: string, size: number): Promise<LoadedTile | null> {
  const response = await fetch(url);
  if (!response.ok) return null;

  const bytes = await response.arrayBuffer();
  const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
  const width = bitmap.width;
  const pixels = readPixels(bitmap, width);
  bitmap.close();

  return { grid: thin(pixels, width, size), bytes: bytes.byteLength };
}

function readPixels(bitmap: ImageBitmap, width: number): Uint8ClampedArray {
  const canvas = new OffscreenCanvas(width, bitmap.height);
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("an elevation tile needs a 2d canvas and this browser gave none");
  context.drawImage(bitmap, 0, 0);
  return context.getImageData(0, 0, width, bitmap.height).data;
}

/**
 * Thin the tile's samples down to the grid that is actually drawn.
 *
 * Measured: reading all 65536 pixels of a tile costs 15.9 ms, which is a dropped frame per
 * tile on the main thread. At 65 vertices a side it is about a millisecond, and 65 vertices
 * across a zoom-13 tile is a sample every 63 m - under a screen pixel at the distance that
 * zoom is used for.
 *
 * Nearest-neighbour, so a sharp summit falling between samples is lost. A maximum filter
 * would keep the skyline honest and is the obvious next thing to try; it is not in yet
 * because nothing has been seen to go wrong from it.
 */
export function thin(pixels: Uint8ClampedArray, width: number, size: number): HeightGrid {
  const metres = new Float32Array(size * size);
  let highestMetres = SEA_METRES;

  for (let row = 0; row < size; row += 1) {
    const y = Math.round((row * (width - 1)) / (size - 1));
    for (let column = 0; column < size; column += 1) {
      const x = Math.round((column * (width - 1)) / (size - 1));
      const height = heightAt(pixels, (y * width + x) * 4);
      metres[row * size + column] = height;
      if (height > highestMetres) highestMetres = height;
    }
  }

  return { size, metres, highestMetres };
}

/** One pixel, by the published formula. Exported so a test can hold it to that formula. */
export function heightAt(pixels: Uint8ClampedArray, index: number): number {
  const r = pixels[index] ?? 0;
  const g = pixels[index + 1] ?? 0;
  const b = pixels[index + 2] ?? 0;
  const value = (r << 16) | (g << 8) | b;
  if (value === NO_DATA) return SEA_METRES;
  return (value < NO_DATA ? value : value - SIGN_WRAP) * UNIT_METRES;
}
