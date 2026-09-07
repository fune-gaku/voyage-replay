import { MeshStandardMaterial, type WebGLRenderer } from "three";
import { describe, expect, it } from "vitest";

import { seawayOf, waveComponents, type WaveComponent } from "../src/core/seaway.js";
import {
  applyWaves,
  displacedFraction,
  makeWaveUniforms,
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
    vertexShader: "void main() {\n#include <begin_vertex>\n}",
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
    expect(shader.fragmentShader).toContain("uniform vec3 uSkyColour");
    expect(shader.fragmentShader).toContain("normal = normalize( mix( normal, waved, fade ) )");
    expect(shader.fragmentShader).toContain("outgoingLight = mix( outgoingLight, uSkyColour");
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
    expect(shader.uniforms["uSkyColour"]).toBe(uniforms.uSkyColour);
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
