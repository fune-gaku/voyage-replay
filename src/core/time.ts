/**
 * Writing an instant down the way the source report writes it.
 *
 * Here rather than beside the panels that were its first caller, because the picture states
 * the time too - it is drawn into the frame, so a recording carries it - and the caption
 * under the canvas and the caption inside it must not be able to disagree about what
 * "18:13:30" means. One implementation is the only version of that which stays true.
 *
 * Always in the zone the report's own clock refers to, never the reader's. A reconstruction
 * is checked against a document that prints wall-clock times, and a page that quietly
 * showed them in the zone of whoever opened it would be wrong by hours in a way nothing on
 * screen could explain.
 */

/** Wall-clock, to the second. */
export function formatClock(epochSeconds: number, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date(epochSeconds * 1000));
}

export function formatDate(epochSeconds: number, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "short",
    day: "2-digit",
  }).format(new Date(epochSeconds * 1000));
}
