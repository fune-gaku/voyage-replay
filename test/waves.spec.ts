import { MeshStandardMaterial, ShaderLib, type WebGLRenderer } from "three";
import { describe, expect, it } from "vitest";

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
  makeWaveUniforms,
  drawable,
  meshCarries,
  pixelAngle,
  setWaves,
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
    expect(shader.fragmentShader).toContain("lampsTowards( back, vWaveWorld, gCarriedSlope )");

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
      expect(stage).toMatch(/float wavelength = 6\.2831853 \/ length\( w\.xy \);/);
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
   * A centimetre of sea is where this bites: only one component of the forty clears the
   * floor, so without the rescaling the water would be drawn at 45 per cent of the height
   * printed beside it - and nothing on the page would say which figure was the picture's.
   */
  it("gives the survivors the share of the ones that went", () => {
    const whole = waveComponents(seawayOf(0.01));
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
