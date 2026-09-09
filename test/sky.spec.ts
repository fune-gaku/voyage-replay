import { Color, ShaderLib, Vector3, type ShaderMaterial } from "three";
import { describe, expect, it } from "vitest";

import type { Lit } from "../src/core/illumination.js";
import {
  buildSkyDome,
  makeSkyUniforms,
  setSkyBody,
  skyColourAt,
  skyDomeColourAt,
  skyGradientAt,
  SKY_DOME_GLSL,
  SKY_GLSL,
  towardsBody,
} from "../src/render/sky.js";

/** A sky with a gradient in it, so the claims below are about the gradient and not about black. */
function gradientSky(): ReturnType<typeof makeSkyUniforms> {
  const uniforms = makeSkyUniforms();
  uniforms.uSkyHorizon.value.setHex(0x9dc0e6);
  uniforms.uSkyZenith.value.setHex(0x3d7ac4);
  return uniforms;
}

/** What a full moon's own peak is allowed to be, which the palette decides. See `Palette`. */

const moon = (azimuthDegrees: number, altitudeDegrees: number): Lit => ({
  body: "moon",
  altitudeDegrees,
  azimuthDegrees,
  relativeBrightness: 1,
});

/**
 * **The scene is local ENU with y up: x runs east and z runs SOUTH.**
 *
 * A true bearing therefore becomes `(sin, -cos)` in the horizontal plane, and getting it
 * backwards puts the moon on the opposite side of the sky and lays its path away from where
 * it belongs. It reads as plausible in a still frame - the same failure as the sidelight
 * arcs, and as hard to see.
 */
describe("where a body is in the scene's own axes", () => {
  it("puts north down the negative z axis and east down the positive x", () => {
    const north = towardsBody(moon(0, 0));
    expect(north.x).toBeCloseTo(0, 9);
    expect(north.z).toBeCloseTo(-1, 9);

    const east = towardsBody(moon(90, 0));
    expect(east.x).toBeCloseTo(1, 9);
    expect(east.z).toBeCloseTo(0, 9);

    const south = towardsBody(moon(180, 0));
    expect(south.z).toBeCloseTo(1, 9);
  });

  it("takes altitude up the y axis, and hands back a unit vector", () => {
    expect(towardsBody(moon(191, 90)).y).toBeCloseTo(1, 9);
    for (const [azimuth, altitude] of [
      [0, 0],
      [191, 41],
      [305, 12],
      [90, 89],
    ]) {
      expect(towardsBody(moon(azimuth ?? 0, altitude ?? 0)).length()).toBeCloseTo(1, 9);
    }
  });
});

/**
 * The gradient is chosen rather than computed - Preetham and Hosek both want a turbidity
 * nobody writes down - but which end is which is not a matter of taste. A clear sky is
 * deepest overhead and pales towards the horizon, because a grazing line of sight runs
 * through far more air, and that pale end is exactly what a reflection off water sees.
 */
describe("the sky a flat water surface hands back", () => {
  it("runs from the horizon's colour to the zenith's", () => {
    const uniforms = gradientSky();
    expect(skyColourAt(new Vector3(0, 1, 0), uniforms).getHex()).toBe(0x3d7ac4);
    expect(skyColourAt(new Vector3(1, 0, 0), uniforms).getHex()).toBe(0x9dc0e6);
  });

  /** A reflection off the back of a wave can point downwards, and there is no ground here. */
  it("gives the horizon's colour below the horizon rather than nothing", () => {
    const uniforms = gradientSky();
    expect(skyColourAt(new Vector3(0, -1, 0), uniforms).getHex()).toBe(0x9dc0e6);
  });

  /**
   * The paling is confined to the lowest part of the sky rather than spread evenly up it,
   * which is where the air is: half way up is nearer the zenith than the horizon.
   */
  it("keeps the paling near the horizon rather than spreading it up the sky", () => {
    const uniforms = gradientSky();
    const halfway = skyColourAt(new Vector3(0, Math.SQRT1_2, Math.SQRT1_2).normalize(), uniforms);
    const horizon = new Color(0x9dc0e6);
    const zenith = new Color(0x3d7ac4);
    expect(Math.abs(halfway.b - zenith.b)).toBeLessThan(Math.abs(halfway.b - horizon.b));
  });
});

/**
 * **The path is the evidence.** Where a body is reflected off a wavy sea it lays a lane of
 * light, and a target on its bearing is seen against it or lost in it - which is the kind of
 * thing a report argues about.
 */
describe("the path a body lays", () => {
  /**
   * The slope variance a 3 m sea has to add up to - Cox and Munk's, from
   * `core/illumination.ts`. The lobe's own width follows from it and from whatever the
   * normals under a fragment are carrying, which the second argument to `skyColourAt` says.
   */
  const measured = 0.0636;

  it("is brightest towards the body and falls away from it", () => {
    const uniforms = gradientSky();
    setSkyBody(uniforms, moon(191, 41), measured);

    const at = (azimuth: number): number =>
      skyColourAt(towardsBody(moon(azimuth, 41)), uniforms).getHSL({ h: 0, s: 0, l: 0 }).l;

    expect(at(191)).toBeGreaterThan(at(191 + 20));
    expect(at(191 + 20)).toBeGreaterThan(at(191 + 60));
  });

  /**
   * **A Gaussian this wide has a tail, and the tail must not become the sky.** Two bodies
   * at the same altitude on opposite bearings are only 98 degrees apart, where a lobe of
   * nineteen degrees still carries a ten-thousandth of its peak - so a peak chosen for the
   * core alone lifts the whole sky. It is what a first draft of this did, by about a third
   * of the night palette.
   */
  it("leaves the far side of the sky where it found it", () => {
    const uniforms = gradientSky();
    setSkyBody(uniforms, moon(191, 41), measured);

    const away = towardsBody(moon(11, 41));
    const withPath = skyColourAt(away, uniforms).r;
    const without = skyColourAt(away, gradientSky()).r;
    // A twentieth of the night sky's own brightness, which is 0x05 in the red.
    expect(withPath - without).toBeLessThan(0.05 / 20);
  });

  /**
   * **A wider sea lays a wider path**, which is the whole reason the width is computed rather
   * than chosen: the lane's angular width IS a measurement of the surface's slope.
   */
  /**
   * **Spreading light does not make more of it.** A rougher sea takes the same body and lays
   * it over more sky, so the path reaches further out AND is dimmer in the middle. The peak
   * used to be a constant while the width was a variable, which is a mirror that manufactures
   * light as the water roughens.
   */
  it("spreads the same light further rather than making more of it", () => {
    const narrow = gradientSky();
    const wide = gradientSky();
    setSkyBody(narrow, moon(191, 41), 0.01);
    setSkyBody(wide, moon(191, 41), 0.09);

    const lightness = (u: ReturnType<typeof makeSkyUniforms>, at: Vector3): number =>
      skyColourAt(at, u).getHSL({ h: 0, s: 0, l: 0 }).l;

    const middle = towardsBody(moon(191, 41));
    expect(lightness(wide, middle), "dimmer in the middle").toBeLessThan(lightness(narrow, middle));

    const wayOff = towardsBody(moon(191 + 60, 41));
    expect(lightness(wide, wayOff), "and further out").toBeGreaterThan(lightness(narrow, wayOff));
  });

  /**
   * **No sea stated, no path.** There is then no slope to widen the body with, and a
   * mirror-sharp moon on dead flat water would assert a calm nobody recorded - the strongest
   * claim this renderer can make about a sea it was told nothing about.
   */
  it("draws no path at all where nothing states a sea", () => {
    const uniforms = gradientSky();
    setSkyBody(uniforms, moon(191, 41), null);

    const towards = towardsBody(moon(191, 41));
    expect(skyColourAt(towards, uniforms).getHex()).toBe(
      skyColourAt(towards, gradientSky()).getHex(),
    );
  });

  /**
   * A sea stated calm mirrors: the body keeps its own half degree - which is why eclipses
   * work - and lays a point of light rather than a lane.
   */
  it("leaves a stated calm the body's own disc rather than nothing", () => {
    const uniforms = gradientSky();
    setSkyBody(uniforms, moon(191, 41), 0);
    expect((uniforms.uSkyBodyLobe.value.y * 180) / Math.PI).toBeCloseTo(0.265, 3);
    expect(uniforms.uSeaSlope.value).toBe(0);
  });

  /**
   * **The lane keeps its width as the sea's own shading gives it up.** The shading drops each
   * component where the range runs out of pixels for it and fades the lot to flat past a few
   * kilometres, so a lobe sized once against the whole drawn spectrum would narrow with
   * distance and end as a mirror spot. What the normals no longer carry is given back here.
   */
  it("widens the lobe by exactly what the normals have stopped carrying", () => {
    const uniforms = gradientSky();
    setSkyBody(uniforms, moon(191, 41), measured);
    const towards = towardsBody(moon(191, 41));

    // Near the eye the normals carry the drawn sea's own slope; far out they carry none.
    const drawn = Math.tan((6.0 * Math.PI) / 180) ** 2;
    // Dead centre the far lobe is the DIMMER, being the same light over more sky. It used to
    // be the same height, which is a reflection that brightens as its mirror roughens.
    expect(skyColourAt(towards, uniforms, 0).r).toBeLessThan(
      skyColourAt(towards, uniforms, drawn).r,
    );

    // Well off the middle, the far lobe is the wider - which is the point.
    const off = towardsBody(moon(191, 41 + 40));
    expect(skyColourAt(off, uniforms, 0).r).toBeGreaterThan(skyColourAt(off, uniforms, drawn).r);
  });

  it("draws no path where no body is up", () => {
    const uniforms = gradientSky();
    setSkyBody(uniforms, null, measured);
    expect(uniforms.uSkyBodyLobe.value.y).toBe(0);
  });

  /**
   * A crescent lays a dimmer path than a full moon, in the ratio the phase law gives. Both
   * halves are honest now: the ratio was always computed and the absolute is too, being the
   * lux the body delivers rather than a figure per drawn condition.
   */
  it("dims the path with the body rather than only moving it", () => {
    const full = gradientSky();
    const crescent = gradientSky();
    setSkyBody(full, { ...moon(191, 41), relativeBrightness: 1 }, measured);
    setSkyBody(crescent, { ...moon(191, 41), relativeBrightness: 0.06 }, measured);
    expect(crescent.uSkyBodyLobe.value.x).toBeCloseTo(full.uSkyBodyLobe.value.x * 0.06, 9);
  });

  /**
   * **The sun is not held at a ceiling any more, and must not be.** It was, because the
   * figure was a screen value and four hundred thousand times a full moon would have taken
   * the picture off the top of it - so a sunlit sea and a moonlit one were drawn as though
   * they returned the same light, which is the flattening issue #60 is about. In lux the
   * ratio is simply true, and what keeps it on a screen is the exposure.
   */
  it("puts the sun four hundred thousand times over a full moon, not level with it", () => {
    const sun = gradientSky();
    const full = gradientSky();
    setSkyBody(sun, { ...moon(191, 41), body: "sun", relativeBrightness: 400_000 }, measured);
    setSkyBody(full, { ...moon(191, 41), relativeBrightness: 1 }, measured);

    expect(sun.uSkyBodyLobe.value.x / full.uSkyBodyLobe.value.x).toBeCloseTo(400_000, 0);
    expect(full.uSkyBodyLobe.value.x, "a full moon's own quarter of a lux").toBeCloseTo(0.25, 9);
  });

  /**
   * **The peak is the body's flux spread over the lobe**, so a rougher sea does not merely
   * widen the path, it dims it: the same light over more sky. That relation used to be
   * missing - the peak was a constant and the width a variable, so a flat calm and a gale
   * mirrored the moon at the same brightness.
   */
  it("dims the path as the sea spreads it, because the light is the same light", () => {
    const uniforms = gradientSky();
    setSkyBody(uniforms, { ...moon(191, 41), relativeBrightness: 1 }, measured);
    const towards = towardsBody(moon(191, 41));

    const sharp = skyColourAt(towards, uniforms, measured * 0.99).r;
    const spread = skyColourAt(towards, uniforms, 0).r;
    expect(spread).toBeLessThan(sharp);
  });
});

/**
 * **The sky above the waterline and the sky in the water are the same sky.**
 *
 * Water at a grazing angle hands back very nearly the sky just above the horizon, so a second
 * definition of the gradient would show as a seam along the waterline - the join is where a
 * mismatch appears first and where nobody would fail to see it.
 */
describe("the sky above the water", () => {
  /** The slope variance a 2 m sea has to add up to, as in the block above. */
  const measured = 0.0636;

  it("meets the water's own reflection at the horizon", () => {
    const uniforms = gradientSky();
    setSkyBody(uniforms, moon(191, 41), measured);

    // A ray just above the horizon, and the same ray as the water would reflect it.
    const grazing = new Vector3(0.2, 0.004, -0.98).normalize();
    const dome = skyDomeColourAt(grazing, uniforms);
    const water = skyColourAt(grazing, uniforms, 0);
    // Both are the same gradient plus a body of different widths, and the body is 130 degrees
    // away from this ray - so what is left at the waterline is the gradient, twice.
    expect(Math.abs(dome.b - water.b)).toBeLessThan(0.01);
    expect(dome.b).toBeCloseTo(skyGradientAt(grazing, uniforms).b, 6);
  });

  /**
   * **The body is in the sky whether or not a sea is stated.** The guard that keeps it out of
   * the reflection is about not asserting a calm nobody recorded, which is an argument about
   * water; the moon is up regardless of what anybody wrote down about the sea.
   */
  it("shows the body over a sea nobody stated, where the water shows none", () => {
    const uniforms = gradientSky();
    setSkyBody(uniforms, moon(191, 41), null);
    const towards = towardsBody(moon(191, 41));

    expect(skyDomeColourAt(towards, uniforms).b).toBeGreaterThan(
      skyGradientAt(towards, uniforms).b,
    );
    expect(skyColourAt(towards, uniforms, 0).getHex()).toBe(
      skyGradientAt(towards, uniforms).getHex(),
    );
  });

  /**
   * In the sky the body is its own half degree across. It is the sea that spreads a
   * reflection, and there is no sea up there.
   */
  it("draws the body at its own size rather than the sea's", () => {
    const uniforms = gradientSky();
    setSkyBody(uniforms, moon(191, 41), measured);

    // Five degrees off it: well inside the sea's lobe, and far outside the disc.
    const off = towardsBody(moon(196, 41));
    expect(skyDomeColourAt(off, uniforms).b).toBeCloseTo(skyGradientAt(off, uniforms).b, 6);
    expect(skyColourAt(off, uniforms, 0).b).toBeGreaterThan(skyGradientAt(off, uniforms).b);
  });

  /** And a sky with nothing up is the gradient and nothing else. */
  it("is the gradient alone when no body is up", () => {
    const uniforms = gradientSky();
    setSkyBody(uniforms, null, measured);
    const towards = new Vector3(0, 0.5, -0.87).normalize();
    expect(skyDomeColourAt(towards, uniforms).getHex()).toBe(
      skyGradientAt(towards, uniforms).getHex(),
    );
  });
});

/**
 * The GLSL and `skyColourAt` are one function written twice, because nothing in Node can
 * compile a shader to ask it what it draws. Drifting apart would put one sky in the water and
 * another in every test here.
 */
describe("the copy that runs on the card", () => {
  /**
   * The dome's fragment shader is the mirror of `skyDomeColourAt`, and what must not creep
   * into it is the water's guard: a body is up whether or not anybody stated a sea.
   */
  it("draws the dome from the gradient and the body's own size, with no sea in it", () => {
    expect(SKY_DOME_GLSL).toContain("skyGradient( towards ) + bodyGlow( towards, uSkyBodyLobe.y )");
    expect(SKY_DOME_GLSL).not.toContain("uSeaSlope");
    // And the water keeps it, which is exactly where the two differ.
    expect(SKY_GLSL).toContain("if ( uSeaSlope < 0.0 ) return sky;");
  });

  it("declares every uniform it is given, and keeps the same shape", () => {
    // Whatever type each is: a missed declaration compiles nothing and draws no sky.
    for (const name of Object.keys(makeSkyUniforms())) {
      expect(SKY_GLSL, name).toMatch(new RegExp(`uniform (vec2|vec3|float) ${name};`));
    }
    expect(SKY_GLSL).toContain("vec3 skyTowards( vec3 towards, float carried )");
    // The gradient, and the Gaussian lobe on top of it.
    expect(SKY_GLSL).toContain("mix( uSkyHorizon, uSkyZenith");
    expect(SKY_GLSL).toContain("exp( -0.5 * pow( away / width, 2.0 ) )");
    // The same difference the TypeScript mirror takes, written the same way round - and in
    // a function, since the lamps reflect in the same water and must share the width.
    expect(SKY_GLSL).toContain("float lobeWidth( float carried, float radius )");
    expect(SKY_GLSL).toContain("max( uSeaSlope - carried, 0.0 )");
  });
});

/**
 * **One gradient function is not enough if its two ends leave through different pipelines.**
 *
 * The water is a patched `MeshStandardMaterial`, so it ends inside three's own
 * `opaque_fragment`, which converts the linear colour it has been working in to whatever
 * colour space the canvas wants. The dome writes `gl_FragColor` itself and nothing does that
 * for it - so the same uniforms, through the same function, came out of the two ends
 * differently: a direction asking for sRGB (98, 143, 205) was drawn (32, 73, 158), which is
 * that colour's linear triple written out raw. The sky above the waterline was dark and the
 * sea below it was not.
 *
 * Held by tying the dome to the chunk the water goes through rather than to a literal, since
 * the claim is that the two agree and not that either says any particular thing.
 */
describe("the dome and the water leave by the same door", () => {
  it("converts its colour the way three's own materials do", () => {
    const dome = buildSkyDome(gradientSky());
    const material = dome.material as ShaderMaterial;

    expect(
      ShaderLib.physical?.fragmentShader,
      "which is the shader the water is patched into",
    ).toContain("colorspace_fragment");
    expect(material.fragmentShader).toContain("colorspace_fragment");
  });
});
