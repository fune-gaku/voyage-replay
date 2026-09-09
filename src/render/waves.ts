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

import { Vector2, Vector3, Vector4, type Material } from "three";

import { DRAWN_COMPONENTS, type WaveComponent } from "../core/seaway.js";
import { LAMPS_GLSL, makeLampUniforms, type LampUniforms } from "./lamps.js";
import { makeSkyUniforms, SHADOW_GLSL, SKY_GLSL, type SkyUniforms } from "./sky.js";
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
   * The whitecaps: how much of the sea is under them, how steep the water has to be to be
   * one, and how bright one draws. A coverage of zero draws none.
   *
   * The first is a measured relation - Monahan and O'Muircheartaigh, in `core/seaway.ts` -
   * and is the only measured thing about the foam in this picture. The second is where that
   * much foam lands, which is this file's choice (`foamAt`, `foamThreshold`).
   *
   * **The third is Koepke's albedo, and it is computed now.** A whitecap's luminance is its
   * albedo times the light falling on it, and #66 had to declare it because this renderer had
   * no irradiance to multiply: the lights were set against a hand-picked water colour and the
   * sky was a screen value. Computed from them as they stood, foam came out four times DARKER
   * than the sea and drew as dark streaks along the crests. With the light in lux (#60) the
   * shader takes the same illumination the water is under and puts it off this instead.
   */
  uFoam: { value: Vector3 };
  /**
   * The ripples below the drawn band: the shortest wavelength the spectrum reaches, and how
   * many octaves of slope lie between it and where this stops pretending.
   *
   * **The one thing in this picture that is not in the sea it was given**, and it is here on
   * the same terms as the whitecaps: the AMOUNT is Cox and Munk's measured slope minus what
   * the band carries, and where it goes is this file's choice. See `RIPPLE_GLSL`.
   */
  uRipple: { value: Vector2 };
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

/**
 * **What a whitecap gives back**, and it is not a mirror.
 *
 * Foam is bubbles: a diffuse scatterer, bright from every bearing, which is why it reads as
 * foam and not as a highlight and why it takes no Fresnel here. Koepke (1984) measured an
 * EFFECTIVE albedo of 0.22 - fresh foam is nearer 0.5 but decays over the seconds a whitecap
 * lasts, and 0.22 is the figure that belongs with Monahan's coverage, the two being what
 * ocean-colour work uses together. Taking the fresh figure with a coverage that counts
 * decaying foam would count the same water's brightness twice.
 *
 * **Not used to draw it yet**, because an albedo needs an irradiance to multiply and this
 * renderer has none - see `uFoam`. Kept here as the figure the palette's own stands in for,
 * and named on the page so the reader is told which of the two they are looking at.
 */
export const FOAM_REFLECTANCE = 0.22;

/**
 * How big a whitecap is taken to be, for the one question that needs a size: whether one is
 * still a patch or has become a tint.
 *
 * Past the range where a whitecap is smaller than the pixels under it, no arrangement of
 * patches is resolvable and the honest limit is the area average - the coverage itself,
 * mixed in flat. That is not a fade-out; the sea goes on being that much foam, and a picture
 * that dropped it would draw a calm horizon under a rough foreground.
 *
 * Eight metres is the order of a breaking crest in the seas this draws, and nothing rests on
 * it beyond where the crossover sits.
 */
const FOAM_PATCH_METRES = 8;

/** How soft the edge of a patch is, as a fraction of the slope that defines it. */
const FOAM_EDGE = 0.25;

/**
 * **How long a whitecap lasts, and why it has to last at all.**
 *
 * A threshold on the steepness of this instant gives foam no life: it appears where a crest
 * is steep and vanishes when the crest passes, so a sea blinks rather than breaks. A real
 * whitecap breaks, then lies there decaying while the wave runs out from under it - which is
 * most of what tells an eye that the water is breaking rather than merely bright.
 *
 * Seconds is the published order for the decaying stage, and Monahan's coverage counts it -
 * his W is the fraction under active AND decaying foam together, which is what makes this
 * necessary rather than optional: drawing only the instant of breaking draws less foam than
 * the relation says there is. Four seconds is the figure chosen inside that order.
 *
 * **And the coverage is re-fitted to it.** Foam that lingers covers more water than foam
 * that blinks, so the level is found against the same union over time that the shader takes -
 * otherwise persistence would quietly put more foam on the sea than Monahan allows, while the
 * page went on printing his figure.
 */
const FOAM_LIFE_SECONDS = 4;

/** How many instants back the shader looks. Three in all, counting now. */
const FOAM_HISTORY = 2;

/**
 * How finely the drawn slope field is sampled when the level is looked for, and how far the
 * search goes.
 *
 * A hundred and forty-four squared is twenty-one thousand points, and each is evaluated at
 * every instant of a whitecap's life - so a coverage of half a per cent is found off about a
 * hundred and fifty of them, which is enough that the level is not noise and cheap enough to
 * run once when the water is built. Six standard deviations is past anything a sum of forty
 * sinusoids reaches.
 */
const FOAM_SAMPLES = 144;
const FOAM_WIDEST_THRESHOLD = 6;
const FOAM_BISECTIONS = 30;

/**
 * Where the foam goes, given how steep this piece of water is and how steep the sea is.
 *
 * **The amount is measured and the placement is not**, which is the same division the glitter
 * path makes. `core/seaway.ts` has the coverage from the wind; this puts that much of the
 * surface under foam, on the steepest of it, because breaking is a steepness phenomenon.
 *
 * It cannot use the slope at which water actually breaks. A linear sea never reaches it - a
 * sum of sinusoids has a Gaussian slope and no limiting form - and the drawn surface could
 * not either, its rms slope being 6 degrees against a real sea's 14.2. So the level is a
 * QUANTILE of the drawn slope, and `foamThreshold` finds which one.
 *
 * **Against the CARRIED variance, not the sea's.** Every component is band-limited to what
 * the fragment can resolve, so the far surface is smoother than the near one; a level set
 * from the whole sea would put foam in the foreground only. Holding the level at a fixed
 * number of standard deviations keeps the coverage at every range, which is what a horizon
 * covered in whitecaps needs.
 *
 * Mirrored in GLSL below.
 */
export function foamAt(
  slopeSquared: number,
  carriedSlopeVariance: number,
  standardDeviations: number,
): number {
  if (standardDeviations <= 0 || carriedSlopeVariance <= 0) return 0;
  const threshold = standardDeviations * Math.sqrt(carriedSlopeVariance);
  return smoothstep(
    threshold * (1 - FOAM_EDGE),
    threshold * (1 + FOAM_EDGE),
    Math.sqrt(Math.max(slopeSquared, 0)),
  );
}

/**
 * What is under foam now, given how steep this water has been over the whitecap's life.
 *
 * The strongest claim any instant makes, faded by how long ago it made it: a crest that broke
 * three seconds back has left something, and one breaking now has left the most. Taken as a
 * maximum rather than a sum, because two breakings of the same water are one patch of foam
 * and not two.
 *
 * `steepness` is indexed from now backwards, one entry per instant the shader looks at.
 */
export function foamOver(
  steepness: number[],
  carriedSlopeVariance: number,
  standardDeviations: number,
): number {
  let most = 0;
  for (let back = 0; back < steepness.length; back += 1) {
    const age = (back / FOAM_HISTORY) * FOAM_LIFE_SECONDS;
    const left = 1 - age / (FOAM_LIFE_SECONDS + FOAM_LIFE_SECONDS / FOAM_HISTORY);
    most = Math.max(
      most,
      foamAt(steepness[back] ?? 0, carriedSlopeVariance, standardDeviations) * left,
    );
  }
  return most;
}

/** GLSL's own, so the copy below and the function above cannot come apart. */
function smoothstep(from: number, to: number, at: number): number {
  const t = Math.min(Math.max((at - from) / (to - from), 0), 1);
  return t * t * (3 - 2 * t);
}

/** What the water is actually drawn carrying: the fraction, and the slope it starts at. */
export interface DrawnFoam {
  coverage: number;
  standardDeviations: number;
}

/**
 * How much foam the water carries and at what slope it begins, which have to be settled
 * together and cannot be settled without the sea.
 *
 * **Whitecaps are waves breaking, so there have to be waves.** The shader spends the
 * coverage two ways: on the steepest of the drawn components where a fragment resolves
 * them, and as that flat fraction where it does not (`FOAM_GLSL`). With nothing drawn, the
 * near field has no slope to put above any level and the far field still carries the
 * fraction - so the same flat water is glass close to and four per cent foam at the
 * horizon, a sea state that changes with range. A file stating a wind and no sea reaches
 * exactly that, and so does one stating a sea of zero height beside a wind. Found reviewing
 * #73.
 *
 * `ui/panels.ts` asks this same function what is drawn rather than reporting the wind's
 * figure on its own, so the page and the picture cannot come apart over it.
 */
export function drawnFoam(components: WaveComponent[], coverage: number): DrawnFoam {
  if (components.length === 0) return { coverage: 0, standardDeviations: 0 };
  return { coverage, standardDeviations: foamThreshold(components, coverage) };
}

/**
 * How many standard deviations of slope leave the wind's coverage above them - **found by
 * running the drawn sea past the rule rather than by assuming a distribution for it.**
 *
 * The obvious version is analytic: a Gaussian slope field of total variance `V` has a
 * Rayleigh magnitude, so the fraction above `t` is `exp(-t^2/V)` and the level follows in one
 * line. **Measured, it puts out two and a half times the foam it should.** The step that
 * fails is the isotropy: a sea is spread about ONE bearing - `SPREADING_EXPONENT` is 6, a
 * narrow fan - so the slope has most of its variance along that bearing and almost none
 * across, and the magnitude of such a field has a far heavier tail at a given multiple of
 * `sqrt(V)` than a circular one. At the limit of a single direction the same level passes
 * 2.7 per cent where the circular form says 0.76.
 *
 * The anisotropic form has no elementary quantile, and the drawn field is a sum of forty
 * sinusoids rather than a Gaussian anyway. So the level comes out of the field itself: sample
 * it on a grid, bisect for the level whose smoothed indicator averages to the coverage. It is
 * the quantity the page prints, measured on the surface the page is printed beside.
 *
 * In standard deviations rather than in slope, so the shader can rescale it to whatever the
 * fragment under it is carrying.
 */
export function foamThreshold(components: WaveComponent[], coverage: number): number {
  if (coverage <= 0) return 0;
  if (coverage >= 1) return 0.001;
  const samples = normalisedSlopes(components);
  if (samples.length === 0) return 0;

  let low = 0;
  let high = FOAM_WIDEST_THRESHOLD;
  for (let i = 0; i < FOAM_BISECTIONS; i += 1) {
    const mid = (low + high) / 2;
    if (meanFoam(samples, mid) > coverage) low = mid;
    else high = mid;
  }
  return (low + high) / 2;
}

/**
 * The drawn slope magnitude over a patch of sea, in units of its own standard deviation.
 *
 * The spacing is deliberately not a round number: a grid commensurate with a wavelength
 * samples the same phase over and over and reports a sea far smoother or steeper than it is.
 */
/**
 * The squared slope at every sample and every instant, in units of the sea's own variance.
 */
function normalisedSlopes(components: WaveComponent[]): number[][] {
  const variance = components.reduce(
    (total, w) => total + (w.amplitudeMetres * w.wavenumberPerMetre) ** 2 / 2,
    0,
  );
  if (variance <= 0) return [];

  // Squared, because that is what `foamAt` takes and what saves a root per sample.
  const scale = 1 / variance;
  const out: number[][] = [];
  for (let i = 0; i < FOAM_SAMPLES; i += 1) {
    for (let j = 0; j < FOAM_SAMPLES; j += 1) {
      // **Every instant the shader looks at, at the same point.** Foam lingers, so what is
      // under it now is what has been steep at any time within a whitecap's life - and the
      // level has to be found against that union or persistence quietly adds coverage.
      const overTime: number[] = [];
      for (let back = 0; back <= FOAM_HISTORY; back += 1) {
        const age = (back / FOAM_HISTORY) * FOAM_LIFE_SECONDS;
        overTime.push(slopeSquaredAt(components, i * 2.9, j * 3.7, -age) * scale);
      }
      out.push(overTime);
    }
  }
  return out;
}

/** The drawn surface's squared slope at one point and instant, from the components. */
function slopeSquaredAt(
  components: WaveComponent[],
  east: number,
  north: number,
  secondsFromStart: number,
): number {
  let alongEast = 0;
  let alongNorth = 0;
  for (const wave of components) {
    const kx = Math.sin(wave.directionRadians) * wave.wavenumberPerMetre;
    const ky = Math.cos(wave.directionRadians) * wave.wavenumberPerMetre;
    const phase =
      kx * east +
      ky * north -
      wave.angularFrequencyPerSecond * secondsFromStart +
      wave.phaseRadians;
    const height = Math.cos(phase) * wave.amplitudeMetres;
    alongEast += kx * height;
    alongNorth += ky * height;
  }
  return alongEast * alongEast + alongNorth * alongNorth;
}

/** What fraction of that patch comes out foam at this level, over a whitecap's whole life. */
function meanFoam(overTime: number[][], standardDeviations: number): number {
  let total = 0;
  for (const steepness of overTime) total += foamOver(steepness, 1, standardDeviations);
  return total / overTime.length;
}

/**
 * How many octaves of ripple are drawn, and where the pretending stops.
 *
 * **Four, because that is what a pixel can hold.** The longest is half the shortest wave the
 * spectrum reaches - 0.57 m on a 2 m sea - and the shortest an eighth of that, 0.07 m, which
 * ten metres from the eye is eight pixels across. Below that they are under a pixel at any
 * useful range and belong in the lobe rather than on the surface, which is where they go.
 *
 * **A centimetre is where this stops.** Cox and Munk measured a real sea's whole slope,
 * capillary ripples included, and a gravity relation has no business generating those - so
 * the missing variance is spread over the octaves between the drawn band and a centimetre,
 * about seven of them, and these four take their four shares. The rest stays in the width of
 * the reflected body, which is what #37 put it in.
 */
const RIPPLE_OCTAVES = 4;

/**
 * How many bearings each octave is spread over.
 *
 * **One is a plaid.** Four octaves of one direction each carry more slope than the whole
 * drawn spectrum - a real sea's slope IS mostly in its short waves - and four sinusoids
 * carrying that much draw a regular cross-hatch, which is a worse lie than the smooth surface
 * it replaced. Three bearings an octave, stepped by an angle that closes on nothing, is
 * twelve components: enough that the eye stops finding the weave.
 */
const RIPPLE_BEARINGS = 3;
const RIPPLE_FLOOR_METRES = 0.01;

/**
 * How the missing slope is shared out: over the octaves between the shortest wave the
 * spectrum reaches and a centimetre.
 *
 * A slope density falling as one over omega puts the same variance in every octave, which is
 * the whole reason the tail of a sea matters to its shading at all - so an octave's share is
 * simply the missing variance over the count. About seven of them on a 2 m sea; the four the
 * shading can hold take four of the shares and the rest stays in the lobe.
 *
 * **Zero where there is no sea drawn**, which the shader takes as "no ripples": a file that
 * states no sea has no measured slope to be short of.
 */
export function rippleOctaves(shortestDrawnMetres: number): number {
  if (shortestDrawnMetres <= RIPPLE_FLOOR_METRES) return 0;
  return Math.log2(shortestDrawnMetres / RIPPLE_FLOOR_METRES);
}

/** The shortest wave a drawn sea reaches, which is where the ripples start. */
export function shortestDrawnMetres(components: WaveComponent[]): number {
  if (components.length === 0) return 0;
  return Math.min(...components.map((wave) => (2 * Math.PI) / wave.wavenumberPerMetre));
}

/**
 * The texture below the drawn band: **the only thing in this picture that is not in the sea
 * the file describes.**
 *
 * Measured, the shortest wave the spectrum reaches is 1.14 m on a 2 m sea, which ten metres
 * from the eye is 128 pixels across - so the water in front of a watchkeeper has no feature
 * finer than that, where a real one carries centimetre ripples at one to eleven pixels. That
 * gap is why near water reads as a moulded surface however right the spectrum is, and no
 * amount of spectrum fixes it: the waves are outside the band, the mesh could not carry them,
 * and JONSWAP does not describe them.
 *
 * So it is put in on the terms the whitecaps and the glitter lobe already use, which is the
 * pattern this project has twice: **the amount is measured and the placement is chosen, and
 * the page says which is which.** The amount is Cox and Munk's slope less what the band
 * carries - the same difference #37 already computes - shared equally per octave, which is
 * what a slope density falling as one over omega means.
 *
 * **And what it spends it hands back.** Every octave adds its own variance to
 * `gCarriedSlope`, so the body's lobe narrows by exactly what the surface took up. Without
 * that the picture would draw a sea rougher than Cox and Munk measured while the page printed
 * their figure - the same water described twice, differently, which is the fault this whole
 * project is arranged against.
 *
 * They are in the shading only. The mesh cannot carry a wave of half a metre past a few
 * metres from the eye, and nothing floats on them: at these amplitudes - millimetres - a buoy
 * riding them would be answering to noise.
 */
const RIPPLE_GLSL = `
uniform vec2 uRipple;

vec2 rippleSlope( vec2 at, float missing, float away, float pixel ) {
  if ( missing <= 0.0 || uRipple.x <= 0.0 || uRipple.y <= 0.0 ) return vec2( 0.0 );
  vec2 slope = vec2( 0.0 );
  float perOctave = missing / uRipple.y;

  for ( int i = 0; i < ${RIPPLE_OCTAVES}; i ++ ) {
    float octave = float( i );
    // Half the shortest wave the spectrum reaches, then halving.
    float wavelength = uRipple.x * 0.5 * pow( 0.5, octave );
    // **Stricter than the spectrum's own fade.** These are the shortest things in the frame
    // and the ones with nothing under them to hide their aliasing, so they are asked for
    // three times the pixels a drawn wave needs before they are drawn at all.
    float carries = smoothstep( 0.0, 1.0, wavelength / ( 3.0 * away * pixel + 1e-6 ) );
    if ( carries <= 0.0 ) continue;

    float k = 6.2831853 / wavelength;
    float share = perOctave * carries / ${RIPPLE_BEARINGS}.0;
    // Slope amplitude from the variance each carries: var = (a k)^2 / 2.
    float steep = sqrt( 2.0 * share );

    for ( int j = 0; j < ${RIPPLE_BEARINGS}; j ++ ) {
      // **Spread wide on purpose.** Short waves answer to the local wind and to every wave
      // they ride over, so they are far less directional than the swell underneath them.
      float bearing = octave * 1.9 + float( j ) * 2.399963 + 0.7;
      vec2 unit = vec2( sin( bearing ), cos( bearing ) );
      float phase = k * dot( unit, at ) - sqrt( 9.80665 * k ) * uWaveTime
        + octave * 2.3 + float( j ) * 1.7;
      slope += unit * steep * cos( phase );
    }
    // **Handed back**, so the lobe narrows by what the surface took up.
    gCarriedSlope += perOctave * carries;
  }
  return slope;
}
`;

/** The same rules, for the fragment shader. Kept beside them so they are edited together. */
const FOAM_GLSL = `
/**
 * How steep this water was, this many seconds ago.
 *
 * The spectrum only - a whitecap is a gravity wave breaking - and without the Jacobian or the
 * carried variance, which do not change with time. Two of these on top of the loop that
 * shades the surface is what a whitecap's life costs.
 */
vec2 steepnessAt( vec2 at, float when, float away, float pixel ) {
  vec2 slope = vec2( 0.0 );
  for ( int i = 0; i < ${SHADER_COMPONENTS}; i ++ ) {
    vec4 w = uWave[ i ];
    float wavelength = 6.2831853 / length( w.xy );
    float carries = smoothstep( 0.0, 1.0, wavelength / ( away * pixel + 1e-6 ) );
    slope += carries * w.xy * w.z * cos( dot( w.xy, at ) - w.w * when + uWavePhase[ i ] );
  }
  return slope;
}

float foamAt( float slopeSquared, float carried, float deviations ) {
  if ( deviations <= 0.0 || carried <= 0.0 ) return 0.0;
  float threshold = deviations * sqrt( carried );
  return smoothstep(
    threshold * ${(1 - FOAM_EDGE).toFixed(3)},
    threshold * ${(1 + FOAM_EDGE).toFixed(3)},
    sqrt( max( slopeSquared, 0.0 ) )
  );
}
`;

export function makeWaveUniforms(): WaveUniforms {
  return {
    uWave: { value: Array.from({ length: SHADER_COMPONENTS }, () => new Vector4()) },
    uWavePhase: { value: Array.from({ length: SHADER_COMPONENTS }, () => 0) },
    uWaveTime: { value: 0 },
    uWaveScale: { value: 0 },
    uPixelAngle: { value: pixelAngle(55, 1080) },
    uFoam: { value: new Vector3() },
    uRipple: { value: new Vector2() },
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
/**
 * Where this piece of water STARTED, which is what the waves are a function of.
 *
 * Once the surface is carried sideways, the position a fragment ends up at is no longer the
 * parameter - so a fragment shader reading vWaveWorld.xz for its phases would take the slope
 * of water up to a metre from the water it is shading. Geometry from one surface and shading
 * from another, at exactly the range this was added to improve. See issue #69.
 */
varying vec2 vWaveParam;
`;

/**
 * The fragment stage needs the eye as well, and nothing has declared it there: `curvature.ts`
 * patches the vertex shader only. The uniform itself is already registered by the time this
 * runs, so this is the declaration and not a second copy of the value.
 */
const FRAGMENT_DECLARATIONS = `${DECLARATIONS}
uniform vec3 uEye;
${SKY_GLSL}
${SHADOW_GLSL}
${LAMPS_GLSL}
vec3 gWorldNormal = vec3( 0.0, 1.0, 0.0 );
float gCarriedSlope = 0.0;
float gSlopeSquared = 0.0;
// The same variance as gCarriedSlope without the ripples, which is the surface the foam's
// level was fitted to. See where it is taken.
float gBreakingSlope = 0.0;
uniform vec3 uFoam;
${RIPPLE_GLSL}
${FOAM_GLSL}
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
vWaveParam = vWaveWorld.xz;
{
  float fade = uWaveScale * ${FADE(DISPLACEMENT_FADE_METRES)};
  float away = distance( vWaveWorld.xz, uEye.xz );
  float spacing = away < ${DISC.innerMetres.toFixed(1)} ? ${DISC.innerMetres.toFixed(1)} : away * ${DISC.growth.toFixed(6)};
  float height = 0.0;
  // **Sideways as well as up, which is what makes a crest a crest.** A sum of sinusoids is
  // symmetric and no gravity wave is; the trochoidal solution carries the water horizontally
  // and that motion bunches it at the crest. Same amplitudes, same wavenumbers, and the same
  // per-component fade - a wave too short for the mesh to lift is too short for it to carry.
  vec2 carried = vec2( 0.0 );
  for ( int i = 0; i < ${SHADER_COMPONENTS}; i ++ ) {
    vec4 w = uWave[ i ];
    float length2 = length( w.xy );
    float wavelength = 6.2831853 / length2;
    float carries = smoothstep( 0.0, 1.0, wavelength / ( ${SAMPLES_PER_WAVE}.0 * spacing ) );
    float phase = dot( w.xy, vWaveParam ) - w.w * uWaveTime + uWavePhase[ i ];
    height += carries * w.z * sin( phase );
    // The empty slots have no wavenumber at all, and normalising that is a NaN which would
    // take the whole sum with it - amplitude zero does not save a multiplication by NaN.
    carried += carries * w.z * cos( phase ) * ( w.xy / max( length2, 1e-9 ) );
  }
  transformed.y += fade * height;
  transformed.xz += fade * carried;
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
  // **The horizontal displacement's own gradient**, which the shading needs the moment the
  // water moves sideways: the surface is parametric now, so its normal is the cross product
  // of two tangents rather than the height's gradient. (dDx/dx, dDx/dz, dDz/dz) - and the
  // mixed term is one number because the field is a gradient, so its Jacobian is symmetric.
  vec3 spread = vec3( 0.0 );
  for ( int i = 0; i < ${SHADER_COMPONENTS}; i ++ ) {
    vec4 w = uWave[ i ];
    // **Each wave fades at its own range, not all of them at one.** A metre-long wave is
    // below a pixel by a few hundred metres and shimmers rather than shows, while the
    // hundred-metre swell under it is still the shape of the sea at ten kilometres. One
    // fade for the lot either keeps the short ones until they crawl or drops the long ones
    // while they still carry the picture; this drops each where its own wavelength falls
    // below the few pixels a sinusoid needs to read as one.
    float length2 = length( w.xy );
    float wavelength = 6.2831853 / length2;
    float carries = smoothstep( 0.0, 1.0, wavelength / ( away * uPixelAngle + 1e-6 ) );
    // **The parameter, not where this fragment ended up.** Past the displacement the two are
    // a metre apart, and taking the phase at the wrong one shades water that is not here.
    float phase = dot( w.xy, vWaveParam ) - w.w * uWaveTime + uWavePhase[ i ];
    slope += carries * w.xy * w.z * cos( phase );
    spread -= ( carries * w.z * sin( phase ) / max( length2, 1e-9 ) )
      * vec3( w.x * w.x, w.x * w.y, w.y * w.y );
    // **What this fragment's normals actually carry**, which is less than the sea has wherever
    // the band or the range has taken components out. The reflection gives the difference back
    // to the body, so the lane keeps its measured width instead of narrowing with distance.
    float steep = carries * w.z * length2;
    gCarriedSlope += 0.5 * steep * steep;
  }
  // **Kept in world axes as well.** The normal is about to become a VIEW space vector, and
  // the sky is a function of a world direction - so the reflection stage below would have to
  // undo the rotation to ask it anything. Mixed by the same fade, so the two agree about how
  // much of this sea is drawn where.
  // **Kept for the foam before the ripples are added**, and that order is the point: a
  // whitecap is a gravity wave breaking, not a capillary ripple, and the level the coverage
  // is fitted to is fitted to the spectrum's own components. Feeding it a slope the ripples
  // had steepened would ask a question of one surface and answer it about another.
  gSlopeSquared = dot( slope, slope );

  // **What the band cannot reach, as pattern rather than only as width.** The missing slope
  // is what #37 already puts into the reflected body's lobe; the four octaves this can hold
  // take their share of it here and hand it straight back, so the total is unchanged.
  gCarriedSlope *= fade * fade;
  // **And the variance the foam is judged against, taken here for the same reason.**
  // rippleSlope hands its own variance back into gCarriedSlope - which is right for the
  // reflection, where the question is how much roughness the surface is now drawing - but a
  // whitecap is a gravity wave breaking. Judging the gravity slope above against a variance
  // the ripples had raised compares two different surfaces: near to, where the missing
  // roughness is largest, the ripples carry several times the gravity variance and the
  // level rises with the square root of that, so the foam Monahan's coverage was fitted to
  // vanishes from the foreground while the horizon keeps it. Found reviewing #75.
  gBreakingSlope = gCarriedSlope;
  slope += rippleSlope( vWaveParam, max( uSeaSlope - gCarriedSlope, 0.0 ), away, uPixelAngle );
  // The two tangents, then their cross product - z crossed with x, in that order, so the
  // normal comes out upwards. With no sideways carry it is exactly ( -slope.x, 1, -slope.y ),
  // which is what surfaceNormal in core/seaway.ts is held to.
  vec3 alongX = vec3( 1.0 + spread.x, slope.x, spread.y );
  vec3 alongZ = vec3( spread.y, slope.y, 1.0 + spread.z );
  vec3 world = normalize( cross( alongZ, alongX ) );
  gWorldNormal = normalize( mix( vec3( 0.0, 1.0, 0.0 ), world, fade ) );
  vec3 waved = ( viewMatrix * vec4( world, 0.0 ) ).xyz;
  normal = normalize( mix( normal, waved, fade ) );
  // The whole surface fades to flat past a few kilometres as well, and slope goes with it.
  // gCarriedSlope was faded before the ripples, which are added at their own range and must
  // not be faded twice.
  gSlopeSquared *= fade * fade;
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
  vec3 lit;
  vec3 handed = skyTowards( back, gCarriedSlope )
    + lampsTowards( back, vWaveWorld, gWorldNormal, gCarriedSlope, lit );
  // **Crests hide troughs, and near the horizon they hide most of them.** Without it the far
  // sea returns the whole sky right up to the waterline and melts into it - the one thing an
  // eye that has been to sea reads as wrong before anything else. Smith's term, off the SEA's
  // own slope rather than the drawn surface's: real crests do the hiding, including the ones
  // this band cannot draw, which is the argument lobeWidth already makes about the width.
  handed *= shadowing( abs( look.y ), uSeaSlope );
  outgoingLight = mix( outgoingLight, handed, sky );
  // **And the water the lamps light, which is not a reflection and takes no Fresnel.** A
  // reflection is only where the geometry lines up; light landing on the sea is there from
  // every bearing, which is the difference between a lamp shining at one observer and a lamp.
  outgoingLight += lit;

  // **Foam last, because it is not water and does not reflect through.** A whitecap is a
  // diffuse scatterer: no Fresnel, no glitter, bright from every bearing - which is exactly
  // why it reads as foam rather than as a highlight. The same illumination off a surface of
  // the foam's own albedo, which is what dividing the diffuse term by the water's is.
  float away = distance( vWaveWorld.xz, uEye.xz );
  float resolved = smoothstep( 0.0, 1.0, ${FOAM_PATCH_METRES.toFixed(1)} / ( away * uPixelAngle + 1e-6 ) );
  // **The union over a whitecap's life**, which is what its coverage was fitted against:
  // the strongest claim any instant makes, faded by how long ago it made it. Taken as a
  // maximum, because two breakings of one piece of water are one patch of foam.
  float breaking = foamAt( gSlopeSquared, gBreakingSlope, uFoam.y );
  for ( int i = 1; i <= ${FOAM_HISTORY}; i ++ ) {
    float age = float( i ) / ${FOAM_HISTORY}.0 * ${FOAM_LIFE_SECONDS}.0;
    vec2 was = steepnessAt( vWaveParam, uWaveTime - age, away, uPixelAngle );
    float left = 1.0 - age / ${(FOAM_LIFE_SECONDS + FOAM_LIFE_SECONDS / 2).toFixed(1)};
    breaking = max( breaking, foamAt( dot( was, was ), gBreakingSlope, uFoam.y ) * left );
  }
  float foam = uWaveScale * mix( uFoam.x, breaking, resolved );
  // **The same light, off a surface of the foam's own albedo**, which is what dividing the
  // diffuse term by the water's colour and multiplying by this leaves. It was a declared
  // brightness while there was no irradiance to multiply (#66); there is one now (#60).
  vec3 foamLight = totalDiffuse / max( diffuseColor.rgb, vec3( 1e-4 ) ) * uFoam.z;
  outgoingLight = mix( outgoingLight, foamLight, foam );
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
    shader.uniforms["uFoam"] = uniforms.uFoam;
    shader.uniforms["uRipple"] = uniforms.uRipple;
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
