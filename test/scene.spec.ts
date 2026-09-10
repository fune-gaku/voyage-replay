import { Box3, LineDashedMaterial, type Color } from "three";
import type { FogExp2, Mesh, MeshStandardMaterial, Vector3, WebGLRenderer } from "three";
import type { AmbientLight, DirectionalLight, GridHelper, Line, LineBasicMaterial } from "three";
import { describe, expect, it } from "vitest";

import type { LocalPosition } from "../src/core/geodesy.js";
import { conditionsAt } from "../src/core/conditions.js";
import { prepareTrack, sampleAt } from "../src/core/track.js";
import type { Environment, Track } from "../src/core/types.js";
import type { Frame } from "../src/render/basemap.js";
import { toWorld } from "../src/render/coords.js";
import { CLEAR_AIR_METRES, contrastAt, extinctionPerMetre } from "../src/render/haze.js";
import { buildScene, buildTrackLine } from "../src/render/scene.js";
import { displacedFraction } from "../src/render/waves.js";
import { ORIGIN } from "./fixtures.js";

function background(scene: { background: unknown }): number {
  return (scene.background as Color).getHex();
}

/** A plan view of a given width, centred on the scenario origin. */
function frameOf(extentMetres: number): Frame {
  return { centre: { east: 0, north: 0 }, extentMetres, aspect: 16 / 9 };
}

function gridsIn(scene: { children: { type: string }[] }): GridHelper[] {
  return scene.children.filter((child): child is GridHelper => child.type === "GridHelper");
}

describe("light condition", () => {
  it("darkens the sky and the water at night", () => {
    const night = buildScene({ lightCondition: "night" }, 1000);
    const day = buildScene({ lightCondition: "day" }, 1000);

    expect(background(night.scene)).toBeLessThan(background(day.scene));
  });

  it("treats twilight, and an unstated condition, as night", () => {
    const night = background(buildScene({ lightCondition: "night" }, 1000).scene);

    expect(background(buildScene({ lightCondition: "twilight" }, 1000).scene)).toBe(night);
    expect(background(buildScene(undefined, 1000).scene)).toBe(night);
    expect(background(buildScene({}, 1000).scene)).toBe(night);
  });

  /**
   * The plan view is a diagram and a bridge view is the night. Lit for night a hull renders
   * almost black, which is right from a wheelhouse and useless from above, where an
   * investigator has to tell two ships apart and read their aspect.
   */
  it("lifts the light for the plan view and drops it again for a bridge", () => {
    const parts = buildScene({ lightCondition: "night" }, 1000);
    const ambient = parts.scene.children.find(
      (child): child is AmbientLight => child.type === "AmbientLight",
    );

    const atNight = ambient!.intensity;
    parts.setDiagramView("chart");
    expect(ambient!.intensity).toBeGreaterThan(atNight);
    parts.setDiagramView("world");
    expect(ambient!.intensity).toBe(atNight);
  });
});

describe("visibility", () => {
  /**
   * **Koschmieder's relation is what a stated visibility means**: a black object reaches the
   * limit of sight when its contrast against the horizon is 2 per cent, so the extinction is
   * `ln(50) / V`. The fog carries that as its density and the shader's exponent is linear in
   * depth - see `render/haze.ts`, which replaces three's chunk to make it so.
   */
  it("takes its extinction from the stated visibility", () => {
    const { scene } = buildScene({ lightCondition: "night", visibilityMetres: 2000 }, 50000);
    const fog = scene.fog as FogExp2;

    expect(fog.density).toBeCloseTo(extinctionPerMetre(2000), 12);
    // Which is to say: 2 per cent of the contrast left at the figure the file states.
    expect(contrastAt(2000, 2000)).toBeCloseTo(0.02, 6);
  });

  /**
   * **The size of the case is not a property of the air.** The fog used to be built from the
   * span of the tracks, so a 2.55 km reconstruction drew a clear day that went opaque at
   * 8.8 km and a 40.8 km one never fogged at all. Issue #81.
   */
  it("draws the declared clear air where the source gives no figure, whatever the scenario", () => {
    const near = buildScene({ lightCondition: "night" }, 500);
    const far = buildScene({ lightCondition: "night" }, 50_000);

    for (const parts of [near, far]) {
      expect((parts.scene.fog as FogExp2).density).toBeCloseTo(
        extinctionPerMetre(CLEAR_AIR_METRES),
        12,
      );
    }
    // And a far shore keeps its ranges apart rather than collapsing into one silhouette.
    expect(contrastAt(15_000, CLEAR_AIR_METRES)).toBeGreaterThan(
      contrastAt(25_000, CLEAR_AIR_METRES) * 1.5,
    );
    // And the terrain the renderer draws - out to 46 km - is not wholly gone into it.
    expect(contrastAt(46_000, CLEAR_AIR_METRES)).toBeGreaterThan(0.02);
  });

  /**
   * Fog is weather seen from a bridge; a chart is not drawn through it. It fades by the
   * distance from the eye, and the plan camera's eye is twelve kilometres up - so a
   * scenario a few hundred metres across renders as a sheet of empty sky, and so does any
   * view taken far enough out, whatever the scenario.
   */
  it("clears the fog for the plan view and puts it back for a bridge", () => {
    const parts = buildScene({ lightCondition: "night", visibilityMetres: 2000 }, 1000);

    parts.setDiagramView("chart");
    expect(parts.scene.fog).toBeNull();
    parts.setDiagramView("world");
    expect((parts.scene.fog as FogExp2).density).toBeCloseTo(extinctionPerMetre(2000), 12);
  });

  it("treats an explicit null the same as an absent figure", () => {
    const stated = buildScene({ lightCondition: "night", visibilityMetres: null }, 5000);
    const absent = buildScene({ lightCondition: "night" }, 5000);
    expect((stated.scene.fog as FogExp2).density).toBe((absent.scene.fog as FogExp2).density);
  });

  /**
   * **Haze is the sky scattered towards the eye, so it fades towards the sky - but three
   * mixes fog AFTER the tone curve and the colour-space encoding**, so what it wants is what
   * the screen shows for that sky and not the radiance. Handed the radiance the sea goes
   * white a few hundred metres out; handed the palette's hex, which is what it was before
   * #81, it fades towards a linear 0.33 in an sRGB buffer - darker than the sky, which is
   * what turned the horizon into a dark band under the sky's brightest part.
   */
  it("fades towards the sky as the screen shows it, condition by condition", () => {
    const day = buildScene({ lightCondition: "day" }, 1000).scene.fog as FogExp2;
    const night = buildScene({ lightCondition: "night" }, 1000).scene.fog as FogExp2;

    // A display value: nothing that comes off the tone curve and the encoding exceeds one.
    expect(day.color.g).toBeGreaterThan(0.3);
    expect(day.color.g).toBeLessThanOrEqual(1);
    // And a night's haze is a night's: the hex on its own would have drawn this at 0.66.
    expect(night.color.g).toBeLessThan(0.25);
    expect(night.color.g).toBeLessThan(day.color.g);
  });

  /**
   * The reader can move the exposure (#71), and a fog colour worked out once would then be
   * the only thing in the frame that did not move with it - a band of yesterday's sky along
   * the horizon.
   */
  it("moves the haze with the exposure, because the exposure moves the sky", () => {
    const parts = buildScene({ lightCondition: "day" }, 1000);
    const fog = parts.scene.fog as FogExp2;

    parts.hazeAt(4.6e-5);
    const own = fog.color.clone();
    parts.hazeAt(4.6e-5 * 4);
    expect(fog.color.g, "two stops up is brighter").toBeGreaterThan(own.g);
    parts.hazeAt(4.6e-5 / 4);
    expect(fog.color.g, "and two stops down is darker").toBeLessThan(own.g);
  });
});

describe("the water", () => {
  /**
   * Sized once rather than from the scenario. Neither view's need for it has much to do
   * with how far the ships travelled - a bridge camera wants water out to the horizon, and
   * the plan view can be taken out to hundreds of kilometres - so a plane cut to the tracks
   * runs off the end into the background colour in both.
   */
  it("reaches far beyond the tracks, whatever they span", () => {
    const sizeOf = (extentMetres: number): number => {
      const { scene } = buildScene(undefined, extentMetres);
      const water = scene.children.find((child) => child.type === "Mesh")!;
      const box = new Box3().setFromObject(water);
      return box.max.x - box.min.x;
    };

    const harbour = sizeOf(500);
    expect(harbour, "hundreds of kilometres of it, for a scenario 500 m across").toBeGreaterThan(
      500_000,
    );
    expect(sizeOf(50_000), "and no more for one a hundred times bigger").toBe(harbour);
  });
});

/**
 * **What floats rides the sea that is DRAWN**, which is now less of the sea the further out
 * the point is. The vertex shader band-limits every component to the vertices under it, and
 * a mark given the whole spectrum out there would heave to waves that are not in the water
 * beneath her - the hovering buoy of #34, arriving through the band rather than through the
 * range fade.
 */
describe("the sea under something floating", () => {
  const environment = {
    waves: { significantHeightMetres: 3, derivation: "measured" },
  } as const satisfies Environment;

  /** How far the drawn water moves at a point, over a couple of minutes of the scenario. */
  function riseAt(parts: ReturnType<typeof buildScene>, at: LocalPosition): number {
    let sum = 0;
    for (let seconds = 0; seconds < 120; seconds += 0.5) {
      sum += parts.drawnSurfaceAt(at, seconds).heightMetres ** 2;
    }
    return Math.sqrt(sum / 240);
  }

  it("moves less at a distance, where the range fade has not started yet", () => {
    const parts = buildScene(environment, 1000);
    parts.setDiagramView("world");
    parts.setEye({ east: 0, north: 0 }, 0);

    // **250 m is where `displacedFraction` is still exactly one**, so every bit of this
    // difference is the band and none of it the range fade. The vertices are 22 m apart
    // there and the sea keeps two fifths of its variance; a mark heaving to all of it
    // would be riding twice the water that is drawn under her.
    expect(displacedFraction(250)).toBe(1);
    expect(riseAt(parts, { east: 0, north: 250 })).toBeLessThan(
      riseAt(parts, { east: 0, north: 20 }) * 0.8,
    );
    expect(riseAt(parts, { east: 0, north: 250 })).toBeGreaterThan(0);
  });

  /**
   * **The disc's centre and the eye have to be the same point.** The rings grow from the
   * centre, and the band asks how far a point is from the eye - so if a frame ever set one
   * without the other, the shader would judge the mesh's fineness at the wrong radius. The
   * two views set them at different moments, and a bridge view whose own track has run out
   * sets neither, drawing with whichever ran last.
   */
  it("keeps the sea dense about the same point the distances are measured from", () => {
    const parts = buildScene(environment, 1000);
    parts.setDiagramView("world");
    const water = parts.scene.children.find((child) => child.name === "water");
    const centre = { east: 4000, north: -2500 };

    parts.setView({ centre, extentMetres: 9000, aspect: 1.5 });
    expect(water?.position.x).toBeCloseTo(centre.east, 6);
    expect(water?.position.z).toBeCloseTo(-centre.north, 6);
    // Four kilometres from the origin, and the water beside that centre is the water
    // beside an eye: the distances are measured from the point the disc was moved to,
    // rather than from the origin, where they would put this 4 km out and flat.
    expect(riseAt(parts, { east: centre.east + 20, north: centre.north })).toBeGreaterThan(0.6);

    const eye = { east: -700, north: 300 };
    parts.setEye(eye, 0);
    expect(water?.position.x).toBeCloseTo(eye.east, 6);
    expect(water?.position.z).toBeCloseTo(-eye.north, 6);
    expect(riseAt(parts, { east: eye.east + 20, north: eye.north })).toBeGreaterThan(0.6);
    // And the place the sea used to be dense about is now four kilometres off, where the
    // mesh has no vertices for waves at all.
    expect(riseAt(parts, centre)).toBe(0);
  });

  /**
   * **A sea too small to draw is drawn as nothing, and the page says nothing.** The floor is
   * the renderer's rule and `ui/panels.ts` reports from the same one, so a stated four
   * millimetres cannot come out as water that moves under a page saying it does not.
   */
  it("leaves a sea of a few millimetres out of the water altogether", () => {
    const tiny = buildScene(
      { waves: { significantHeightMetres: 0.004, derivation: "measured" } },
      1000,
    );
    tiny.setDiagramView("world");
    tiny.setEye({ east: 0, north: 0 }, 0);
    expect(riseAt(tiny, { east: 0, north: 20 })).toBe(0);

    // Five times that height and the components clear a millimetre, so the water moves.
    const small = buildScene(
      { waves: { significantHeightMetres: 0.02, derivation: "measured" } },
      1000,
    );
    small.setDiagramView("world");
    small.setEye({ east: 0, north: 0 }, 0);
    expect(riseAt(small, { east: 0, north: 20 })).toBeGreaterThan(0);
  });

  /** Close in, the mesh has vertices for the sea's own waves and nothing is taken away. */
  it("leaves the water near the eye alone", () => {
    const parts = buildScene(environment, 1000);
    parts.setDiagramView("world");
    parts.setEye({ east: 0, north: 0 }, 0);

    // A 3 m sea has a surface standard deviation of Hs/4, and the swell that carries it is
    // hundreds of metres long - all of which the mesh under a 20 m point still holds.
    expect(riseAt(parts, { east: 0, north: 20 })).toBeGreaterThan(0.6);
  });
});

/**
 * **The sky and its reflection are one gradient drawn twice.** Until the water handed back a
 * direction rather than a colour the reflection made the waves visible and said nothing about
 * where the moon was; until the dome went over it, the sky above the waterline said nothing
 * either.
 */
describe("the sky the water hands back", () => {
  const suoNada = { lat: 33.905, lon: 131.7116667 };
  /** The reference case: the moon 41 degrees up on 191, and 41 per cent lit. */
  const collision = Date.parse("2025-11-27T18:13:30+09:00") / 1000;
  const sea = {
    lightCondition: "night",
    waves: { significantHeightMetres: 3, derivation: "measured" },
  } as const satisfies Environment;

  function skyOf(parts: ReturnType<typeof buildScene>): Record<string, { value: unknown }> {
    const water = parts.scene.children.find((child) => child.name === "water") as Mesh;
    const uniforms: Record<string, { value: unknown }> = {};
    const shader = {
      uniforms,
      vertexShader: "#include <begin_vertex>",
      fragmentShader: "#include <normal_fragment_begin>\n#include <opaque_fragment>",
    };
    const material = water.material as MeshStandardMaterial;
    material.onBeforeCompile(
      shader as unknown as Parameters<MeshStandardMaterial["onBeforeCompile"]>[0],
      null as unknown as WebGLRenderer,
    );
    return uniforms;
  }

  it("puts the body where the almanac puts it, in the scene's own axes", () => {
    const parts = buildScene(sea, 1000);
    parts.setDiagramView("world");
    parts.setSky(conditionsAt(suoNada, sea, collision));

    // Bearing 191 at 41 degrees up: south and a little west, well above the water.
    const body = skyOf(parts)["uSkyBody"]?.value as Vector3;
    expect(body.y).toBeCloseTo(Math.sin((41 * Math.PI) / 180), 1);
    expect(body.z).toBeGreaterThan(0);
    expect(body.x).toBeLessThan(0);
  });

  /**
   * **One direction for the whole frame.** A sea handing back a moon on 191 degrees while
   * the hulls are lit from somewhere else is one picture making two claims.
   */
  it("points the key light at the same body the water reflects", () => {
    const parts = buildScene(sea, 1000);
    parts.setDiagramView("world");
    parts.setSky(conditionsAt(suoNada, sea, collision));

    const key = parts.scene.children.find((c) => c.type === "DirectionalLight") as DirectionalLight;
    const body = skyOf(parts)["uSkyBody"]?.value as Vector3;
    expect(key.position.clone().normalize().dot(body)).toBeCloseTo(1, 6);
  });

  /**
   * **No sea stated, no path.** There is then no slope to widen the body with, and a
   * mirror-sharp moon on flat water would assert a calm nobody recorded - which is the
   * reference case, whose file states a light condition and nothing else.
   */
  it("lays no path over a sea nobody stated", () => {
    const parts = buildScene({ lightCondition: "night" }, 1000);
    parts.setDiagramView("world");
    parts.setSky(conditionsAt(suoNada, { lightCondition: "night" }, collision));
    // The water is told there is no sea to reflect in; the body itself stays, because the
    // sky above the waterline shows it either way.
    expect(skyOf(parts)["uSeaSlope"]?.value).toBeLessThan(0);
  });

  /**
   * A chart has never had a glitter path drawn on it - the same judgement the lighting, the
   * map's tint and the grid have already made about the plan view.
   */
  it("draws no path on the plan view", () => {
    const parts = buildScene(sea, 1000);
    parts.setDiagramView("chart");
    parts.setSky(conditionsAt(suoNada, sea, collision));
    expect(skyOf(parts)["uSeaSlope"]?.value).toBeLessThan(0);

    parts.setDiagramView("world");
    parts.setSky(conditionsAt(suoNada, sea, collision));
    expect(skyOf(parts)["uSeaSlope"]?.value).toBeGreaterThan(0);
  });

  /**
   * **The sky is drawn above the waterline as well now**, from the same uniforms - so the
   * gradient the water hands back and the one over it cannot come apart, which would show as
   * a seam along the horizon.
   */
  it("puts a sky over the water and moves it with the eye", () => {
    const parts = buildScene(sea, 1000);
    parts.setDiagramView("world");
    const dome = parts.scene.getObjectByName("sky");
    expect(dome).toBeDefined();
    expect(dome?.visible).toBe(true);

    parts.setEye({ east: 4000, north: -2500 }, 0);
    expect(dome?.position.x).toBeCloseTo(4000, 6);
    expect(dome?.position.z).toBeCloseTo(2500, 6);
  });

  /** A chart has never had a sky drawn over it, whichever call came last. */
  it("takes the sky off the plan view", () => {
    const parts = buildScene(sea, 1000);
    const dome = parts.scene.getObjectByName("sky");

    parts.setDiagramView("chart");
    expect(dome?.visible).toBe(false);
    parts.setDiagramView("world");
    expect(dome?.visible).toBe(true);
  });

  /**
   * **A frame must not depend on how the viewer got to it.** A key light left standing where
   * the moon was before it set lights the hulls from a bearing nothing is at, and scrubbing
   * backwards never puts it right - the same claim the water makes, said about the hulls.
   */
  it("puts the key light out when nothing is up, whichever order the frames came in", () => {
    const parts = buildScene(sea, 1000);
    parts.setDiagramView("world");
    const key = parts.scene.children.find((c) => c.type === "DirectionalLight") as DirectionalLight;

    parts.setSky(conditionsAt(suoNada, sea, collision));
    expect(key.intensity).toBeGreaterThan(0);

    // Nine hours on: the moon has set, and this is drawn as night so no sun may replace it.
    parts.setSky(conditionsAt(suoNada, sea, collision + 9 * 3600));
    expect(key.intensity).toBe(0);

    parts.setSky(conditionsAt(suoNada, sea, collision));
    expect(key.intensity).toBeGreaterThan(0);
  });

  /**
   * **The phase dims the hulls as it dims the water.** A page saying a half moon is a ninth
   * of a full one, over a picture whose lane fades while the moonlight on the hulls does
   * not, is one frame making two claims about how much light there was.
   */
  it("dims the key light with the moon's phase, and lets the sun be the sun", () => {
    const parts = buildScene(sea, 1000);
    parts.setDiagramView("world");
    const key = parts.scene.children.find((c) => c.type === "DirectionalLight") as DirectionalLight;

    // A 41 per cent moon is a sixteenth of a full one by Allen's relation, not two fifths.
    parts.setSky(conditionsAt(suoNada, sea, collision));
    const crescent = key.intensity;
    expect(crescent).toBeGreaterThan(0);
    expect(crescent, "a fraction of a full moon's quarter of a lux").toBeLessThan(0.25 / 5);

    // **And the sun is not held level with a full moon**, which it was while the figure was
    // a screen value: four hundred thousand times it, in lux, and the exposure is what keeps
    // that on a screen. Drawing a sunlit sea and a moonlit one as though they returned the
    // same light is the flattening issue #60 is about.
    const day = { ...sea, lightCondition: "day" } as const satisfies Environment;
    const lit = buildScene(day, 1000);
    lit.setDiagramView("world");
    const sun = lit.scene.children.find((c) => c.type === "DirectionalLight") as DirectionalLight;
    lit.setSky(conditionsAt(suoNada, day, Date.parse("2025-11-27T12:00:00+09:00") / 1000));
    // What three delivers is colour times intensity, and the sun's colour is warm - so the
    // intensity carries the reciprocal of its own luminance and the PRODUCT is the lux.
    // Asserting the intensity alone let the sun stand 9 per cent under the figure it names.
    const delivered =
      sun.intensity * (0.2126 * sun.color.r + 0.7152 * sun.color.g + 0.0722 * sun.color.b);
    expect(delivered).toBeCloseTo(0.25 * 400_000, 0);
  });

  /**
   * **The declared figure has to BE the horizon's luminance, not a number multiplied into a
   * colour.** three reads a hex into a linear triple whose Rec. 709 luminance is its own -
   * 0.51 for the day's sky, 0.38 for the night's - so `colour * 8000` was a sky of 4045
   * cd/m², and every figure measured against the sky inherited the error. The ambient took
   * it twice, being an illuminance worked out from that same colour and then multiplied by
   * it again. Found reviewing #74; the old test could not see it, asking only that the
   * horizon's blue channel times the exposure landed somewhere on the screen.
   */
  it("gives the sky the luminance it declares, and the ambient the lux it computes", () => {
    for (const [light, candela] of [
      ["night", 2e-4],
      ["day", 8000],
    ] as const) {
      const environment = { ...sea, lightCondition: light } satisfies Environment;
      const parts = buildScene(environment, 1000);
      parts.setDiagramView("world");

      const horizon = skyOf(parts)["uSkyHorizon"]?.value as Color;
      const luminance = 0.2126 * horizon.r + 0.7152 * horizon.g + 0.0722 * horizon.b;
      expect(luminance / candela, `${light} horizon`).toBeCloseTo(1, 6);

      // What three actually delivers is colour times intensity, so that product is the
      // illuminance - `E = pi L` over the sky's two ends - and not some fraction of it.
      const ambient = parts.scene.children.find(
        (child) => child.type === "AmbientLight",
      ) as AmbientLight;
      const delivered =
        ambient.intensity *
        (0.2126 * ambient.color.r + 0.7152 * ambient.color.g + 0.0722 * ambient.color.b);
      const zenith = skyOf(parts)["uSkyZenith"]?.value as Color;
      const zenithLuminance = 0.2126 * zenith.r + 0.7152 * zenith.g + 0.0722 * zenith.b;
      expect(delivered, `${light} ambient`).toBeCloseTo(
        Math.PI * ((candela + zenithLuminance) / 2),
        Math.log10(candela) > 2 ? 0 : 6,
      );
    }
  });

  /**
   * **The exposure belongs to the condition, not to the body.** A night sky here is 0.003 and
   * a day sky 0.60, two hundred times apart; one figure served both, and the middle of a
   * daylight path came out at 3.1 where 1.0 is white - clipped flat across a cone fifty
   * degrees wide, which is a hole in the water rather than a path.
   */
  it("puts a night and a day on one screen, through exposures four orders apart", () => {
    const exposures: number[] = [];
    for (const [light, when] of [
      ["night", "2025-11-27T19:40:00+09:00"],
      ["day", "2025-11-27T11:40:00+09:00"],
    ] as const) {
      const environment = { ...sea, lightCondition: light } satisfies Environment;
      const parts = buildScene(environment, 1000);
      parts.setDiagramView("world");
      parts.setSky(conditionsAt(suoNada, environment, Date.parse(when) / 1000));

      const exposure = parts.exposureFor("world") ?? 0;
      exposures.push(exposure);

      // The sky's own radiance, through this condition's exposure: on the screen and not
      // off either end of it.
      const horizon = skyOf(parts)["uSkyHorizon"]?.value as Color;
      expect(horizon.b * exposure, `${light} sky`).toBeGreaterThan(0.002);
      expect(horizon.b * exposure, `${light} sky`).toBeLessThan(1);

      // And the body is in lux now rather than in screen values.
      const lobe = skyOf(parts)["uSkyBodyLobe"]?.value as Vector3;
      expect(lobe.x, `${light} body`).toBeGreaterThan(0);
    }

    // **Which is the whole of it.** A moonless sea and a day sky are ten million apart and
    // no single mapping shows both, so the exposure is a property of the condition.
    expect((exposures[0] ?? 0) / (exposures[1] ?? 1)).toBeGreaterThan(1_000);
  });

  /** A chart is lit for reading and answers to nothing in the sky, whichever call came last. */
  it("leaves the plan view's own lighting alone", () => {
    const parts = buildScene(sea, 1000);
    const key = parts.scene.children.find((c) => c.type === "DirectionalLight") as DirectionalLight;

    parts.setDiagramView("chart");
    parts.setSky(conditionsAt(suoNada, sea, collision + 9 * 3600));
    expect(key.intensity).toBeCloseTo(0.8, 6);

    parts.setSky(conditionsAt(suoNada, sea, collision));
    parts.setDiagramView("chart");
    expect(key.intensity).toBeCloseTo(0.8, 6);
  });

  /**
   * **The sky moves while the scenario runs**, which is why it is set every frame rather
   * than when the scene was built: the reference case is eighty-seven minutes long and
   * nautical twilight ends eleven minutes before the collision.
   */
  it("follows the body across the length of a scenario", () => {
    const parts = buildScene(sea, 1000);
    parts.setDiagramView("world");

    parts.setSky(conditionsAt(suoNada, sea, collision));
    const early = (skyOf(parts)["uSkyBody"]?.value as Vector3).clone();
    parts.setSky(conditionsAt(suoNada, sea, collision + 3 * 3600));
    const later = skyOf(parts)["uSkyBody"]?.value as Vector3;

    // Three hours is about 45 degrees of rotation; nothing subtle about it.
    expect(early.dot(later)).toBeLessThan(0.9);
  });
});

describe("the grid", () => {
  it("keeps exactly one grid however often the view is reframed", () => {
    const parts = buildScene(undefined, 1000);
    for (const extent of [1000, 4000, 400, 40000, 400]) parts.setView(frameOf(extent));
    expect(gridsIn(parts.scene)).toHaveLength(1);
  });

  // A fixed spacing is wrong at both ends: 500 m squares wash out a 20 km view and draw a
  // single line across a 700 m one, and a plan view whose scale cannot be read is a cartoon.
  it("opens the squares out as the view widens", () => {
    const parts = buildScene(undefined, 1000);
    const sizeOfGrid = (): number => {
      const box = new Box3().setFromObject(gridsIn(parts.scene)[0]!);
      return box.max.x - box.min.x;
    };

    parts.setView(frameOf(600));
    const close = sizeOfGrid();
    parts.setView(frameOf(30000));
    expect(sizeOfGrid()).toBeGreaterThan(close);
  });

  /**
   * The ladder has to reach as far as the view does. Stopped at ten kilometres it would
   * draw a hundred squares across a thousand-kilometre frame, which is the same unreadable
   * wash as five-hundred-metre squares across twenty km, at the other end.
   */
  it("keeps a legible count of squares out to the widest view offered", () => {
    const parts = buildScene(undefined, 1000);
    parts.setView(frameOf(1_000_000));

    const box = new Box3().setFromObject(gridsIn(parts.scene)[0]!);
    const spacing = (box.max.x - box.min.x) / 400;
    expect(1_000_000 / spacing, "squares across the frame").toBeLessThan(25);
  });
});

describe("buildTrackLine", () => {
  function track(derivations: ("measured" | "interpolated")[]): Track {
    return {
      derivation: "measured",
      positionAt: "gps-antenna",
      points: derivations.map((derivation, i) => ({
        t: new Date(Date.UTC(2025, 0, 1, 0, i)).toISOString(),
        lat: i * 0.001,
        lon: 0,
        derivation,
      })),
    };
  }

  /**
   * The line as it stands once she has covered the whole track. Every leg is drawn twice -
   * behind her and ahead of her - so a test about which legs exist has to say which half of
   * the pair it means.
   */
  function linesOf(
    derivations: ("measured" | "interpolated")[],
    which: "behind" | "ahead" = "behind",
  ): Line[] {
    const prepared = prepareTrack("A", track(derivations), ORIGIN);
    const line = buildTrackLine(prepared, 0xff0000);
    line.setNow(prepared.endSeconds);
    return line.group.children.filter((child): child is Line => child.name === which);
  }

  /** How many vertices are actually being drawn, which is not how many were allocated. */
  function drawn(line: Line): number {
    return line.geometry.drawRange.count;
  }

  it("draws a wholly recorded track as one solid line", () => {
    const lines = linesOf(["measured", "measured", "measured"]);
    expect(lines).toHaveLength(1);
    expect(lines[0]!.material).not.toBeInstanceOf(LineDashedMaterial);
  });

  /**
   * Recorded and reconstructed have to be told apart at a glance. This is the convention
   * the Japan Transport Safety Board uses in its own track charts, and it is the whole
   * basis on which this tool can call itself a reconstruction rather than an animation.
   */
  it("breaks the line where the track stops being recorded, and dashes that part", () => {
    const lines = linesOf(["measured", "measured", "interpolated", "interpolated"]);

    expect(lines).toHaveLength(2);
    expect(lines[0]!.material).not.toBeInstanceOf(LineDashedMaterial);
    expect(lines[1]!.material).toBeInstanceOf(LineDashedMaterial);
  });

  // The runs overlap by one point so the line has no gap, which means the first point of
  // every run after the first still carries the PREVIOUS run's derivation. Reading the
  // style off it drew reconstructed track solid.
  it("dashes a reconstructed opening and returns to solid where the record resumes", () => {
    const lines = linesOf(["interpolated", "interpolated", "measured", "measured"]);

    expect(lines).toHaveLength(2);
    expect(lines[0]!.material).toBeInstanceOf(LineDashedMaterial);
    expect(lines[1]!.material).not.toBeInstanceOf(LineDashedMaterial);
  });

  it("joins the runs rather than leaving a gap between them", () => {
    const lines = linesOf(["measured", "measured", "interpolated"]);
    const solidEnd = lines[0]!.geometry.getAttribute("position");
    const dashedStart = lines[1]!.geometry.getAttribute("position");

    const last = drawn(lines[0]!) - 1;
    expect(dashedStart.getX(0)).toBeCloseTo(solidEnd.getX(last), 5);
    expect(dashedStart.getZ(0)).toBeCloseTo(solidEnd.getZ(last), 5);
  });

  /**
   * A single reconstructed point between two recorded ones is the hardest case for the
   * overlap-by-one scheme, because the runs on either side of it are two points long and
   * the lone point is the join for both. It is also a real shape: one sample dropped out
   * of an otherwise complete AIS track.
   *
   * The line goes dashed on the way in and solid on the way out, so the reconstructed
   * point is never presented as if the whole leg were recorded.
   */
  it("handles a single reconstructed point between recorded ones", () => {
    const lines = linesOf(["measured", "interpolated", "measured"]);

    expect(lines).toHaveLength(2);
    expect(lines[0]!.material).toBeInstanceOf(LineDashedMaterial);
    expect(lines[1]!.material).not.toBeInstanceOf(LineDashedMaterial);
  });

  /**
   * The second thing one line has to carry, and it is deliberately NOT carried by the
   * dashes: those already say where the figures came from. Bright behind her, faint ahead.
   */
  it("draws what she has covered apart from what is still ahead of her", () => {
    const prepared = prepareTrack("A", track(["measured", "measured", "measured"]), ORIGIN);
    const line = buildTrackLine(prepared, 0xff0000);
    const halfway = (prepared.startSeconds + prepared.endSeconds) / 2;
    line.setNow(halfway);

    const [behind, ahead] = line.group.children as Line[];
    expect(behind!.visible).toBe(true);
    expect(ahead!.visible).toBe(true);
    expect((behind!.material as LineBasicMaterial).opacity).toBeGreaterThan(
      (ahead!.material as LineBasicMaterial).opacity,
    );
  });

  /**
   * The join is her position at that instant, not the nearest sample. A minute between
   * samples is most of a mile, and a line that changed strength that far from the hull
   * would be answering a different question from the one it looks like it is answering.
   */
  it("joins the two under the hull, wherever between samples she is", () => {
    const prepared = prepareTrack("A", track(["measured", "measured", "measured"]), ORIGIN);
    const line = buildTrackLine(prepared, 0xff0000);
    const between = prepared.startSeconds + 30;
    line.setNow(between);

    const [behind, ahead] = line.group.children as Line[];
    const covered = behind!.geometry.getAttribute("position");
    const rest = ahead!.geometry.getAttribute("position");
    const last = behind!.geometry.drawRange.count - 1;

    const here = toWorld(sampleAt(prepared, between)!.position, 0);
    expect(covered.getZ(last), "the covered part ends under her").toBeCloseTo(here.z, 5);
    expect(rest.getZ(0), "and the rest starts there").toBeCloseTo(here.z, 5);
  });

  it("draws nothing behind her before she has started", () => {
    const prepared = prepareTrack("A", track(["measured", "measured"]), ORIGIN);
    const line = buildTrackLine(prepared, 0xff0000);
    line.setNow(prepared.startSeconds);

    const [behind, ahead] = line.group.children as Line[];
    expect(behind!.visible, "she has covered none of it").toBe(false);
    expect(ahead!.visible, "and all of it is still to come").toBe(true);
  });

  it("draws nothing ahead of her once she has finished", () => {
    const prepared = prepareTrack("A", track(["measured", "measured"]), ORIGIN);
    const line = buildTrackLine(prepared, 0xff0000);
    line.setNow(prepared.endSeconds);

    const [behind, ahead] = line.group.children as Line[];
    expect(behind!.visible).toBe(true);
    expect(ahead!.visible).toBe(false);
  });

  it("draws a two-point track as one line rather than dropping it", () => {
    expect(linesOf(["measured", "measured"])).toHaveLength(1);
    expect(linesOf(["measured", "interpolated"])).toHaveLength(1);
  });

  // Every point of every run has to appear on some line. A run shorter than two points is
  // skipped as undrawable, and the arithmetic that decides where the next run starts is
  // the sort that loses a segment quietly.
  it("leaves no stretch of an alternating track undrawn", () => {
    const lines = linesOf(["measured", "interpolated", "measured", "interpolated", "measured"]);
    const segments = lines.reduce((n, line) => n + drawn(line) - 1, 0);

    // Four segments between five points, each drawn exactly once.
    expect(segments).toBe(4);
  });
});

describe("what a fine day and a night are made of", () => {
  /**
   * The day palette is a clear day: most of the light arrives from one direction, so a
   * wave's face and its back are lit differently and a swell has shape. An overcast one -
   * which is what this was - lights them alike and flattens any sea. Neither is in the
   * source, which is why the choice is written down rather than assumed.
   */
  it("puts most of a day's light in one direction, and most of a night's nowhere", () => {
    const ambientOf = (scene: { children: { type: string }[] }): number =>
      (scene.children.find((c) => c.type === "AmbientLight") as AmbientLight).intensity;
    const keyOf = (scene: { children: { type: string }[] }): number =>
      (scene.children.find((c) => c.type === "DirectionalLight") as DirectionalLight).intensity;

    // The key is out until something is known to be up there, so the sky is set first.
    const off = { lat: 33.905, lon: 131.7116667 };
    const noon = Date.parse("2025-11-27T11:40:00+09:00") / 1000;
    const day = buildScene({ lightCondition: "day" }, 1000);
    day.setSky(conditionsAt(off, { lightCondition: "day" }, noon));
    expect(keyOf(day.scene)).toBeGreaterThan(ambientOf(day.scene) * 2);

    // A moonless night has nothing with a direction in it at all, so nothing has a lit side.
    const night = buildScene({ lightCondition: "night" }, 1000);
    night.setSky(conditionsAt(off, { lightCondition: "night" }, noon));
    expect(keyOf(night.scene)).toBeLessThan(ambientOf(night.scene));
  });

  /**
   * Warmth is the sun's. A night has a moon at most, which is not warm, and tinting its
   * light would be drawing a sunset over a collision that happened in the dark.
   */
  it("leaves a night's light white and gives only the day's any warmth", () => {
    const keyColour = (condition: "day" | "night"): { r: number; b: number } => {
      const scene = buildScene({ lightCondition: condition }, 1000).scene;
      const key = scene.children.find((c) => c.type === "DirectionalLight") as DirectionalLight;
      return { r: key.color.r, b: key.color.b };
    };
    expect(keyColour("day").r).toBeGreaterThan(keyColour("day").b);
    expect(keyColour("night").r).toBe(keyColour("night").b);
  });
});
