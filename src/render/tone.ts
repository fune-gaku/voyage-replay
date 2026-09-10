/**
 * The tone curve, on this side of the GPU.
 *
 * **Fog is mixed after the curve, not before it.** three's fragment chain runs
 * `<tonemapping_fragment>` and `<colorspace_fragment>` and only then `<fog_fragment>`, so the
 * colour a fog blends towards is a value on the SCREEN - not a radiance. Handed a radiance
 * (the sky's 8000 cd/m2) the picture goes white a few hundred metres out; handed the
 * palette's hex, as it was before #81, it fades towards a linear 0.33 in an sRGB buffer,
 * which is darker than the sky it is meant to be and turned the horizon into a dark band.
 *
 * So the haze needs the sky's radiance put through exactly what the GPU would do to it, and
 * that means a copy of the curve here. Khronos PBR Neutral, mirroring
 * `NeutralToneMapping` in three's `tonemapping_pars_fragment` chunk - if three changes it,
 * `test/tone.spec.ts` fails against the chunk's own text rather than silently drifting.
 */

const START_COMPRESSION = 0.8 - 0.04;
const DESATURATION = 0.15;

/** One channel triple, exposed and compressed, still linear. */
export function neutralToneMap(
  colour: readonly [number, number, number],
  exposure: number,
): [number, number, number] {
  const lit = colour.map((c) => c * exposure) as [number, number, number];
  const least = Math.min(...lit);
  const offset = least < 0.08 ? least - 6.25 * least * least : 0.04;
  const shifted = lit.map((c) => c - offset) as [number, number, number];

  const peak = Math.max(...shifted);
  if (peak < START_COMPRESSION) return shifted;

  const room = 1 - START_COMPRESSION;
  const newPeak = 1 - (room * room) / (peak + room - START_COMPRESSION);
  const scaled = shifted.map((c) => (c * newPeak) / peak) as [number, number, number];

  // The highlight desaturation: a bright enough colour goes towards white, as film does.
  const towardsWhite = 1 - 1 / (DESATURATION * (peak - newPeak) + 1);
  return scaled.map((c) => c * (1 - towardsWhite) + newPeak * towardsWhite) as [
    number,
    number,
    number,
  ];
}

/** Linear to sRGB, which is what `<colorspace_fragment>` does after the curve. */
export function toDisplay(linear: number): number {
  return linear <= 0.0031308 ? linear * 12.92 : 1.055 * Math.pow(linear, 1 / 2.4) - 0.055;
}

/** What the screen shows for this radiance at this exposure: the curve, then the encoding. */
export function onScreen(
  colour: readonly [number, number, number],
  exposure: number,
): [number, number, number] {
  return neutralToneMap(colour, exposure).map(toDisplay) as [number, number, number];
}
