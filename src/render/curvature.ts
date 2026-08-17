/**
 * Bending the world, for the views that are standing on it.
 *
 * The arithmetic is `core/horizon.ts`; this is only how it reaches the picture. And it
 * reaches it two different ways on purpose:
 *
 * - **Big surfaces are displaced in the vertex shader.** The water and the land are tens of
 *   thousands of vertices each and the sinking varies across a single one of them, so it
 *   has to happen per vertex, on the GPU.
 * - **Ships are displaced on the CPU, whole.** There are a handful of them, and over one
 *   ship the sinking barely varies: on a 180 m hull at twenty kilometres, bow and stern
 *   differ by 0.49 m - a tilt of 0.16 degrees, in a renderer that models neither heel nor
 *   pitch. Moving the group by one number is exact enough and leaves `hull.ts` and
 *   `navlights.ts` untouched.
 *
 * Curvature belongs to the VIEW, not to the world. A chart has never been drawn on a curved
 * earth, so the plan view sets `uCurve` to zero and gets the flat plane it has always had -
 * the same shape of decision `setDiagramView` already makes about the lighting and the map.
 *
 * **The materials this is applied to must have a pure translation for a model matrix.** The
 * displacement is subtracted from the local Y, which is only the world Y when nothing has
 * been rotated or scaled. `terrain.ts` builds its tiles already oriented rather than as
 * planes turned on their side for exactly this reason; rotate one and the sinking quietly
 * stops being vertical.
 */

import { Vector3, type Material } from "three";

import { EFFECTIVE_RADIUS_METRES } from "../core/horizon.js";

export interface CurvatureUniforms {
  /** Where the observer is standing, in world coordinates. */
  uEye: { value: Vector3 };
  /** 1 for a bridge, 0 for the plan view. Nothing in between means anything. */
  uCurve: { value: number };
}

export function makeCurvatureUniforms(): CurvatureUniforms {
  return { uEye: { value: new Vector3() }, uCurve: { value: 0 } };
}

const DECLARATIONS = `
uniform vec3 uEye;
uniform float uCurve;
`;

const DISPLACEMENT = `
#include <begin_vertex>
{
  vec2 ground = ( modelMatrix * vec4( transformed, 1.0 ) ).xz - uEye.xz;
  transformed.y -= uCurve * dot( ground, ground ) / ( 2.0 * ${EFFECTIVE_RADIUS_METRES.toFixed(1)} );
}
`;

/**
 * Patch a material so everything drawn with it follows the curve.
 *
 * Normals are left alone. Across the whole range this is used over, the surface tilts by
 * d/R_eff - 0.36 degrees at forty-six kilometres - and no part of the shading reads at that
 * scale.
 */
export function applyCurvature(material: Material, uniforms: CurvatureUniforms): void {
  material.onBeforeCompile = (shader): void => {
    shader.uniforms["uEye"] = uniforms.uEye;
    shader.uniforms["uCurve"] = uniforms.uCurve;
    shader.vertexShader = DECLARATIONS + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace("#include <begin_vertex>", DISPLACEMENT);
  };
  // Without this, three reuses the unpatched program it already compiled for a material
  // with the same parameters, and the displacement silently does not happen.
  material.customProgramCacheKey = (): string => "curved";
}
