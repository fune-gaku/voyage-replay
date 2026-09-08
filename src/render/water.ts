/**
 * The sea, as a disc centred on whoever is looking at it, with rings that grow
 * geometrically.
 *
 * It used to be one flat ten-thousand-kilometre square, which is correct for a chart and
 * wrong the moment the world is allowed to curve: a uniform grid fine enough to bend
 * smoothly near the horizon has to be that fine everywhere, and a coarse one turns the
 * horizon into a visible run of polygon edges.
 *
 * Rings spaced geometrically put the vertices where the curve is. A hundred and sixty of
 * them from five metres to three thousand kilometres spends about a third of its resolution
 * inside a twenty-metre eye's horizon and still reaches past the widest the plan view opens
 * to. Centred on the eye and moved with it, so the same geometry serves any position.
 *
 * **The horizon is not drawn.** It is where the sunk surface turns away and hides what is
 * behind it, which is what a horizon is. Nothing in here knows the eye height.
 */

import { BufferAttribute, BufferGeometry, Mesh, type Material } from "three";

const RINGS = 160;
const SECTORS = 96;
const INNER_METRES = 5;

/**
 * Past the far end of the plan view's scale, which opens to a thousand kilometres. Cut to
 * the case instead and both views run off the edge of the sea into the background colour.
 */
const OUTER_METRES = 3_000_000;

/**
 * What the disc is made of, for whoever has to know how finely the sea can be drawn on it.
 *
 * **Exported rather than restated.** `render/waves.ts` band-limits every wave component to
 * the vertices under it, and a copy of these numbers that drifted from the mesh would put
 * waves on triangles too big to hold them - which does not draw a short wave short, it draws
 * a slow false swell. The mesh is the authority on its own spacing.
 */
export const DISC = {
  /**
   * The innermost ring. **Inside it the disc is a fan from a single centre vertex**, so the
   * only samples across that cap are the centre and the rim: the sea cannot be drawn there
   * at anything finer than the cap's own radius. Nothing in a level bridge view reaches it -
   * a 20 m eye with a 55 degree window sees water from about 38 m out.
   */
  innerMetres: INNER_METRES,
  /** Radial spacing as a fraction of the radius, outside that cap. */
  growth: (OUTER_METRES / INNER_METRES) ** (1 / (RINGS - 1)) - 1,
  /** Sectors round the circle. Their spacing is `2 pi r / sectors`, finer than the radial. */
  sectors: SECTORS,
};

export function buildWater(material: Material): Mesh {
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(ringVertices(), 3));
  geometry.setIndex(new BufferAttribute(ringIndices(), 1));
  geometry.computeVertexNormals();

  const mesh = new Mesh(geometry, material);
  mesh.name = "water";
  // Never culled: the geometry is authored around the origin and then moved to wherever the
  // view is, so its bounding sphere is in the wrong place by the whole scene.
  mesh.frustumCulled = false;
  return mesh;
}

/** The centre point, then `RINGS` rings of `SECTORS` points each. */
function ringVertices(): Float32Array {
  const vertices = new Float32Array((1 + RINGS * SECTORS) * 3);
  const growth = (OUTER_METRES / INNER_METRES) ** (1 / (RINGS - 1));

  let radius = INNER_METRES;
  for (let ring = 0; ring < RINGS; ring += 1) {
    for (let sector = 0; sector < SECTORS; sector += 1) {
      const angle = (sector / SECTORS) * Math.PI * 2;
      const at = (1 + ring * SECTORS + sector) * 3;
      vertices[at] = radius * Math.cos(angle);
      vertices[at + 2] = radius * Math.sin(angle);
    }
    radius *= growth;
  }
  return vertices;
}

function ringIndices(): Uint32Array {
  const indices = new Uint32Array((SECTORS + (RINGS - 1) * SECTORS * 2) * 3);
  let at = 0;

  // The cap, as a fan from the centre vertex out to the innermost ring.
  for (let sector = 0; sector < SECTORS; sector += 1) {
    const next = (sector + 1) % SECTORS;
    indices[at++] = 0;
    indices[at++] = 1 + next;
    indices[at++] = 1 + sector;
  }

  for (let ring = 0; ring < RINGS - 1; ring += 1) {
    const inner = 1 + ring * SECTORS;
    const outer = inner + SECTORS;
    for (let sector = 0; sector < SECTORS; sector += 1) {
      const next = (sector + 1) % SECTORS;
      indices[at++] = inner + sector;
      indices[at++] = outer + next;
      indices[at++] = outer + sector;
      indices[at++] = inner + sector;
      indices[at++] = inner + next;
      indices[at++] = outer + next;
    }
  }

  return indices;
}
