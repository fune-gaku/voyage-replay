import { MeshStandardMaterial, ShaderLib, type WebGLRenderer } from "three";
import { describe, expect, it } from "vitest";

import { CALM_SLOPE_VARIANCE } from "../src/core/illumination.js";
import {
  DRAWN_COMPONENTS,
  seawayOf,
  waveComponents,
  type WaveComponent,
} from "../src/core/seaway.js";
import { DISC } from "../src/render/water.js";
import {
  applyWaves,
  displacedFraction,
  drawnFoam,
  foamAt,
  foamOver,
  foamThreshold,
  makeWaveUniforms,
  drawable,
  meshCarries,
  pixelAngle,
  rippleOctaves,
  setWaves,
  shortestDrawnMetres,
  SHADER_COMPONENTS,
} from "../src/render/waves.js";

/**
 * The chunk names three would hand a material, and nothing else. If a future three renames
 * one of these, the injection silently does nothing and the sea renders flat - which is
 * exactly the failure this file exists to catch, since a flat sea is a claim.
 */
function shaderStub(): {
  uniforms: Record<string, unknown>;
  vertexShader: string;
  fragmentShader: string;
} {
  return {
    uniforms: {},
    vertexShader: "void main() {\n#include <begin_vertex>\n#include <project_vertex>\n}",
    fragmentShader:
      "void main() {\n#include <normal_fragment_begin>\n#include <opaque_fragment>\n}",
  };
}

function compile(material: MeshStandardMaterial): ReturnType<typeof shaderStub> {
  const shader = shaderStub();
  // three's own signature; nothing in the patch touches the renderer.
  material.onBeforeCompile(
    shader as unknown as Parameters<MeshStandardMaterial["onBeforeCompile"]>[0],
    null as unknown as WebGLRenderer,
  );
  return shader;
}

function component(overrides: Partial<WaveComponent> = {}): WaveComponent {
  return {
    amplitudeMetres: 1,
    wavenumberPerMetre: 0.1,
    angularFrequencyPerSecond: 1,
    directionRadians: 0,
    phaseRadians: 0,
    ...overrides,
  };
}

describe("packing a sea into uniforms", () => {
  /**
   * `coords.ts` decides the axes: x is east, z is SOUTH. A wave running north therefore has
   * its wavenumber along -z, and getting this backwards makes a sea that travels the
   * opposite way - which looks entirely plausible until somebody reads it against a stated
   * wave direction.
   */
  it("points a wave's wavenumber the way it travels, in the scene's own axes", () => {
    const uniforms = makeWaveUniforms();
    const north = 0;
    const east = Math.PI / 2;

    setWaves(uniforms, [component({ directionRadians: north })]);
    expect(uniforms.uWave.value[0]?.x).toBeCloseTo(0, 9);
    expect(uniforms.uWave.value[0]?.y).toBeCloseTo(-0.1, 9);

    setWaves(uniforms, [component({ directionRadians: east })]);
    expect(uniforms.uWave.value[0]?.x).toBeCloseTo(0.1, 9);
    expect(uniforms.uWave.value[0]?.y).toBeCloseTo(0, 9);
  });

  it("carries the amplitude and frequency through, and the phase beside them", () => {
    const uniforms = makeWaveUniforms();
    setWaves(uniforms, [
      component({ amplitudeMetres: 0.4, angularFrequencyPerSecond: 0.7, phaseRadians: 2 }),
    ]);
    expect(uniforms.uWave.value[0]?.z).toBeCloseTo(0.4, 9);
    expect(uniforms.uWave.value[0]?.w).toBeCloseTo(0.7, 9);
    expect(uniforms.uWavePhase.value[0]).toBeCloseTo(2, 9);
  });

  it("zeroes the slots a shorter sea does not fill, so nothing is left over", () => {
    const uniforms = makeWaveUniforms();
    setWaves(uniforms, [component({ amplitudeMetres: 0.4 })]);
    setWaves(uniforms, []);
    for (let i = 0; i < SHADER_COMPONENTS; i += 1) {
      expect(uniforms.uWave.value[i]?.z).toBe(0);
    }
  });

  it("drops components past what the shader carries rather than overrunning", () => {
    const uniforms = makeWaveUniforms();
    const many = Array.from({ length: SHADER_COMPONENTS + 10 }, () => component());
    expect(() => {
      setWaves(uniforms, many);
    }).not.toThrow();
    expect(uniforms.uWave.value).toHaveLength(SHADER_COMPONENTS);
  });

  it("takes a real sea straight from the spectrum", () => {
    const uniforms = makeWaveUniforms();
    setWaves(uniforms, waveComponents(seawayOf(3)));
    const amplitudes = uniforms.uWave.value.map((w) => w.z);
    expect(amplitudes.filter((a) => a > 0).length).toBeGreaterThan(10);
  });
});

describe("patching the water's shader", () => {
  it("puts the displacement, the normals and the reflection where three expects them", () => {
    const material = new MeshStandardMaterial();
    applyWaves(material, makeWaveUniforms());
    const shader = compile(material);

    expect(shader.vertexShader).toContain("uniform vec4 uWave");
    expect(shader.vertexShader).toContain("transformed.y +=");
    expect(shader.fragmentShader).toContain("vec3 skyTowards( vec3 towards, float carried )");
    expect(shader.fragmentShader).toContain("normal = normalize( mix( normal, waved, fade ) )");
    expect(shader.fragmentShader).toContain("outgoingLight = mix( outgoingLight, handed, sky )");
    // The lane's width is settled per fragment, from what these normals are still carrying.
    expect(shader.fragmentShader).toContain("gCarriedSlope +=");
    expect(shader.fragmentShader).toContain("skyTowards( back, gCarriedSlope )");
    // And the lamps are reflected in the same water, added to the sky rather than over it.
    expect(shader.fragmentShader).toContain(
      "lampsTowards( back, vWaveWorld, gWorldNormal, gCarriedSlope, lit )",
    );
    // And what the lamps LIGHT is added after the mix, because it is not a reflection.
    expect(shader.fragmentShader).toContain("outgoingLight += lit;");

    // **The reflection starts from the water as DRAWN**, so the world position is taken
    // again after everything that moves it - the waves here and the curvature's drop, which
    // `curvature.ts` applies afterwards. Taken once at the top, the ray would leave the mean
    // sea while the normal it bounces off belongs to the drawn one.
    const first = shader.vertexShader.indexOf("vWaveWorld = ");
    const again = shader.vertexShader.lastIndexOf("vWaveWorld = ");
    expect(again).toBeGreaterThan(first);
    expect(shader.vertexShader.indexOf("transformed.y +=")).toBeLessThan(again);
    expect(shader.vertexShader.slice(again)).toContain("#include <project_vertex>");
    // The chunks are still there: the injections wrap them rather than replacing them.
    expect(shader.vertexShader).toContain("#include <begin_vertex>");
    expect(shader.fragmentShader).toContain("#include <opaque_fragment>");
  });

  it("hands the shader the same uniform objects, so setting one is seen", () => {
    const material = new MeshStandardMaterial();
    const uniforms = makeWaveUniforms();
    applyWaves(material, uniforms);
    const shader = compile(material);

    expect(shader.uniforms["uWave"]).toBe(uniforms.uWave);
    expect(shader.uniforms["uWaveTime"]).toBe(uniforms.uWaveTime);
    expect(shader.uniforms["uWaveScale"]).toBe(uniforms.uWaveScale);
    expect(shader.uniforms["uSkyHorizon"]).toBe(uniforms.sky.uSkyHorizon);
    expect(shader.uniforms["uSkyBody"]).toBe(uniforms.sky.uSkyBody);
  });

  /**
   * The water is curved as well as waved and `curvature.ts` gets there first. A patch that
   * assigned over `onBeforeCompile` would compile, run, and quietly draw a flat earth - and
   * the same for the cache key, without which three hands back the program it built for a
   * material with the same parameters and half the shader never happens.
   */
  it("composes with a patch already on the material rather than replacing it", () => {
    const material = new MeshStandardMaterial();
    let earlierRan = false;
    material.onBeforeCompile = (shader): void => {
      earlierRan = true;
      shader.vertexShader = `// earlier\n${shader.vertexShader}`;
    };
    material.customProgramCacheKey = (): string => "curved";

    applyWaves(material, makeWaveUniforms());
    const shader = compile(material);

    expect(earlierRan).toBe(true);
    expect(shader.vertexShader).toContain("// earlier");
    expect(shader.vertexShader).toContain("transformed.y +=");
    expect(material.customProgramCacheKey()).toContain("curved");
    expect(material.customProgramCacheKey()).not.toBe("curved");
  });
});

describe("how far the drawn sea keeps its shape", () => {
  /**
   * The fade is the mesh's limit, not the sea's: past it the water's geometry is flat
   * however rough the sea. Anything that floats has to use this same number, or it rides a
   * wave the water is no longer showing.
   */
  it("is whole close in, gone far out, and never increases with distance", () => {
    expect(displacedFraction(0)).toBe(1);
    expect(displacedFraction(100)).toBe(1);
    expect(displacedFraction(10_000)).toBe(0);

    let previous = 1;
    for (let d = 0; d <= 1200; d += 25) {
      const here = displacedFraction(d);
      expect(here).toBeLessThanOrEqual(previous + 1e-12);
      expect(here).toBeGreaterThanOrEqual(0);
      expect(here).toBeLessThanOrEqual(1);
      previous = here;
    }
  });

  /** Smoothstep, so it leaves and arrives flat rather than with a visible crease. */
  it("passes through a half at the middle of the band and eases in at both ends", () => {
    const edges = [0, 1200].map((d) => displacedFraction(d));
    expect(edges).toEqual([1, 0]);

    const middle = (() => {
      let low = 0;
      let high = 1200;
      for (let i = 0; i < 60; i += 1) {
        const mid = (low + high) / 2;
        if (displacedFraction(mid) > 0.5) low = mid;
        else high = mid;
      }
      return high;
    })();
    const slopeAtMiddle = (displacedFraction(middle - 5) - displacedFraction(middle + 5)) / 10;
    const slopeNearEnd =
      (displacedFraction(middle * 1.9) - displacedFraction(middle * 1.9 + 10)) / 10;
    expect(slopeAtMiddle).toBeGreaterThan(slopeNearEnd * 5);
  });
});

describe("the shader carries the whole sea it was given", () => {
  /**
   * `normalised` shares the variance across every component it makes, so a shader with room
   * for fewer would drop the remainder in silence and draw a flatter sea than the panels
   * reason about - with every figure on the page still correct. Two constants is all that
   * would take, so there is only one.
   */
  it("has room for exactly as many components as a sea is built from", () => {
    expect(SHADER_COMPONENTS).toBe(DRAWN_COMPONENTS);
    for (const hs of [0.5, 3, 12]) {
      expect(waveComponents(seawayOf(hs))).toHaveLength(SHADER_COMPONENTS);
    }
  });

  /** And the variance survives the trip into the uniforms, which is the point of the count. */
  it("keeps the significant height across the packing", () => {
    const uniforms = makeWaveUniforms();
    const seaway = seawayOf(3);
    setWaves(uniforms, waveComponents(seaway));

    const packed = uniforms.uWave.value.reduce((total, wave) => total + wave.z ** 2 / 2, 0);
    expect(Math.sqrt(packed)).toBeCloseTo(seaway.surfaceStdDevMetres, 6);
  });
});

/**
 * **The chunk names are three's, and a rename is a silent flat sea.**
 *
 * Every patch here is a string replacement on three's own shader. If a future three renames
 * one of these includes, the replacement finds nothing, does nothing, and the water renders
 * without the thing that was meant to be injected - which for the displacement is a flat sea,
 * and for the reflection is water that hands back the mean surface. The stub above cannot
 * catch that, because it is written here; this asks three.
 */
describe("the chunks three actually has", () => {
  it("still contains every include this file replaces", () => {
    const { vertexShader, fragmentShader } = ShaderLib.standard;
    expect(vertexShader).toContain("#include <begin_vertex>");
    expect(vertexShader).toContain("#include <project_vertex>");
    expect(fragmentShader).toContain("#include <normal_fragment_begin>");
    expect(fragmentShader).toContain("#include <opaque_fragment>");
  });

  /** And the order they come in, since the reflection has to be taken after the lift. */
  it("puts the projection after the displacement it has to follow", () => {
    const vertex = ShaderLib.standard.vertexShader;
    expect(vertex.indexOf("#include <begin_vertex>")).toBeLessThan(
      vertex.indexOf("#include <project_vertex>"),
    );
  });
});

/**
 * **Short waves have to leave the picture before they stop being pictures.**
 *
 * The band now reaches down to a metre or two, which is where a sea's slope lives - and a
 * wave narrower than the thing sampling it does not come out short, it comes out as noise
 * crawling over the water. In the shading that is a sparkle; in the geometry it is a slow
 * false swell that moves the horizon and the hulls standing on it.
 */
describe("dropping each component where its own wavelength runs out", () => {
  /**
   * The disc's rings grow by 8.73 per cent of their radius, so vertices are 22 m apart at
   * 250 m. The 117 m swell of a 3 m sea still has five of them to a wavelength there; a 2 m
   * wave has a tenth of one, and drawing it is drawing the aliasing rather than the wave.
   */
  it("keeps the swell where the mesh is coarse and drops the chop", () => {
    expect(meshCarries(117, 250)).toBeGreaterThan(0.5);
    expect(meshCarries(2, 250)).toBeLessThan(0.01);
  });

  /** Just outside the innermost ring the rings are half a metre apart, and a chop is drawable. */
  it("gives the same short wave back near the eye, where there are vertices for it", () => {
    expect(meshCarries(12, DISC.innerMetres * 1.01)).toBeCloseTo(1, 6);
    expect(meshCarries(12, 400)).toBeLessThan(0.05);
  });

  /**
   * **Inside the innermost ring there are no rings.** The disc closes with a fan from one
   * centre vertex, so the only samples across that cap are the centre and the rim - coarser
   * than anything outside it, and the one place a floor of "the rings are metres apart" got
   * it backwards. Nothing in a level bridge view is in there: a 20 m eye with a 55 degree
   * window sees water from about 38 m out.
   */
  it("treats the centre cap as the coarsest patch of the disc, not the finest", () => {
    expect(meshCarries(12, 1)).toBeLessThan(meshCarries(12, DISC.innerMetres * 1.01));
    // A fan 5 m across cannot hold a 12 m wave; the mesh a metre outside it can.
    expect(meshCarries(12, 1)).toBeLessThan(0.3);
  });

  /**
   * A fade rather than a cut, so a mark crossing the range does not step - and it only falls,
   * once past the centre cap. Inside that the disc is coarser again, which is the mesh's own
   * shape rather than this rule's.
   */
  it("fades rather than switches, and never leaves the unit interval", () => {
    let last = 1;
    for (const away of [10, 50, 100, 200, 400, 800, 2000]) {
      const carries = meshCarries(30, away);
      expect(carries, `${away} m`).toBeLessThanOrEqual(last + 1e-12);
      expect(carries, `${away} m`).toBeGreaterThanOrEqual(0);
      last = carries;
    }
  });

  /**
   * **Both stages have to do it, and they did not.** The fragment shader faded per component
   * while the vertex shader displaced the lot, so the geometry carried metre waves out to
   * 600 m as a false swell while the shading correctly dropped them. Nothing in the old
   * tests could see it: they checked that the chunks existed and how many components were
   * packed.
   */
  it("band-limits in the vertex stage as well as the fragment one", () => {
    const material = new MeshStandardMaterial();
    applyWaves(material, makeWaveUniforms());
    const shader = compile(material);

    for (const stage of [shader.vertexShader, shader.fragmentShader]) {
      // The component's own wavelength, and the amplitude multiplied by what it earns.
      expect(stage).toMatch(/float length2 = length\( w\.xy \);/);
      expect(stage).toMatch(/float wavelength = 6\.2831853 \/ length2;/);
      expect(stage).toMatch(/float carries = smoothstep\(/);
      expect(stage).toMatch(/carries \* w\./);
    }
  });

  /**
   * The two stages measure against different things - the vertex against the mesh under it,
   * the fragment against a pixel - and only the second can be a property of the frame.
   */
  it("measures the vertex stage against the mesh and the fragment against a pixel", () => {
    const material = new MeshStandardMaterial();
    applyWaves(material, makeWaveUniforms());
    const shader = compile(material);

    expect(shader.vertexShader).toContain("away < 5.0 ? 5.0 : away * 0.087278");
    expect(shader.vertexShader).toContain("wavelength / ( 8.0 * spacing )");
    // The uniform is declared in both stages; only the fragment one measures against it.
    expect(shader.fragmentShader).toContain("wavelength / ( away * uPixelAngle");
    expect(shader.fragmentShader).not.toContain("float spacing");
  });
});

/**
 * **A pixel's angle is a property of the frame, not a constant.** Fixed, the same wave would
 * survive to half the range in a short window and vanish at twice the size in a tall one, so
 * the drawn band would depend on how big somebody's browser is.
 */
describe("the angle the shortest drawable wave has to fill", () => {
  it("shrinks as the frame gains pixels, and holds for the same pixel size", () => {
    expect(pixelAngle(55, 1080)).toBeGreaterThan(pixelAngle(55, 2160));
    expect(pixelAngle(55, 2160)).toBeCloseTo(pixelAngle(55, 1080) / 2, 12);
    // Twice the view over twice the pixels is the same pixel, and the same band.
    expect(pixelAngle(110, 2160)).toBeCloseTo(pixelAngle(55, 1080), 12);
  });

  /** Eight pixels of a 55 degree view over 1080 rows: about two fifths of a degree. */
  it("comes out at the pixels a sinusoid needs to read as one", () => {
    expect((pixelAngle(55, 1080) * 180) / Math.PI).toBeCloseTo((55 / 1080) * 8, 9);
  });

  /** A frame with no height yet - a canvas before layout - must not divide by zero. */
  it("survives a frame that has no height yet", () => {
    expect(Number.isFinite(pixelAngle(55, 0))).toBe(true);
  });
});

/**
 * **The floor is a rule about the picture, so the picture is built from what it leaves.**
 *
 * A component under a millimetre costs a sine per vertex and draws nothing; the lowest bin
 * produces one on every sea, since it starts at a sixth of the peak frequency where the
 * spectrum holds nothing at all. What matters is that dropping them does not quietly flatten
 * the water: the sea the page prints a height for has to be the sea on screen.
 */
describe("what is too small to draw", () => {
  it("keeps the significant height after dropping what cannot be seen", () => {
    for (const hs of [3, 0.6, 0.05, 0.02, 0.01]) {
      const whole = waveComponents(seawayOf(hs));
      const shown = drawable(whole);
      if (shown.length === 0) continue;
      const heightOf = (components: WaveComponent[]): number =>
        4 * Math.sqrt(components.reduce((t, w) => t + w.amplitudeMetres ** 2 / 2, 0));
      expect(heightOf(shown), `${hs} m`).toBeCloseTo(heightOf(whole), 9);
    }
  });

  /**
   * Two centimetres of sea is where this bites: 23 of the forty components clear the floor
   * and seventeen do not, so without the rescaling the water would be drawn short of the
   * height printed beside it - and nothing on the page would say which figure was the
   * picture's. Below about thirteen millimetres nothing clears it at all, which the test
   * after this one holds.
   */
  it("gives the survivors the share of the ones that went", () => {
    const whole = waveComponents(seawayOf(0.02));
    const shown = drawable(whole);
    expect(shown.length).toBeLessThan(whole.length);
    expect(shown.length).toBeGreaterThan(0);
    expect(shown[0]?.amplitudeMetres ?? 0).toBeGreaterThan(whole[0]?.amplitudeMetres ?? 0);
  });

  /** And a sea nothing in it can show is drawn as nothing rather than as one tall wave. */
  it("draws nothing at all where no component clears the floor", () => {
    expect(drawable(waveComponents(seawayOf(0.004)))).toHaveLength(0);
  });
});

/**
 * **What floats has to ride the sea that is drawn**, and the band is now part of what is
 * drawn. A buoy 250 m out sits on a mesh that holds the swell and less than half the sea's
 * variance; giving her the whole spectrum there is the hovering buoy of #34 arriving by
 * another route - through the band this time rather than through the range fade.
 */
describe("the sea a floating mark is given", () => {
  const sea = waveComponents(seawayOf(3));

  /** Height and slope variance the mesh still carries at a distance, as fractions of the sea's. */
  function carried(away: number): { height: number; slope: number } {
    const parts = sea.map((wave: WaveComponent) => {
      const carries = meshCarries((2 * Math.PI) / wave.wavenumberPerMetre, away);
      return { wave, amplitude: wave.amplitudeMetres * carries };
    });
    const share = (of: (a: number, k: number) => number): number =>
      parts.reduce((t, p) => t + of(p.amplitude, p.wave.wavenumberPerMetre) ** 2, 0) /
      parts.reduce((t, p) => t + of(p.wave.amplitudeMetres, p.wave.wavenumberPerMetre) ** 2, 0);
    return { height: share((a) => a), slope: share((a, k) => a * k) };
  }

  /**
   * Nearly all of the HEIGHT survives close in - the sea's variance is in the long waves -
   * and less than half of it is left at 250 m, where the vertices are 22 m apart. A mark
   * there heaving to the whole spectrum would be heaving to twice the water under her.
   */
  it("takes the swell out to where the vertices run out, and drops the rest", () => {
    expect(carried(20).height).toBeGreaterThan(0.99);
    expect(carried(250).height).toBeLessThan(0.5);
    expect(carried(600).height).toBeLessThan(0.1);
  });

  /**
   * **The mesh carries about half the SLOPE even at the eye**, and that is not a fault to be
   * fixed: the nearest rings are 1.5 m apart, so eight samples is a 12 m wave, and the metre
   * waves the band now reaches down to exist in the shading alone. A mark is leaned by the
   * surface she sits on rather than by the one painted over it - the alternative is a buoy
   * rocking to crests that are not in the water beneath her.
   */
  it("leans a mark by the geometry, not by the shading painted over it", () => {
    expect(carried(20).slope).toBeGreaterThan(0.4);
    expect(carried(20).slope).toBeLessThan(0.7);
    expect(carried(250).slope).toBeLessThan(carried(250).height);
  });
});

/**
 * **The one thing about the foam that can be checked rather than argued.** The coverage is
 * Monahan's measured relation and the placement is this tool's choice, so the question the
 * choice has to answer is whether it actually puts that much of the surface under foam -
 * and the Rayleigh step assumes a slope field that is the same in every direction, which a
 * sea spread about one bearing is not.
 *
 * Run over a real sea's own components on a grid, and count.
 */
describe("how much of the sea comes out foam", () => {
  /** The drawn slope at one point of the surface and one instant, from the components. */
  function slopeSquaredAt(components: WaveComponent[], x: number, y: number, when = 0): number {
    let east = 0;
    let north = 0;
    for (const wave of components) {
      const kx = Math.sin(wave.directionRadians) * wave.wavenumberPerMetre;
      const ky = Math.cos(wave.directionRadians) * wave.wavenumberPerMetre;
      const phase = kx * x + ky * y - wave.angularFrequencyPerSecond * when + wave.phaseRadians;
      east += kx * Math.cos(phase) * wave.amplitudeMetres;
      north += ky * Math.cos(phase) * wave.amplitudeMetres;
    }
    return east * east + north * north;
  }

  /**
   * The mean of the foam field over a patch of sea, measured on ground the threshold was
   * not fitted on - a different grid, offset and differently spaced - so this is a check on
   * the level rather than a second reading of the fit.
   */
  function coverageOf(components: WaveComponent[], wanted: number): number {
    const variance = components.reduce(
      (total, w) => total + (w.amplitudeMetres * w.wavenumberPerMetre) ** 2 / 2,
      0,
    );
    const deviations = foamThreshold(components, wanted);
    let total = 0;
    let count = 0;
    for (let i = 0; i < 160; i += 1) {
      for (let j = 0; j < 160; j += 1) {
        const east = 811 + i * 4.3;
        const north = 517 + j * 5.1;
        // The same union over a whitecap's life the shader takes: foam lingers, so what is
        // under it now is what has been steep at any instant within that life.
        const overTime = [0, -2, -4].map((when) => slopeSquaredAt(components, east, north, when));
        total += foamOver(overTime, variance, deviations);
        count += 1;
      }
    }
    return total / count;
  }

  it("puts as much of the surface under foam as the wind says", () => {
    const components = waveComponents(seawayOf(3));
    // 18, 25 and 34 knots by Monahan's relation.
    for (const wanted of [0.0076, 0.023, 0.066]) {
      const drawn = coverageOf(components, wanted);
      expect(drawn, `${wanted}`).toBeGreaterThan(wanted * 0.75);
      expect(drawn, `${wanted}`).toBeLessThan(wanted * 1.35);
    }
  });

  /**
   * The analytic level this replaced. A Gaussian slope field of variance V has a Rayleigh
   * magnitude, so `sqrt(-V ln W)` is the level that leaves W above it - on a sea that is the
   * same in every direction. A real one is spread about one bearing, and the same level then
   * passes two and a half times the foam.
   */
  it("does not take the level a circular sea would have", () => {
    const components = waveComponents(seawayOf(3));
    const wanted = 0.0076;
    const circular = Math.sqrt(-Math.log(wanted));

    expect(foamThreshold(components, wanted)).toBeGreaterThan(circular * 1.1);
  });

  /**
   * **Foam has to last.** A threshold on this instant's steepness gives a whitecap no life -
   * it appears where a crest is steep and vanishes when the crest passes, so the sea blinks
   * rather than breaks. Monahan's coverage counts decaying foam as well as breaking water,
   * which is what makes this necessary rather than decorative.
   */
  it("leaves foam where the water was steep a moment ago", () => {
    const carried = 0.01;
    const steep = carried * 9;
    const level = 2;

    // Steep now: full foam. Steep only a while back: less, but not nothing.
    expect(foamOver([steep, 0, 0], carried, level)).toBeCloseTo(foamAt(steep, carried, level), 12);
    const lingering = foamOver([0, steep, 0], carried, level);
    expect(lingering).toBeGreaterThan(0);
    expect(lingering).toBeLessThan(foamAt(steep, carried, level));
  });

  /** Two breakings of one piece of water are one patch of foam, not two. */
  it("takes the strongest instant rather than adding them up", () => {
    const carried = 0.01;
    const steep = carried * 9;
    expect(foamOver([steep, steep, steep], carried, 2)).toBeLessThanOrEqual(1);
    expect(foamOver([steep, steep, steep], carried, 2)).toBeCloseTo(
      foamOver([steep, 0, 0], carried, 2),
      12,
    );
  });

  /**
   * And what lingers is inside the coverage rather than on top of it: the level is fitted
   * against the same union, so persistence does not quietly put more foam on the sea than
   * Monahan allows while the page goes on printing his figure.
   */
  it("asks more of the water now that foam lasts", () => {
    const components = waveComponents(seawayOf(3));
    const level = foamThreshold(components, 0.0076);
    const variance = components.reduce(
      (total, w) => total + (w.amplitudeMetres * w.wavenumberPerMetre) ** 2 / 2,
      0,
    );
    // Whatever is under foam at any one instant is less than the coverage, because the rest
    // of the coverage is water that broke earlier and has not finished fading.
    let instant = 0;
    for (let i = 0; i < 120; i += 1) {
      for (let j = 0; j < 120; j += 1) {
        instant += foamAt(
          slopeSquaredAt(components, 811 + i * 4.3, 517 + j * 5.1),
          variance,
          level,
        );
      }
    }
    expect(instant / (120 * 120)).toBeLessThan(0.0076);
  });

  it("draws none at all where nothing states a wind or a sea", () => {
    expect(foamThreshold(waveComponents(seawayOf(3)), 0)).toBe(0);
    expect(foamAt(1, 0.01, 0)).toBe(0);
  });

  /**
   * The far surface carries fewer components than the near one, so a threshold taken from
   * the whole sea would put foam in the foreground only - and a horizon of flat water under
   * a foreground of whitecaps is a picture of two different winds.
   */
  it("keeps the coverage where the surface is drawn smoother", () => {
    const components = waveComponents(seawayOf(3));
    const carried = components.reduce(
      (total, w) => total + (w.amplitudeMetres * w.wavenumberPerMetre) ** 2 / 2,
      0,
    );
    const steep = carried * 4;
    expect(foamAt(steep, carried, 2.5)).toBeCloseTo(foamAt(steep / 9, carried / 9, 2.5), 12);
  });

  /**
   * **Whitecaps are waves breaking, so there have to be waves.** The shader spends the
   * coverage on the drawn slopes where a fragment resolves them and as a flat fraction where
   * it does not; with nothing drawn the first is zero and the second is not, so the same
   * water would be glass in the foreground and foam at the horizon. A file stating a wind
   * and no sea reaches exactly that. Found reviewing #73.
   */
  it("carries none where there is no drawn sea to break", () => {
    const wind = 0.0433;

    expect(drawnFoam([], wind)).toEqual({ coverage: 0, standardDeviations: 0 });

    const components = waveComponents(seawayOf(3));
    const drawn = drawnFoam(components, wind);
    expect(drawn.coverage).toBe(wind);
    expect(drawn.standardDeviations).toBe(foamThreshold(components, wind));
    expect(drawn.standardDeviations).toBeGreaterThan(0);
  });
});

/**
 * **The one thing drawn here that the file's sea does not contain.** Measured, the shortest
 * wave the spectrum reaches is 1.14 m on a 2 m sea, which ten metres from the eye is 128
 * pixels across - so the near water had no feature finer than that, where a real one carries
 * centimetre ripples at one to eleven. Issue #70.
 */
describe("the texture below the drawn band", () => {
  /**
   * **A whitecap is a gravity wave breaking, so the level it is judged against has to be the
   * gravity waves'.** `rippleSlope` hands its own variance back into `gCarriedSlope`, which
   * is right for the reflection - the question there is how much roughness the surface is
   * drawing now - and wrong for the foam, whose level `foamThreshold` fitted to the
   * spectrum's own components. Near to, where the missing roughness is largest, the ripples
   * carry several times the gravity variance and the level rises with its square root, so
   * the foam vanishes from the foreground while the horizon keeps the flat fraction: one sea
   * with two sea states in it, by range. Found reviewing #75; the numerator was already
   * being taken before the ripples for exactly this reason, and only half the pair was.
   */
  /**
   * **The hiding is a mix, not a multiply.** Multiplied straight in, Smith's term takes the
   * water at the waterline to a sixth of the sky over it and leaves the sea darkest AT the
   * horizon - upside down. What a crest hides is filled with the sky the tilted facets do
   * reflect, two rms slopes above the mirror direction. Measured either side, on a 5 m sea:
   * the sea just under the waterline went from 0.16 of the sky to 0.62, and the step at the
   * waterline stayed (64 counts). Issue #81.
   */
  /**
   * **A file that states no sea does not state a mirror either.** `uSeaSlope` is negative
   * where nothing is stated, which is the gate the glitter path and the lamp streaks answer
   * to - they need a stated sea to have a width. The reflection does not: water reflects sky
   * whatever the file says, and drawing it perfectly sharp is a second claim on top of the
   * flat water. Cox and Munk's intercept is what a calm measures. Issue #81.
   */
  it("roughens a sea nobody stated by the calm Cox and Munk measured", () => {
    const material = new MeshStandardMaterial();
    applyWaves(material, makeWaveUniforms());
    const shader = compile(material);

    expect(shader.fragmentShader).toContain(
      `float rough = uSeaSlope < 0.0 ? ${CALM_SLOPE_VARIANCE.toFixed(4)} : uSeaSlope;`,
    );
    expect(shader.fragmentShader).toContain("float seen = shadowing( abs( look.y ), rough )");
    // And the gates that need a stated sea are still asking the uniform itself.
    expect(shader.fragmentShader).toContain("if ( uSeaSlope < 0.0 ) return sky;");
  });

  it("fills what a crest hides with sky rather than with nothing", () => {
    const material = new MeshStandardMaterial();
    applyWaves(material, makeWaveUniforms());
    const shader = compile(material);

    expect(shader.fragmentShader).toContain(
      "vec3 hidden = skyGradient( raisedBy( back, 2.0 * sqrt( rough ) ) )",
    );
    expect(shader.fragmentShader).toContain("handed = mix( hidden, handed, seen )");
    expect(shader.fragmentShader, "and never the bare multiply again").not.toContain(
      "handed *= shadowing(",
    );
  });

  /**
   * **A whitecap's history has to be measured on the sea the picture is drawing now.** The
   * shading loop drops each component at its own range as it accumulates the past, but not
   * the whole surface's fade to flat - so through the fade's transition the past would be
   * measured on a fuller sea than the level it is compared against, and claim foam that was
   * not breaking. Found reviewing #75.
   */
  it("fades a whitecap's history with the surface it was breaking on", () => {
    const material = new MeshStandardMaterial();
    applyWaves(material, makeWaveUniforms());
    const shader = compile(material);

    expect(shader.fragmentShader).toContain("vec2 was = gWas[ i - 1 ] * gSlopeFade");
    const set = shader.fragmentShader.indexOf("gSlopeFade = fade");
    const used = shader.fragmentShader.indexOf("* gSlopeFade");
    expect(set, "set where the present is faded").toBeGreaterThan(0);
    expect(set, "before the foam reads it").toBeLessThan(used);
  });

  /**
   * **The past is the same sum at a different phase**, so it is accumulated beside the
   * present rather than by walking the components again: `phase(t - age)` is
   * `phase(t) + omega * age`, and the wavelength, the band limit and the dot product do not
   * move. Two more cosines a component in place of two more passes over all of them, which
   * was half the frame. Issue #79.
   */
  it("takes a whitecap's history from the loop that is already there", () => {
    const material = new MeshStandardMaterial();
    applyWaves(material, makeWaveUniforms());
    const shader = compile(material);

    expect(shader.fragmentShader).toContain(
      "gWas[ h ] += carries * w.xy * w.z * cos( phase + w.w * age )",
    );
    expect(shader.fragmentShader, "and the second pass is gone").not.toContain("steepnessAt");
  });

  /**
   * A chart draws no sea: `uWaveScale` is zero there and every term multiplies out to
   * nothing - after the whole sum has been evaluated to find that out. Measured, a chart
   * went from 67 ms a frame to 41. And the array is filled in order with the rest zeroed,
   * so a spectrum of 23 components was costing 40. Issue #79.
   */
  it("does not evaluate a sea where none is drawn", () => {
    const material = new MeshStandardMaterial();
    applyWaves(material, makeWaveUniforms());
    const shader = compile(material);

    expect(shader.fragmentShader).toContain("if ( uWaveScale > 0.0 ) {");
    expect(shader.fragmentShader).toContain("if ( w.z <= 0.0 ) break;");
    expect(shader.vertexShader).toContain("if ( w.z <= 0.0 ) break;");
    // And no foam is weighed where the level it would be weighed against is nothing.
    expect(shader.fragmentShader).toContain("if ( uFoam.y > 0.0 ) {");
  });

  /**
   * **The octave count is a real number of octaves, and the loop is a constant.** `uRipple.y`
   * counts from the band's short end down to a centimetre, and a sea whose shortest drawn
   * wave is a few centimetres has fewer than the four the loop is long - the share is
   * `missing / uRipple.y`, so drawing four of three spends four thirds of the missing
   * variance, hands four thirds of it back to the lobe, and generates gravity ripples below
   * the centimetre this stops at. Reachable: a 20 cm sea's shortest drawn wave is under 16
   * cm. Found reviewing #75.
   */
  it("draws only the octaves that are there, and hands back only those", () => {
    // A metre of sea on a one-second period - short and steep, and a file may state it -
    // has its band's short end at 2 cm, so there is barely one octave under it.
    const steep = drawable(waveComponents(seawayOf(1, 1)));
    expect(rippleOctaves(shortestDrawnMetres(steep))).toBeLessThan(4);

    const material = new MeshStandardMaterial();
    applyWaves(material, makeWaveUniforms());
    const shader = compile(material);
    expect(shader.fragmentShader).toContain("float within = clamp( uRipple.y - octave, 0.0, 1.0 )");
    expect(shader.fragmentShader).toContain("perOctave * carries * within / 3.0");
    expect(shader.fragmentShader).toContain("gCarriedSlope += perOctave * carries * within");
  });

  it("judges a whitecap against the waves it breaks from, not the texture over them", () => {
    const material = new MeshStandardMaterial();
    applyWaves(material, makeWaveUniforms());
    const shader = compile(material);

    const taken = shader.fragmentShader.indexOf("gBreakingSlope = gCarriedSlope");
    const ripples = shader.fragmentShader.indexOf("slope += rippleSlope(");
    expect(taken, "the variance is taken").toBeGreaterThan(0);
    expect(taken, "before the ripples are added to it").toBeLessThan(ripples);

    expect(shader.fragmentShader).toContain("foamAt( gSlopeSquared, gBreakingSlope, uFoam.y )");
    expect(shader.fragmentShader).not.toContain("foamAt( gSlopeSquared, gCarriedSlope");
    // And the whitecap's own history is judged against the same surface as the instant.
    expect(shader.fragmentShader).not.toContain("dot( was, was ), gCarriedSlope");
  });

  it("starts where the spectrum's shortest wave ends", () => {
    const components = waveComponents(seawayOf(2));
    const lengths = components.map((c) => (2 * Math.PI) / c.wavenumberPerMetre);

    expect(shortestDrawnMetres(components)).toBeCloseTo(Math.min(...lengths), 9);
  });

  /**
   * A slope density falling as one over omega puts the same variance in every octave, so an
   * octave's share is the missing variance over the count of them - and the count runs from
   * the band's short end to a centimetre, below which a gravity relation has no business
   * generating anything.
   */
  it("shares the missing slope over the octaves between the band and a centimetre", () => {
    // 1.28 m is seven doublings above 0.01 m.
    expect(rippleOctaves(1.28)).toBeCloseTo(7, 9);
    expect(rippleOctaves(0.16)).toBeCloseTo(4, 9);
  });

  /**
   * A file that states no sea has no measured slope to fall short of, and a band that is
   * already at the floor has no octaves under it. Both must draw nothing rather than divide
   * by nothing.
   */
  it("draws none where there is no band under which to draw it", () => {
    expect(shortestDrawnMetres([])).toBe(0);
    expect(rippleOctaves(0)).toBe(0);
    expect(rippleOctaves(0.01)).toBe(0);
  });

  /**
   * **What it spends it hands back.** Every octave adds its own variance to the carried
   * slope, so the width of whatever is mirrored narrows by exactly what the surface took up.
   * Without it the picture would draw a sea rougher than Cox and Munk measured while the page
   * printed their figure - one water described twice, differently.
   */
  it("gives back to the lobe what it takes for the surface", () => {
    const material = new MeshStandardMaterial();
    applyWaves(material, makeWaveUniforms());
    const shader = compile(material);

    expect(shader.fragmentShader).toContain("gCarriedSlope += perOctave * carries * within");
    // And it is asked for the missing slope, not for the sea's whole slope.
    expect(shader.fragmentShader).toContain("max( uSeaSlope - gCarriedSlope, 0.0 )");
  });
});
