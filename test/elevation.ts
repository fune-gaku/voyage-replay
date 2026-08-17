import { vi } from "vitest";

/**
 * The elevation tile server and the canvas that reads its pixels, stood in for.
 *
 * Shared rather than written twice, because two suites need it for opposite reasons.
 * `terrain.spec.ts` wants land to arrive so it can check what got drawn; `player.spec.ts`
 * wants the sea, so that entering a bridge view in a test does not put a hundred real
 * requests on a public server - and a `fetch` left unstubbed does exactly that, quietly,
 * because nothing waits for the promises.
 *
 * None of this needs a browser. A height field wants three things a basemap does not -
 * the bytes counted, the pixels read rather than sampled, and therefore a canvas round
 * trip - and all three answer to a stand-in, which is the same finding `record.ts` and
 * `player.ts` produced when their exclusions were checked instead of assumed.
 */
export interface ElevationServer {
  /** Every URL asked for, in order. */
  asked: string[];
  /** What the tiles contain, north-west first, in metres. NaN is the no-data value. */
  heights: number[];
  /** With this on, every request answers 404 - which is what the sea does. */
  sea: boolean;
}

/** Encode heights the way the Authority encodes them: x = 2^16 R + 2^8 G + B, in cm. */
export function encodeHeights(heights: number[]): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(heights.length * 4);
  for (const [index, metres] of heights.entries()) {
    const raw = Number.isNaN(metres) ? 0x800000 : Math.round(metres * 100);
    const value = raw < 0 ? raw + 0x1000000 : raw;
    pixels[index * 4] = (value >> 16) & 0xff;
    pixels[index * 4 + 1] = (value >> 8) & 0xff;
    pixels[index * 4 + 2] = value & 0xff;
    pixels[index * 4 + 3] = 255;
  }
  return pixels;
}

/**
 * Install the stand-ins. Returns the server, whose fields can be written between calls to
 * change what the next request answers. Undo with `vi.unstubAllGlobals()`.
 */
export function stubElevationServer(sea = false): ElevationServer {
  const server: ElevationServer = {
    asked: [],
    heights: Array.from({ length: 16 }, (_, i) => i * 10),
    sea,
  };

  vi.stubGlobal("fetch", (url: string) => {
    server.asked.push(url);
    if (server.sea) return Promise.resolve({ ok: false });
    return Promise.resolve({ ok: true, arrayBuffer: () => Promise.resolve(new ArrayBuffer(2048)) });
  });
  vi.stubGlobal("createImageBitmap", () =>
    Promise.resolve({ width: 4, height: 4, close: () => undefined }),
  );
  vi.stubGlobal(
    "OffscreenCanvas",
    class {
      getContext(): unknown {
        return {
          drawImage: (): undefined => undefined,
          getImageData: (): { data: Uint8ClampedArray } => ({
            data: encodeHeights(server.heights),
          }),
        };
      }
    },
  );

  return server;
}

/** Let every fetch that has been started run to completion. */
export async function settleTiles(): Promise<void> {
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
}
