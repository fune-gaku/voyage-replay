/**
 * Putting the sea's own shape on the water.
 *
 * `core/seaway.ts` says what the sea is - a sum of sinusoids whose amplitudes are the
 * spectrum's and whose phases are random, which is what makes the drawn surface Gaussian
 * with the right significant height. This is only how that reaches the picture, and it
 * reaches it two different ways for the same reason `curvature.ts` does:
 *
 * - **Near the eye, the water is displaced.** Real geometry, so crests stand between the
 *   viewer and what is beyond them.
 * - **Further out, only the shading is.** The disc's vertices are spaced geometrically -
 *   8.7 per cent of their radius - so a 3 m sea, whose waves are 117 m long, has fewer
 *   than eight vertices to a wavelength beyond about 150 m and fewer than two beyond 500 m.
 *   Displacing that mesh does not draw waves, it draws aliasing. The slope is analytic, so
 *   the fragment shader can have it at any distance the vertices cannot.
 *
 * The crossover is therefore a property of the mesh, not a taste: it is where the vertices
 * run out. See `DISPLACEMENT_FADE_METRES`.
 *
 * **The plan view gets no sea.** A chart has never had waves drawn on it, which is the same
 * decision `setDiagramView` already makes about the lighting, the map tint and the grid.
 *
 * **The waves move on the scenario's clock, not the wall's.** Everything else in the frame
 * is time-lapsed by the playback speed and a sea running at its own rate would be the only
 * thing in the picture telling the truth about time, which reads as the sea being still.
 */

import { Color, Vector2, Vector4, type Material } from "three";

import type { WaveComponent } from "../core/seaway.js";

/** How many components the shader carries. Fixed, because a shader's array size is. */
export const SHADER_COMPONENTS = 24;

/**
 * Where displaced geometry gives out, in metres from the eye.
 *
 * Measured against the disc in `water.ts`: rings grow 8.73 per cent and sectors are 3.75
 * degrees, so vertex spacing reaches an eighth of a 117 m wavelength - the coarsest that
 * still carries a wave rather than a zigzag - at about 150 m, and a quarter of one at 300.
 * Faded from there rather than cut, since a step in the surface would be more visible than
 * the waves; four vertices to a wave is coarse for a crest and adequate for a swell.
 */
const DISPLACEMENT_FADE_METRES = new Vector2(250, 600);

/**
 * Where the shaded slope gives out.
 *
 * Not for want of resolution - the slope is analytic - but because a wave narrower than a
 * pixel shimmers rather than shows. Far enough out that the fade is not the thing the eye
 * notices; the horizon of a 20 m eye is 17 km.
 */
const SLOPE_FADE_METRES = new Vector2(2500, 9000);

/**
 * How much of the sky a flat sea hands back, and how much one seen edge-on does.
 *
 * Water's reflectance at normal incidence is about two per cent and goes to one at grazing
 * - Schlick's approximation of Fresnel, with the fifth power. This is not decoration: it is
 * the whole reason a sea looks like a sea in daylight. A crest face tilted towards the eye
 * shows the water's own colour, the back of the same wave shows the sky, and the difference
 * between them is the wave. Without it a correct wave field renders as a flat sheet with
 * about a tenth of the contrast it should have - measured, before this was added.
 *
 * It is applied whether or not there are waves, because a flat sea reflects too: that is
 * why the water pales towards the horizon. On a night scenario the sky is nearly black and
 * it changes almost nothing, which is also right.
 */
const WATER_REFLECTANCE_HEAD_ON = 0.02;

export interface WaveUniforms {
  /** (kx, kz, amplitude, omega) per component. */
  uWave: { value: Vector4[] };
  uWavePhase: { value: number[] };
  /** Seconds since the scenario's start - the same clock the ships move on. */
  uWaveTime: { value: number };
  /** 1 where the sea is drawn, 0 for the plan view. Nothing between means anything. */
  uWaveScale: { value: number };
  /** What the water reflects. The scene's own sky, so the two cannot disagree. */
  uSkyColour: { value: Color };
}

export function makeWaveUniforms(): WaveUniforms {
  return {
    uWave: { value: Array.from({ length: SHADER_COMPONENTS }, () => new Vector4()) },
    uWavePhase: { value: Array.from({ length: SHADER_COMPONENTS }, () => 0) },
    uWaveTime: { value: 0 },
    uWaveScale: { value: 0 },
    uSkyColour: { value: new Color(0x000000) },
  };
}

/**
 * Load a sea into the uniforms.
 *
 * Components past what the shader carries are dropped and the rest are left at zero
 * amplitude, which costs their sine and contributes nothing - simpler than a count uniform
 * and a dynamic loop, and the loop has to be a constant length anyway.
 */
export function setWaves(uniforms: WaveUniforms, components: WaveComponent[]): void {
  for (let i = 0; i < SHADER_COMPONENTS; i += 1) {
    const wave = components[i];
    const slot = uniforms.uWave.value[i];
    if (!slot) continue;
    if (!wave) {
      slot.set(0, 0, 0, 0);
      continue;
    }
    const k = wave.wavenumberPerMetre;
    // The scene's x is east and its z is south, so a heading of zero travels towards -z.
    slot.set(
      k * Math.sin(wave.directionRadians),
      -k * Math.cos(wave.directionRadians),
      wave.amplitudeMetres,
      wave.angularFrequencyPerSecond,
    );
    uniforms.uWavePhase.value[i] = wave.phaseRadians;
  }
}

const DECLARATIONS = `
uniform vec4 uWave[${SHADER_COMPONENTS}];
uniform float uWavePhase[${SHADER_COMPONENTS}];
uniform float uWaveTime;
uniform float uWaveScale;
varying vec3 vWaveWorld;
`;

/**
 * The fragment stage needs the eye as well, and nothing has declared it there: `curvature.ts`
 * patches the vertex shader only. The uniform itself is already registered by the time this
 * runs, so this is the declaration and not a second copy of the value.
 */
const FRAGMENT_DECLARATIONS = `${DECLARATIONS}
uniform vec3 uEye;
uniform vec3 uSkyColour;
`;

/**
 * The same fade the shader applies, for anything that has to float on the sea as DRAWN.
 *
 * A buoy riding the true wave field over water whose geometry has faded to flat is a buoy
 * hovering, so the two have to come from one function. That the sea stops heaving at a few
 * hundred metres is the mesh's limit rather than the sea's, and it is worth knowing about
 * rather than hiding: see `DISPLACEMENT_FADE_METRES`.
 */
export function displacedFraction(distanceFromEyeMetres: number): number {
  const span = DISPLACEMENT_FADE_METRES.y - DISPLACEMENT_FADE_METRES.x;
  const t = Math.min(Math.max((distanceFromEyeMetres - DISPLACEMENT_FADE_METRES.x) / span, 0), 1);
  // smoothstep, as GLSL defines it.
  return 1 - t * t * (3 - 2 * t);
}

const FADE = (near: Vector2): string =>
  `( 1.0 - smoothstep( ${near.x.toFixed(1)}, ${near.y.toFixed(1)}, distance( vWaveWorld.xz, uEye.xz ) ) )`;

/**
 * Height, in the vertex shader, faded out where the mesh stops being able to carry it.
 *
 * Placed at `begin_vertex` alongside the curvature, which subtracts from the same value;
 * the two are independent and additive, and neither cares which ran first.
 */
const DISPLACEMENT = `
#include <begin_vertex>
vWaveWorld = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;
{
  float fade = uWaveScale * ${FADE(DISPLACEMENT_FADE_METRES)};
  float height = 0.0;
  for ( int i = 0; i < ${SHADER_COMPONENTS}; i ++ ) {
    vec4 w = uWave[ i ];
    height += w.z * sin( dot( w.xy, vWaveWorld.xz ) - w.w * uWaveTime + uWavePhase[ i ] );
  }
  transformed.y += fade * height;
}
`;

/**
 * Slope, in the fragment shader, which is what carries the sea past the vertices.
 *
 * The derivative of the same sum, so the shading and the geometry are the same surface
 * where they overlap rather than two seas laid over one another.
 *
 * **`normal` here is in VIEW space, and the slope is in world space.** Mixing them without
 * saying so compiles, runs, and lights the sea as though it were still flat, which is the
 * worst kind of wrong in this project: a sea that has waves in the panels and none in the
 * picture. `viewMatrix` is in the fragment prefix three already writes, and the water's own
 * model matrix is a translation - `curvature.ts` requires that of it anyway - so a world
 * direction needs no more than rotating into the camera.
 */
const NORMALS = `
#include <normal_fragment_begin>
{
  float fade = uWaveScale * ${FADE(SLOPE_FADE_METRES)};
  vec2 slope = vec2( 0.0 );
  for ( int i = 0; i < ${SHADER_COMPONENTS}; i ++ ) {
    vec4 w = uWave[ i ];
    slope += w.xy * w.z * cos( dot( w.xy, vWaveWorld.xz ) - w.w * uWaveTime + uWavePhase[ i ] );
  }
  vec3 waved = ( viewMatrix * vec4( normalize( vec3( -slope.x, 1.0, -slope.y ) ), 0.0 ) ).xyz;
  normal = normalize( mix( normal, waved, fade ) );
}
`;

/**
 * The sky, handed back by the water at the angle it is seen at.
 *
 * After the lighting rather than before it, because this is reflected light and not
 * something the surface is being lit by. `vViewPosition` points from the fragment to the
 * camera, which is what the angle is measured from.
 */
const REFLECTION = `
{
  float towards = clamp( dot( normalize( vViewPosition ), normal ), 0.0, 1.0 );
  float sky = mix( ${WATER_REFLECTANCE_HEAD_ON}, 1.0, pow( 1.0 - towards, 5.0 ) );
  outgoingLight = mix( outgoingLight, uSkyColour, sky );
}
#include <opaque_fragment>
`;

/**
 * Patch a material so the sea has the shape the spectrum says.
 *
 * Composes with whatever was already patched onto it rather than replacing it - the water
 * is curved as well as waved, and `curvature.ts` got there first. The cache key has to
 * compose too: without it three hands back the program it compiled for a material with the
 * same parameters, and half the shader silently does not happen.
 */
export function applyWaves(material: Material, uniforms: WaveUniforms): void {
  const earlier = material.onBeforeCompile.bind(material);
  const earlierKey = material.customProgramCacheKey.bind(material);

  material.onBeforeCompile = (shader, renderer): void => {
    earlier(shader, renderer);
    shader.uniforms["uWave"] = uniforms.uWave;
    shader.uniforms["uWavePhase"] = uniforms.uWavePhase;
    shader.uniforms["uWaveTime"] = uniforms.uWaveTime;
    shader.uniforms["uWaveScale"] = uniforms.uWaveScale;
    shader.vertexShader = DECLARATIONS + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace("#include <begin_vertex>", DISPLACEMENT);
    shader.fragmentShader = FRAGMENT_DECLARATIONS + shader.fragmentShader;
    shader.uniforms["uSkyColour"] = uniforms.uSkyColour;
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <normal_fragment_begin>",
      NORMALS,
    );
    shader.fragmentShader = shader.fragmentShader.replace("#include <opaque_fragment>", REFLECTION);
  };
  material.customProgramCacheKey = (): string => `${earlierKey()}|waves`;
}
