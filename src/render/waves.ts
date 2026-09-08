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

import { Vector2, Vector4, type Material } from "three";

import { DRAWN_COMPONENTS, type WaveComponent } from "../core/seaway.js";
import { LAMPS_GLSL, makeLampUniforms, type LampUniforms } from "./lamps.js";
import { makeSkyUniforms, SKY_GLSL, type SkyUniforms } from "./sky.js";
import { DISC } from "./water.js";

/**
 * How many components the shader carries. Fixed, because a shader's array size is - and
 * taken from `core/seaway.ts` rather than restated, because it has to be the number of
 * components a sea is BUILT from.
 *
 * Carry fewer and `setWaves` drops the remainder in silence, while the amplitudes have
 * already been shared across all of them: the drawn sea comes out flatter than the sea the
 * panels are reasoning about, with every figure on the page still correct. That is the
 * invariant this whole change rests on, and two constants is all it would take.
 */
export const SHADER_COMPONENTS = DRAWN_COMPONENTS;

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
 * How many pixels of a wave are needed before it is drawn rather than sparkled.
 *
 * **The band now reaches down to metre waves**, which is where most of a sea's slope lives -
 * and a wave narrower than a pixel does not look like a wave, it looks like noise crawling
 * over the water. So each component is faded at its OWN range: the swell carries the picture
 * out to the horizon while the chop on top of it stops contributing a few hundred metres out,
 * which is about where a real one stops being separable to the eye as well.
 *
 * **The angle a pixel subtends is a property of the frame, not a constant**, so it comes in as
 * a uniform: the field of view over the height in pixels. Hard-coded, the same wave survives
 * to half the range on a short window and vanishes at twice the size on a tall one - which
 * would make the drawn band depend on how big somebody's browser is.
 */
const SHORTEST_DRAWN_PIXELS = 8;

/**
 * How the mesh under a wave is spaced, and how many samples a wave needs to be one.
 *
 * **Both numbers come from `water.ts` rather than being written again here.** The disc lays
 * its rings geometrically, so the spacing at any distance is that fraction of it - and inside
 * the innermost ring there is no spacing at all, only a fan from one centre vertex, which is
 * coarser than anything outside it. A copy of these that drifted from the mesh would put
 * waves on triangles too big to hold them, which is the failure this whole fade exists to
 * stop.
 *
 * Eight samples is the same count the shading uses for a pixel: below it a sinusoid stops
 * reading as a sinusoid, whether the sampler is a vertex or a fragment.
 */
const SAMPLES_PER_WAVE = 8;

/**
 * How far apart the vertices are under a point this far from the eye.
 *
 * A step at the innermost ring, because the mesh has one: outside it the rings are 8.7 per
 * cent of the radius apart, which at 5 m is under half a metre, and inside it the cap is a
 * single triangle fan whose only samples are the centre and the rim. Smoothing across that
 * would claim the cap can carry waves it cannot. **Nothing in a level bridge view is inside
 * it** - a 20 m eye with a 55 degree window sees water from about 38 m out - so the step is
 * where no frame looks.
 */
function meshSpacingMetres(distanceFromEyeMetres: number): number {
  return distanceFromEyeMetres < DISC.innerMetres
    ? DISC.innerMetres
    : distanceFromEyeMetres * DISC.growth;
}

/**
 * How much of one component the mesh under a point can actually carry there.
 *
 * **The CPU mirror of the loop in `DISPLACEMENT`, and it exists for the reason `#34` gives**:
 * anything floating has to ride the sea that is DRAWN, and the drawn sea is no longer the
 * whole spectrum at every range. Beyond a couple of hundred metres the vertices are twenty
 * metres apart, so the metre-long waves the band now reaches down to are not in the geometry
 * at all - and a buoy heaving to waves the water does not have is a buoy hovering, which is
 * exactly the failure the per-component fade was added to prevent in the picture.
 *
 * Two writings of one rule, in GLSL and here, because no test can compile a shader. They are
 * kept in this file, next to each other, so that they are edited together.
 */
export function meshCarries(wavelengthMetres: number, distanceFromEyeMetres: number): number {
  const spacing = meshSpacingMetres(distanceFromEyeMetres);
  const t = Math.min(Math.max(wavelengthMetres / (SAMPLES_PER_WAVE * spacing), 0), 1);
  // smoothstep, as GLSL defines it.
  return t * t * (3 - 2 * t);
}

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
  /**
   * What the water reflects, as a function of direction rather than as one colour.
   *
   * The scene's own sky, and the same uniforms the dome above the waterline is drawn from,
   * so the two cannot come to disagree - which would show first at the horizon. See
   * `render/sky.ts`.
   */
  sky: SkyUniforms;
  /** The lamps reflected in the same water, each laying its own streak. See `render/lamps.ts`. */
  lamps: LampUniforms;
  /**
   * How much of the picture the shortest drawn wave has to fill, in radians: the vertical
   * field of view over the height in pixels, times the pixels a sinusoid needs to read as one.
   * Set from the frame, because a constant would make the drawn band depend on the window -
   * and from the DRAWING BUFFER's height rather than the layout box's, since that is what the
   * fragment shader is sampled on. A retina screen has two device pixels to each CSS one.
   */
  uPixelAngle: { value: number };
}

/**
 * The angle the shortest drawable wave has to subtend, from the frame it is drawn in.
 *
 * A wave is drawn while its own wavelength covers more of the picture than this; below it, it
 * is noise crawling across the water rather than a wave, and it is faded out where the eye
 * would stop separating it anyway.
 *
 * **`heightPixels` is the drawing buffer's, not the CSS box's.** The fragment shader runs on
 * device pixels, and a retina screen has two of them to each layout pixel - so a caller
 * passing `clientHeight` would drop every component at half the range it should, and the
 * drawn band would depend on the reader's display.
 */
export function pixelAngle(verticalFieldOfViewDegrees: number, heightPixels: number): number {
  const perPixel = (verticalFieldOfViewDegrees * Math.PI) / 180 / Math.max(heightPixels, 1);
  return SHORTEST_DRAWN_PIXELS * perPixel;
}

/**
 * **A wave under a millimetre is not a wave the picture has.**
 *
 * The lowest frequency bin runs from a sixth of the peak, where a JONSWAP spectrum holds
 * essentially nothing, and its component is sampled from somewhere inside it - so a sea comes
 * out with one component hundreds of metres long and no amplitude at all. Carrying it costs a
 * sine per vertex and draws nothing.
 *
 * It is a decision about the PICTURE, so it lives here and both the renderer and `ui/panels.ts`
 * take it from this one place. Applied to only one of them, the page would report a band the
 * water does not have, or the water would carry waves the page says are not there.
 */
export const DRAWN_FLOOR_METRES = 0.001;

/**
 * The components a picture can show, carrying the whole sea between them.
 *
 * **What is left is scaled back up to the variance the set arrived with**, for the reason
 * `normalised` in `core/seaway.ts` gives about the truncated band: the components dropped
 * carried some of the sea, and letting it go would draw water flatter than the height the
 * page prints beside it. It changes nothing on an ordinary sea, where what falls out has no
 * amplitude to speak of, and everything on a sea of a centimetre, where it is most of them.
 */
export function drawable(components: WaveComponent[]): WaveComponent[] {
  const kept = components.filter((wave) => wave.amplitudeMetres >= DRAWN_FLOOR_METRES);
  if (kept.length === 0) return [];
  const scale = Math.sqrt(varianceOf(components) / varianceOf(kept));
  return kept.map((wave) => ({ ...wave, amplitudeMetres: wave.amplitudeMetres * scale }));
}

/** The surface variance a set of components makes, which is what the height rests on. */
function varianceOf(components: WaveComponent[]): number {
  return components.reduce((total, wave) => total + wave.amplitudeMetres ** 2 / 2, 0);
}

export function makeWaveUniforms(): WaveUniforms {
  return {
    uWave: { value: Array.from({ length: SHADER_COMPONENTS }, () => new Vector4()) },
    uWavePhase: { value: Array.from({ length: SHADER_COMPONENTS }, () => 0) },
    uWaveTime: { value: 0 },
    uWaveScale: { value: 0 },
    uPixelAngle: { value: pixelAngle(55, 1080) },
    sky: makeSkyUniforms(),
    lamps: makeLampUniforms(),
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
uniform float uPixelAngle;
varying vec3 vWaveWorld;
`;

/**
 * The fragment stage needs the eye as well, and nothing has declared it there: `curvature.ts`
 * patches the vertex shader only. The uniform itself is already registered by the time this
 * runs, so this is the declaration and not a second copy of the value.
 */
const FRAGMENT_DECLARATIONS = `${DECLARATIONS}
uniform vec3 uEye;
${SKY_GLSL}
${LAMPS_GLSL}
vec3 gWorldNormal = vec3( 0.0, 1.0, 0.0 );
float gCarriedSlope = 0.0;
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
 *
 * **Every component is band-limited to the mesh under it, not just the lot to one range.**
 * The disc's rings grow by 8.73 per cent of the distance, so vertices are 22 m apart at 250 m
 * - and a 2 m wave sampled there does not come out short, it comes out as a slow false swell
 * crawling across the water, which moves the horizon and the hulls standing on it. Aliasing in
 * the normals is noise; aliasing in the geometry is a different sea.
 *
 * The spacing is `water.ts`'s own, written into the shader from it, so the two cannot drift.
 */
const DISPLACEMENT = `
#include <begin_vertex>
vWaveWorld = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;
// The MEAN surface, and only the horizontal part of it is used from here: the phases below
// and the ones in the fragment stage read .xz, which no vertical displacement touches. The
// height is put back at DRAWN_SURFACE below, once everything that moves it has run.
{
  float fade = uWaveScale * ${FADE(DISPLACEMENT_FADE_METRES)};
  float away = distance( vWaveWorld.xz, uEye.xz );
  float spacing = away < ${DISC.innerMetres.toFixed(1)} ? ${DISC.innerMetres.toFixed(1)} : away * ${DISC.growth.toFixed(6)};
  float height = 0.0;
  for ( int i = 0; i < ${SHADER_COMPONENTS}; i ++ ) {
    vec4 w = uWave[ i ];
    float wavelength = 6.2831853 / length( w.xy );
    float carries = smoothstep( 0.0, 1.0, wavelength / ( ${SAMPLES_PER_WAVE}.0 * spacing ) );
    height += carries * w.z * sin( dot( w.xy, vWaveWorld.xz ) - w.w * uWaveTime + uWavePhase[ i ] );
  }
  transformed.y += fade * height;
}
`;

/**
 * The world position of the water as it is actually DRAWN, for the reflection to start from.
 *
 * **At `project_vertex` rather than beside the displacement**, because two things move this
 * surface and only one of them is in this file: the waves lift it here, and `curvature.ts`
 * sinks it afterwards by the drop that puts a horizon in the picture. Taken before either,
 * the reflected ray leaves the mean sea while the normal it bounces off belongs to the drawn
 * one - a plausible pattern in the wrong place, which is this project's whole failure mode.
 *
 * Injecting here rather than recomputing the drop keeps the curvature's formula in one file.
 * The horizontal part is unchanged by both, so the wave phases above and in the fragment
 * stage are unaffected by the reassignment.
 */
const DRAWN_SURFACE = `
vWaveWorld = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;
#include <project_vertex>
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
  float away = distance( vWaveWorld.xz, uEye.xz );
  vec2 slope = vec2( 0.0 );
  for ( int i = 0; i < ${SHADER_COMPONENTS}; i ++ ) {
    vec4 w = uWave[ i ];
    // **Each wave fades at its own range, not all of them at one.** A metre-long wave is
    // below a pixel by a few hundred metres and shimmers rather than shows, while the
    // hundred-metre swell under it is still the shape of the sea at ten kilometres. One
    // fade for the lot either keeps the short ones until they crawl or drops the long ones
    // while they still carry the picture; this drops each where its own wavelength falls
    // below the few pixels a sinusoid needs to read as one.
    float wavelength = 6.2831853 / length( w.xy );
    float carries = smoothstep( 0.0, 1.0, wavelength / ( away * uPixelAngle + 1e-6 ) );
    slope += carries * w.xy * w.z * cos( dot( w.xy, vWaveWorld.xz ) - w.w * uWaveTime + uWavePhase[ i ] );
    // **What this fragment's normals actually carry**, which is less than the sea has wherever
    // the band or the range has taken components out. The reflection gives the difference back
    // to the body, so the lane keeps its measured width instead of narrowing with distance.
    float steep = carries * w.z * length( w.xy );
    gCarriedSlope += 0.5 * steep * steep;
  }
  // **Kept in world axes as well.** The normal is about to become a VIEW space vector, and
  // the sky is a function of a world direction - so the reflection stage below would have to
  // undo the rotation to ask it anything. Mixed by the same fade, so the two agree about how
  // much of this sea is drawn where.
  vec3 world = normalize( vec3( -slope.x, 1.0, -slope.y ) );
  gWorldNormal = normalize( mix( vec3( 0.0, 1.0, 0.0 ), world, fade ) );
  vec3 waved = ( viewMatrix * vec4( world, 0.0 ) ).xyz;
  normal = normalize( mix( normal, waved, fade ) );
  // The whole surface fades to flat past a few kilometres as well, and slope goes with it.
  gCarriedSlope *= fade * fade;
}
`;

/**
 * The sky, handed back by the water in the direction it is reflected towards.
 *
 * After the lighting rather than before it, because this is reflected light and not
 * something the surface is being lit by. `vViewPosition` points from the fragment to the
 * camera, which is what the angle is measured from.
 *
 * **The direction is where the reflected ray goes, not merely how steeply it leaves.** That
 * is the whole change: a sea reflecting one colour makes the waves visible and says nothing
 * about the sky, while a sea reflecting a direction lays a path of light under the body and
 * a reader can take a bearing off it. The eye is `cameraPosition` rather than `uEye`, which
 * carries the watchkeeper's position at sea level and not her height.
 *
 * **`cameraPosition` comes from three's own fragment prefix**, which no test here can reach:
 * `ShaderLib` exposes the shader bodies and the prefix is built inside `WebGLProgram`. It is
 * declared in both prefixes in the version installed, checked by hand. A three that dropped
 * it from the fragment one would fail to compile this material rather than draw it wrongly,
 * which is the better of the two failures - but it is worth knowing where to look.
 */
const REFLECTION = `
{
  float towards = clamp( dot( normalize( vViewPosition ), normal ), 0.0, 1.0 );
  float sky = mix( ${WATER_REFLECTANCE_HEAD_ON}, 1.0, pow( 1.0 - towards, 5.0 ) );
  vec3 look = normalize( vWaveWorld - cameraPosition );
  vec3 back = reflect( look, gWorldNormal );
  // The sky, and whatever lamps are lit over the same water. A lamp's streak is added to the
  // sky rather than replacing it: a light on the water does not take the night out of it.
  vec3 handed = skyTowards( back, gCarriedSlope ) + lampsTowards( back, vWaveWorld, gCarriedSlope );
  outgoingLight = mix( outgoingLight, handed, sky );
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
    shader.uniforms["uPixelAngle"] = uniforms.uPixelAngle;
    shader.vertexShader = DECLARATIONS + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace("#include <begin_vertex>", DISPLACEMENT);
    shader.vertexShader = shader.vertexShader.replace("#include <project_vertex>", DRAWN_SURFACE);
    shader.fragmentShader = FRAGMENT_DECLARATIONS + shader.fragmentShader;
    // Every sky uniform by name, so adding one to `SkyUniforms` cannot leave it unregistered
    // - which compiles, runs, and draws a sky with nothing in it.
    for (const name of Object.keys(uniforms.sky) as (keyof SkyUniforms)[]) {
      shader.uniforms[name] = uniforms.sky[name];
    }
    for (const name of Object.keys(uniforms.lamps) as (keyof LampUniforms)[]) {
      shader.uniforms[name] = uniforms.lamps[name];
    }
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <normal_fragment_begin>",
      NORMALS,
    );
    shader.fragmentShader = shader.fragmentShader.replace("#include <opaque_fragment>", REFLECTION);
  };
  material.customProgramCacheKey = (): string => `${earlierKey()}|waves`;
}
