/**
 * A bridge view with land in it, standing at the reference case's origin in the Suo-nada.
 *
 * What this prototype is for is three questions that cannot be answered on paper:
 *
 *  1. Does an elevation tile read as a coastline from a wheelhouse, or as a lumpy carpet?
 *  2. Does the horizon come out in the right place once the world is bent, and do distant
 *     things go hull-down the way the arithmetic says they should?
 *  3. Is it quick? The counter in the corner is the honest answer - tiles asked for, tiles
 *     that were land, kilobytes, and frames per second.
 *
 * The range poles are the check on question 2. They are 50 m high, on the bow, at ten
 * kilometre intervals. With the curve off, all four stand on the water. With it on, the
 * HUD says how much of each one should be cut off, and the picture has to agree.
 */

import {
  AmbientLight,
  BoxGeometry,
  DirectionalLight,
  FogExp2,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PerspectiveCamera,
  Scene,
  WebGLRenderer,
} from "three";

import type { LatLon } from "../../src/core/types.js";
import type { LocalPosition } from "../../src/core/geodesy.js";
import { conditionsAt } from "../../src/core/conditions.js";
import { formatClock, formatDate } from "../../src/core/time.js";
import {
  applyCurvature,
  hiddenHeightMetres,
  horizonMetres,
  makeCurvatureUniforms,
} from "./curvature.js";
import { lightingFor } from "./lighting.js";
import { buildTerrain, DEM_CREDIT } from "./terrain.js";
import { buildWater } from "./water.js";

/** The reference case: `examples/suo-nada-2025-11-27.voyage.json`. */
const ORIGIN: LatLon = { lat: 33.905, lon: 131.7116667 };
const EYE: LocalPosition = { east: 0, north: 0 };
const TIME_ZONE = "Asia/Tokyo";
/** The moment of contact. The clock starts here and can be wound to any hour of that day. */
const CONTACT_EPOCH_SECONDS = Date.parse("2025-11-27T18:13:30+09:00") / 1000;

/** Half the wedge fetched. The window is 55 degrees; the rest is room to look around. */
const HALF_ANGLE_DEGREES = 45;

/** The renderer's own settle delay, so this behaves the way the basemap already does. */
const SETTLE_MS = 250;

/**
 * The instrument, not the scenery: poles of a known height at known distances, so how much
 * of each one is cut off can be read against what the arithmetic in `curvature.ts` says.
 *
 * Deliberately huge - half a kilometre tall, four hundred metres wide, out to a hundred
 * kilometres - because a realistic 50 m mast at 40 km is three pixels of a 2268-pixel
 * frame, and three pixels cannot be argued with either way. At this size the bases go under
 * in a visible staircase: 0.6 m hidden at twenty kilometres, 470 m at a hundred.
 */
const POLE_DISTANCES_METRES = [20_000, 40_000, 60_000, 80_000, 100_000];
const POLE_HEIGHT_METRES = 500;
const POLE_WIDTH_METRES = 400;

/** Declared up here because `scheduleFetch` runs during setup, before the wiring below. */
let settling: ReturnType<typeof setTimeout> | null = null;

const state = {
  headingDegreesTrue: 270,
  pitchDegrees: 0,
  eyeHeightMetres: 20,
  epochSeconds: CONTACT_EPOCH_SECONDS,
  curvature: true,
  wireframe: false,
};

const canvasElement = document.querySelector("canvas");
const hudElement = document.querySelector("#hud");
if (!(canvasElement instanceof HTMLCanvasElement) || !(hudElement instanceof HTMLElement)) {
  throw new Error("prototype markup is missing");
}
// Re-bound, because narrowing a module-scope const does not follow it into the closures
// below, and every one of them uses both.
const canvas: HTMLCanvasElement = canvasElement;
const hud: HTMLElement = hudElement;

const renderer = new WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
const camera = new PerspectiveCamera(55, 1, 1, 600_000);
camera.rotation.order = "YXZ";

const scene = new Scene();
const haze = new FogExp2(0x000000, 1e-5);
scene.fog = haze;

const uniforms = makeCurvatureUniforms();
const landMaterial = new MeshStandardMaterial({ roughness: 1, metalness: 0, flatShading: false });
const waterMaterial = new MeshStandardMaterial({ roughness: 0.95, metalness: 0.1 });
applyCurvature(landMaterial, uniforms);
applyCurvature(waterMaterial, uniforms);

const water = buildWater(waterMaterial);
scene.add(water);

const terrain = buildTerrain(ORIGIN, landMaterial);
scene.add(terrain.group);

const ambient = new AmbientLight(0xffffff, 1);
const key = new DirectionalLight(0xffffff, 1);
scene.add(ambient, key);

scene.add(rangePoles(uniforms));

applyLight();
resize();
scheduleFetch();

addEventListener("resize", resize);
wirePointer();
wireKeys();

let previous = performance.now();
let smoothedFps = 60;

function frame(): void {
  const now = performance.now();
  smoothedFps += (1000 / Math.max(now - previous, 1) - smoothedFps) * 0.1;
  previous = now;

  camera.position.set(EYE.east, state.eyeHeightMetres, -EYE.north);
  camera.rotation.set(
    (state.pitchDegrees * Math.PI) / 180,
    -(state.headingDegreesTrue * Math.PI) / 180,
    0,
  );
  uniforms.uEye.value.set(EYE.east, state.eyeHeightMetres, -EYE.north);
  uniforms.uCurve.value = state.curvature ? 1 : 0;
  water.position.set(EYE.east, 0, -EYE.north);

  renderer.render(scene, camera);
  drawHud();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

/**
 * A handle for driving this from outside the window.
 *
 * `requestAnimationFrame` does not fire in a background tab, which is the state a
 * screenshot tool leaves the page in, so a frame has to be steppable by hand. `look` is
 * here for the same reason: turning by dragging needs a pointer, and checking which
 * bearing the land is on does not.
 */
(
  globalThis as unknown as {
    terrainPrototype?: {
      stepFrame: () => void;
      look: (heading: number) => void;
      state: typeof state;
    };
  }
).terrainPrototype = {
  stepFrame: frame,
  state,
  look: (heading: number): void => {
    state.headingDegreesTrue = ((heading % 360) + 360) % 360;
    scheduleFetch();
  },
};

/**
 * Poles on the bow, drawn with the same curved material so they sink with everything else.
 * Basic material rather than standard: they are instrumentation, not scenery, and should
 * not change with the light.
 */
function rangePoles(u: ReturnType<typeof makeCurvatureUniforms>): Group {
  const group = new Group();
  const material = new MeshBasicMaterial({ color: 0xff5533 });
  applyCurvature(material, u);

  for (const [index, distance] of POLE_DISTANCES_METRES.entries()) {
    const pole = new Mesh(
      new BoxGeometry(POLE_WIDTH_METRES, POLE_HEIGHT_METRES, POLE_WIDTH_METRES),
      material,
    );
    // Fanned out in bearing rather than in line. On one bearing the nearest pole subtends
    // more than a degree and hides every pole behind it, which reads as "the far ones are
    // below the horizon" - the exact thing being measured, arrived at for the wrong reason.
    const heading = ((270 + (index - 2) * 8) * Math.PI) / 180;
    pole.position.set(
      EYE.east + distance * Math.sin(heading),
      POLE_HEIGHT_METRES / 2,
      -(EYE.north + distance * Math.cos(heading)),
    );
    pole.frustumCulled = false;
    group.add(pole);
  }
  return group;
}

/** The conditions at the moment on the clock. Recomputed whenever the clock moves. */
function conditions(): ReturnType<typeof conditionsAt> {
  return conditionsAt(ORIGIN, undefined, state.epochSeconds);
}

function applyLight(): void {
  const light = lightingFor(conditions());
  renderer.setClearColor(light.sky);
  haze.color.copy(light.sky);
  haze.density = light.hazeDensity;
  landMaterial.color.copy(light.land);
  landMaterial.wireframe = state.wireframe;
  waterMaterial.color.copy(light.water);
  ambient.intensity = light.ambient;
  key.intensity = light.keyIntensity;
  // A directional light shines from its position towards its target, and the target is the
  // origin - so the position IS the direction, and the distance along it is irrelevant.
  key.position.copy(light.keyDirection).multiplyScalar(10_000);
}

function resize(): void {
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}

/** Hold the fetch until the view stops moving, exactly as `basemap.ts` does. */
function scheduleFetch(): void {
  if (settling !== null) clearTimeout(settling);
  settling = setTimeout(() => {
    settling = null;
    terrain.update(EYE, state.headingDegreesTrue, HALF_ANGLE_DEGREES);
  }, SETTLE_MS);
}

function wirePointer(): void {
  let dragging = false;
  canvas.addEventListener("pointerdown", (event) => {
    dragging = true;
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener("pointerup", (event) => {
    dragging = false;
    canvas.releasePointerCapture(event.pointerId);
    scheduleFetch();
  });
  canvas.addEventListener("pointermove", (event) => {
    if (!dragging) return;
    state.headingDegreesTrue = (state.headingDegreesTrue + event.movementX * 0.12 + 360) % 360;
    state.pitchDegrees = clamp(state.pitchDegrees - event.movementY * 0.06, -20, 20);
  });
}

/** Minutes the clock moves for each key. Shift is the fine one. */
const CLOCK_STEPS: Record<string, number> = { ",": -60, ".": 60, "<": -10, ">": 10 };

function wireKeys(): void {
  addEventListener("keydown", (event) => {
    const step = CLOCK_STEPS[event.key];
    if (step !== undefined) {
      state.epochSeconds += step * 60;
    } else if (!toggle(event.key.toLowerCase())) {
      return;
    }
    applyLight();
    scheduleFetch();
  });
}

/** The switches that are not the clock. False means the key was not one of ours. */
function toggle(pressed: string): boolean {
  switch (pressed) {
    case "c":
      state.curvature = !state.curvature;
      return true;
    case "w":
      state.wireframe = !state.wireframe;
      return true;
    case "r":
      state.epochSeconds = CONTACT_EPOCH_SECONDS;
      return true;
    case "arrowup":
      state.eyeHeightMetres = clamp(state.eyeHeightMetres + 5, 5, 60);
      return true;
    case "arrowdown":
      state.eyeHeightMetres = clamp(state.eyeHeightMetres - 5, 5, 60);
      return true;
    default:
      return false;
  }
}

function drawHud(): void {
  const horizon = horizonMetres(state.eyeHeightMetres);
  const now = conditions();
  const poles = POLE_DISTANCES_METRES.map(
    (d) => `${d / 1000}km ${hiddenHeightMetres(state.eyeHeightMetres, d).toFixed(0)}m`,
  ).join("  ");

  hud.textContent = [
    `${smoothedFps.toFixed(0)} fps`,
    `${formatDate(state.epochSeconds, TIME_ZONE)} ` +
      `${formatClock(state.epochSeconds, TIME_ZONE)} JST   ${now.sunLevel}`,
    `sun  alt ${now.sun.altitudeDegrees.toFixed(1)}  ` +
      `az ${now.sun.azimuthDegrees.toFixed(0).padStart(3, "0")}   ` +
      `moon alt ${now.moon.altitudeDegrees.toFixed(1)}  ` +
      `lit ${(now.moon.illuminatedFraction * 100).toFixed(0)}%`,
    `heading ${state.headingDegreesTrue.toFixed(0).padStart(3, "0")}   ` +
      `eye ${state.eyeHeightMetres} m   curve ${state.curvature ? "on" : "off"}`,
    `horizon ${(horizon / 1000).toFixed(1)} km / ${(horizon / 1852).toFixed(1)} NM`,
    `tiles asked ${terrain.stats.requested}  land ${terrain.stats.land}  ` +
      `pending ${terrain.stats.pending}  ${terrain.stats.kilobytes.toFixed(0)} kB  ` +
      `highest ${terrain.stats.highestMetres.toFixed(0)} m`,
    `hidden below: ${poles}`,
    "",
    "drag to look   , . hour   < > ten minutes   R back to contact",
    "C curve   W wireframe   up/down eye height",
    DEM_CREDIT,
  ].join("\n");
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), high);
}
