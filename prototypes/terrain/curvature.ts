/**
 * The earth's curvature, as a vertex displacement.
 *
 * Everything in this project lives on a local tangent plane, and for a few kilometres that
 * is right to within centimetres. A bridge view is not a few kilometres: land is looked at
 * out to forty, and on a flat plane every one of those coastlines shows its own waterline.
 * A seafarer reads that in one glance as wrong, because the thing you actually see at
 * twenty-five miles is a summit with no shore under it.
 *
 * So a point is sunk by d^2 / 2R_eff, where d is its horizontal distance from the EYE.
 * That makes curvature a property of the view rather than of the world, which is the same
 * shape `setDiagramView` already has: the plan view is a chart and gets none of this.
 *
 * Two things this leans on:
 *
 * - **R_eff, not R.** Light bends towards the earth, so the horizon is further off than
 *   geometry alone says. The standard coefficient is k = 0.13, giving R/(1-k) = 7323 km
 *   against the earth's 6371. Leaving it out puts the horizon 7% too close.
 * - **The model matrices here are pure translations.** Terrain tiles and the water are
 *   built already oriented, with no rotation and no scale, so subtracting from the local
 *   Y is the same as subtracting from the world Y. Rotate a mesh that uses this material
 *   and the displacement silently stops being vertical.
 */

import { Vector3, type Material } from "three";

export const EARTH_RADIUS_METRES = 6371008.8;
export const REFRACTION_COEFFICIENT = 0.13;
export const EFFECTIVE_RADIUS_METRES = EARTH_RADIUS_METRES / (1 - REFRACTION_COEFFICIENT);

export interface CurvatureUniforms {
  uEye: { value: Vector3 };
  uCurve: { value: number };
}

export function makeCurvatureUniforms(): CurvatureUniforms {
  return { uEye: { value: new Vector3() }, uCurve: { value: 1 } };
}

/** Distance to the visible horizon from a given eye height, in metres. */
export function horizonMetres(eyeHeightMetres: number): number {
  return Math.sqrt(2 * EFFECTIVE_RADIUS_METRES * Math.max(eyeHeightMetres, 0));
}

/** How much of a distant object is hidden by the bulge, in metres of its own height. */
export function hiddenHeightMetres(eyeHeightMetres: number, distanceMetres: number): number {
  const beyond = distanceMetres - horizonMetres(eyeHeightMetres);
  return beyond <= 0 ? 0 : (beyond * beyond) / (2 * EFFECTIVE_RADIUS_METRES);
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
 * Normals are left alone. Over the whole range this is used for, the surface tilts by
 * d/R_eff - 0.36 degrees at forty-six kilometres - and nothing in the shading reads at
 * that scale.
 */
export function applyCurvature(material: Material, uniforms: CurvatureUniforms): void {
  material.onBeforeCompile = (shader): void => {
    shader.uniforms["uEye"] = uniforms.uEye;
    shader.uniforms["uCurve"] = uniforms.uCurve;
    shader.vertexShader = DECLARATIONS + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace("#include <begin_vertex>", DISPLACEMENT);
  };
  // Without this, three reuses the unpatched program it compiled for the same material
  // parameters and the displacement quietly does not happen.
  material.customProgramCacheKey = (): string => "curved";
}
