/**
 * Captions drawn INTO the picture: the time in one corner, the map's source in another.
 *
 * They would be less work as elements sitting over the canvas, and they would be wrong
 * there. This project records with `canvas.captureStream()`, which copies the drawing
 * buffer and nothing else - so anything in the page around the canvas is absent from every
 * video the page produces. Both of these are things a frame has to be able to say for
 * itself once it has left this page: what moment it is, and where its map came from.
 *
 * The clock does more than label the recording. The plan view draws its map at the same
 * brightness whatever the light condition, because a chart that follows the sun is a chart
 * nobody can read at night - and having given that cue up, the picture has to state the
 * time some other way or a night collision reads as an afternoon one.
 *
 * Nothing touches the document until a caption is given words, so a build with nothing to
 * say never asks for a canvas.
 */

import {
  CanvasTexture,
  Mesh,
  MeshBasicMaterial,
  OrthographicCamera,
  PlaneGeometry,
  SRGBColorSpace,
  Scene,
} from "three";

const FONT_PIXELS = 13;
const PADDING_PIXELS = 6;
const MARGIN_PIXELS = 10;

/** Drawn at twice the size and shown at half, so it survives a high-density display. */
const SUPERSAMPLE = 2;

/** Which corner a caption is pinned to. Both are on the right; nothing is on the left yet. */
export type Corner = "top-right" | "bottom-right";

/**
 * How the words are set.
 *
 * `figures` is monospaced, which matters more than it looks: a clock in a proportional face
 * changes width as the digits change, so the caption twitches every second and its geometry
 * is rebuilt every time it does.
 */
export type CaptionFace = "text" | "figures";

const FACES: Record<CaptionFace, string> = {
  text: "ui-sans-serif, system-ui, sans-serif",
  figures: "ui-monospace, SFMono-Regular, Menlo, monospace",
};

export interface Caption {
  /** The words to show. Empty says nothing and draws nothing. */
  set(text: string): void;
}

export interface Overlay {
  readonly scene: Scene;
  readonly camera: OrthographicCamera;
  /** Whether anything is on it, so a frame with nothing to say costs no second pass. */
  readonly showing: boolean;
  caption(corner: Corner, face: CaptionFace): Caption;
  resize(widthPixels: number, heightPixels: number): void;
}

/**
 * An overlay whose camera measures in canvas pixels rather than in metres.
 *
 * The scene it sits over is in metres and is looked at through two cameras that both move;
 * a caption has to be a fixed size in the corner of the frame whichever of them is in use
 * and whatever the canvas has been resized to. A second pass with its own pixel-space
 * camera is the version of that with no arithmetic in it to get wrong.
 */
export function buildOverlay(): Overlay {
  const scene = new Scene();
  scene.name = "overlay";
  const camera = new OrthographicCamera(0, 1, 1, 0, 0, 10);
  camera.position.z = 1;

  const plaques: Plaque[] = [];
  const frame = { width: 1, height: 1 };

  return {
    scene,
    camera,
    get showing(): boolean {
      return plaques.some((plaque) => plaque.mesh.visible);
    },
    caption: (corner: Corner, face: CaptionFace): Caption =>
      addCaption(scene, plaques, frame, newPlaque(corner, FACES[face])),
    resize(widthPixels: number, heightPixels: number): void {
      frame.width = Math.max(widthPixels, 1);
      frame.height = Math.max(heightPixels, 1);
      camera.right = frame.width;
      camera.top = frame.height;
      camera.updateProjectionMatrix();
      for (const plaque of plaques) place(plaque, frame);
    },
  };
}

function addCaption(scene: Scene, plaques: Plaque[], frame: Frame, plaque: Plaque): Caption {
  scene.add(plaque.mesh);
  plaques.push(plaque);
  return {
    set: (text: string): void => {
      write(plaque, text);
      place(plaque, frame);
    },
  };
}

/** One caption: its mesh, and the canvas its words are painted on. */
interface Plaque {
  corner: Corner;
  font: string;
  mesh: Mesh<PlaneGeometry, MeshBasicMaterial>;
  canvas: HTMLCanvasElement | null;
  text: string;
  width: number;
  height: number;
}

interface Frame {
  width: number;
  height: number;
}

function newPlaque(corner: Corner, family: string): Plaque {
  const mesh = new Mesh(new PlaneGeometry(1, 1), new MeshBasicMaterial({ transparent: true }));
  mesh.visible = false;
  return {
    corner,
    font: `${FONT_PIXELS * SUPERSAMPLE}px ${family}`,
    mesh,
    canvas: null,
    text: "",
    width: 1,
    height: 1,
  };
}

/**
 * Repaint a caption, and rebuild its geometry only if the words changed size.
 *
 * A clock is written afresh many times a second at any useful playback speed. Reusing the
 * canvas and telling the texture it is stale is what keeps that from being a new geometry,
 * a new texture and a discarded pair of both, sixty times a second.
 */
function write(plaque: Plaque, text: string): void {
  plaque.mesh.visible = text !== "";
  if (text === plaque.text || text === "") return;
  plaque.text = text;

  const context = contextFor(plaque);
  const wanted = Math.ceil(context.measureText(text).width) + PADDING_PIXELS * 2 * SUPERSAMPLE;
  if (wanted !== context.canvas.width) resizeCanvas(plaque, context, wanted);

  paint(context, plaque.font, text);
  plaque.mesh.material.map = textureFor(plaque, context.canvas);
  plaque.mesh.material.needsUpdate = true;
}

function contextFor(plaque: Plaque): CanvasRenderingContext2D {
  plaque.canvas ??= document.createElement("canvas");
  const context = plaque.canvas.getContext("2d");
  if (!context) throw new Error("a caption needs a 2d canvas and this browser gave none");
  context.font = plaque.font;
  return context;
}

/** Sizing a canvas resets its context, so the geometry and the font follow it, not vice versa. */
function resizeCanvas(plaque: Plaque, context: CanvasRenderingContext2D, width: number): void {
  context.canvas.width = width;
  context.canvas.height = (FONT_PIXELS + PADDING_PIXELS * 2) * SUPERSAMPLE;
  plaque.width = width / SUPERSAMPLE;
  plaque.height = context.canvas.height / SUPERSAMPLE;

  plaque.mesh.geometry.dispose();
  plaque.mesh.geometry = new PlaneGeometry(plaque.width, plaque.height);
}

function paint(context: CanvasRenderingContext2D, font: string, text: string): void {
  const { width, height } = context.canvas;
  context.clearRect(0, 0, width, height);
  context.fillStyle = "rgba(0, 0, 0, 0.45)";
  context.fillRect(0, 0, width, height);
  context.font = font;
  context.fillStyle = "rgba(255, 255, 255, 0.92)";
  context.textBaseline = "middle";
  context.fillText(text, PADDING_PIXELS * SUPERSAMPLE, height / 2);
}

/** One texture per caption, replaced only when the canvas underneath it was replaced. */
function textureFor(plaque: Plaque, canvas: HTMLCanvasElement): CanvasTexture {
  const existing = plaque.mesh.material.map;
  if (existing?.image === canvas) {
    existing.needsUpdate = true;
    return existing as CanvasTexture;
  }
  existing?.dispose();
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

function place(plaque: Plaque, frame: Frame): void {
  // Both corners are on the right, and clear of the edge by the same margin.
  const x = frame.width - MARGIN_PIXELS - plaque.width / 2;
  const y =
    plaque.corner === "top-right"
      ? frame.height - MARGIN_PIXELS - plaque.height / 2
      : MARGIN_PIXELS + plaque.height / 2;
  plaque.mesh.position.set(x, y, 0);
}
