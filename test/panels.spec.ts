import { describe, expect, it } from "vitest";

import { prepareActor } from "../src/core/track.js";
import type { Actor, Scenario, TrackPoint, Vessel } from "../src/core/types.js";
import { formatClock, formatDate } from "../src/core/time.js";
import { escapeHtml, renderPanels } from "../src/ui/panels.js";

/** The reference case's instant and place, which is what makes the sky figures checkable. */
const SUO_NADA_LIKE: Scenario = {
  formatVersion: "0.1",
  meta: {
    title: "Suo-nada",
    occurredAt: "2025-11-27T18:13:30+09:00",
    timeZone: "Asia/Tokyo",
  },
  origin: { lat: 33.905, lon: 131.7116667 },
  environment: { lightCondition: "night" },
  actors: [],
};
import {
  actor,
  BIG_SHIP,
  COASTER,
  northboundPoints,
  scenario,
  silentPoints,
  westboundPoints,
} from "./fixtures.js";

function panelsFor(subject: Scenario): string {
  const prepared = subject.actors.map((a) => ({
    actor: a,
    track: prepareActor(a, subject.origin),
  }));
  return renderPanels(subject, prepared);
}

describe("the sky panel", () => {
  /**
   * The scenario says "night" by hand. The sky says how far down the sun was, that the
   * lights were required by Rule 20, and that there was a half moon forty degrees up -
   * none of which a transcribed field can carry.
   */
  it("states the sun, the moon and the rule, computed from the time and the place", () => {
    const html = renderPanels(SUO_NADA_LIKE, []);
    expect(html).toContain("Sun level");
    expect(html).toContain("astronomical-twilight");
    expect(html).toContain("COLREG Rule 20");
    expect(html).toMatch(/\d+% lit/);
  });

  // Cloud is what decides whether that moon lit the sea or nothing at all, and no report
  // this project has met states it. A figure without that beside it is a claim.
  it("says what the figures do not cover", () => {
    expect(renderPanels(SUO_NADA_LIKE, [])).toContain("cloud");
  });

  it("calls out a file whose light condition the sun does not support", () => {
    const daylit = {
      ...SUO_NADA_LIKE,
      environment: { lightCondition: "day" as const },
    };
    expect(renderPanels(daylit, [])).toContain("does not support");
    expect(renderPanels(SUO_NADA_LIKE, [])).not.toContain("does not support");
  });
});

describe("escapeHtml", () => {
  // Titles, localities and citations come out of a PDF and go straight into innerHTML.
  it("escapes every character that could close a tag or an attribute", () => {
    expect(escapeHtml(`<script>"x"&'y'</script>`)).toBe(
      "&lt;script&gt;&quot;x&quot;&amp;&#39;y&#39;&lt;/script&gt;",
    );
  });

  it("leaves ordinary text alone", () => {
    expect(escapeHtml("Suo-nada, 27 November 2025")).toBe("Suo-nada, 27 November 2025");
  });
});

describe("clock and date", () => {
  const midday = Date.parse("2025-11-27T12:00:00Z") / 1000;

  // The times a report prints are local to where it happened, so the panels have to render
  // in that zone rather than in whatever zone the machine building the video sits in.
  it("renders in the zone the source report's own times refer to", () => {
    expect(formatClock(midday, "UTC")).toBe("12:00:00");
    expect(formatClock(midday, "Asia/Tokyo")).toBe("21:00:00");
  });

  it("rolls the date over with the zone", () => {
    expect(formatDate(Date.parse("2025-11-27T20:00:00Z") / 1000, "Asia/Tokyo")).toContain("28");
  });
});

describe("renderPanels", () => {
  const html = panelsFor(scenario());

  it("names every actor and how many of its points carry a heading", () => {
    expect(html).toContain("A of the test tube");
    expect(html).toContain("B of the test tube");
    // A transmits a heading throughout; B, a Class B transponder, never does.
    expect(html).toContain("3/3");
    expect(html).toContain("0/3");
  });

  it("states where the reported position sits on the hull", () => {
    expect(html).toContain("gps-antenna");
  });

  /**
   * A ship put where her offsets say and one drawn at her antenna because nobody wrote the
   * offsets down look identical on screen, and are most of a ship's length apart in what
   * they claim. The reader checking the reconstruction has to be able to tell them apart,
   * so the table says which happened to each hull.
   */
  it("says how far each hull was moved off the position reported for her", () => {
    expect(html).toContain("50.0 m fwd, 4.0 m stbd");
    expect(html).toContain("not stated: drawn as reported");
  });

  it("says a position already at the hull needed no moving", () => {
    const moved = actor("B", westboundPoints(), BIG_SHIP);
    moved.track.positionAt = "reference-point";
    const html = panelsFor(scenario([actor("A", northboundPoints(), COASTER), moved]));

    expect(html).toContain("none: already the hull");
  });

  /**
   * Having the offsets is not the same as having used them. The offset runs along the ship's
   * heading, so a track that never says which way she points never gets moved - and a table
   * that printed the arithmetic anyway would claim a placement the view never made, which is
   * the exact disagreement between what this project says and what it draws that the
   * offsets were applied to close.
   */
  it("does not claim a hull was placed when nothing said which way she points", () => {
    const html = panelsFor(
      scenario([actor("A", northboundPoints(), COASTER), actor("B", silentPoints(), BIG_SHIP)]),
    );

    expect(html).toContain("never applied: no direction stated");
  });

  it("says so when only part of a track states a direction", () => {
    // The middle point says nothing; the two either side give a course.
    const patchy = westboundPoints().map((p, i) =>
      i === 1 ? { t: p.t, lat: p.lat, lon: p.lon } : p,
    );
    const html = panelsFor(
      scenario([actor("A", northboundPoints(), COASTER), actor("B", patchy, BIG_SHIP)]),
    );

    expect(html).toContain("applied where she states a direction (2/3)");
  });

  it("reports the closest approach in both metres and miles", () => {
    expect(html).toMatch(/\d+ m \(\d+\.\d\d NM\)/);
  });

  /**
   * Each track says for itself what its positions refer to, and the two need not agree. A
   * caveat that named one ship's antenna and assumed the other's would describe a distance
   * nobody measured - and the reader checking a closest approach of tens of metres is
   * exactly the reader who needs to know which two points it runs between.
   */
  it("names the point on each ship that the closest approach was measured between", () => {
    const moved = actor("B", westboundPoints(), BIG_SHIP);
    moved.track.positionAt = "reference-point";
    const html = panelsFor(scenario([actor("A", northboundPoints(), COASTER), moved]));

    expect(html).toContain("A&#39;s GPS antenna to B&#39;s reference point");
  });

  it("still says what the range runs between when only the second ship states offsets", () => {
    // A carries no offsets at all; the caveat used to vanish with them.
    expect(html).toContain("A&#39;s GPS antenna to B&#39;s GPS antenna");
    expect(html).toContain("that point sits 140 m from the bow");
  });

  /**
   * The sentence about the view has to be earned every time it is printed. Beside two hulls
   * drawn at their antennae, "the hulls are placed from these offsets" is the same false
   * claim as the hull-offset cell used to make, moved into the prose - and the three ways a
   * hull ends up unplaced are the three cases below.
   */
  it("says only B's hull was placed, when only B carries offsets", () => {
    expect(html).toContain("B&#39;s hull in the view is placed from her offsets");
  });

  it("claims no placement when neither ship carries offsets", () => {
    const html = panelsFor(
      scenario([actor("A", northboundPoints(), COASTER), actor("B", westboundPoints(), COASTER)]),
    );

    expect(html).toContain("neither hull in the view is moved off the position reported for her");
    expect(html).toContain("also the distance between the hulls as drawn");
  });

  it("claims no placement for a track already reported at the hull", () => {
    const moved = actor("B", westboundPoints(), BIG_SHIP);
    moved.track.positionAt = "reference-point";
    const html = panelsFor(scenario([actor("A", northboundPoints(), COASTER), moved]));

    expect(html).toContain("neither hull in the view is moved off the position reported for her");
  });

  it("claims no placement for an antenna the offsets put amidships", () => {
    // Bow and stern equal, port and starboard equal: a real arrangement, stated rather than
    // missing, whose arithmetic comes to nothing and whose hull therefore does not move.
    const amidships: Vessel = {
      ...BIG_SHIP,
      referencePointOffsets: {
        fromBowMetres: 90,
        fromSternMetres: 90,
        fromPortMetres: 14,
        fromStarboardMetres: 14,
      },
    };
    const html = panelsFor(
      scenario([actor("A", northboundPoints(), COASTER), actor("B", westboundPoints(), amidships)]),
    );

    expect(html).toContain("neither hull in the view is moved off the position reported for her");
  });

  it("claims no placement for offsets that nothing gave a direction to hang on", () => {
    const html = panelsFor(
      scenario([actor("A", northboundPoints(), COASTER), actor("B", silentPoints(), BIG_SHIP)]),
    );

    expect(html).toContain("neither hull in the view is moved off the position reported for her");
  });

  /**
   * Placement is not a property of a ship, or even of a track. The renderer decides it from
   * the sample it is drawing, so a track that states a course at some points and not at
   * others is placed for part of its length and not the rest - and this sentence is about one
   * moment, the closest approach. Here that moment lands on the one point that says nothing,
   * so the hull is sitting on her antenna while a track-wide answer would call her placed.
   */
  it("answers for the moment of closest approach, not for the track as a whole", () => {
    const closesAtASilentPoint = westboundPoints().map((p, i) =>
      i === 2 ? { t: p.t, lat: p.lat, lon: p.lon } : p,
    );
    const html = panelsFor(
      scenario([
        actor("A", northboundPoints(), COASTER),
        actor("B", closesAtASilentPoint, BIG_SHIP),
      ]),
    );

    // Two of her three points do state a course, and the actor table says so.
    expect(html).toContain("applied where she states a direction (2/3)");
    expect(html).toContain("neither hull in the view is moved off the position reported for her");
  });

  /**
   * The note under the aspect table describes how the figures were arrived at, which is the
   * same for every scenario. It used to carry measurements taken on the reference case -
   * including that the hulls end up touching - and printed them over two ships in a test
   * tube that never come within 200 m of each other.
   */
  it("keeps the aspect note to what is true of any encounter", () => {
    expect(html).toContain("between the positions the sources report");
    expect(html).not.toContain("tenth of a degree");
  });

  /**
   * The heading is what fixes a ship's light arcs, and a Class B transponder does not send
   * one. Standing the course over ground in for it is a judgement the reader has to be
   * told about - a panel that quietly substitutes it is asserting something the source
   * never said.
   */
  it("says so when an aspect was read from the course rather than the heading", () => {
    expect(html).toContain("(from course over ground)");
  });

  it("refuses to name an aspect when the source gives neither heading nor course", () => {
    const html = panelsFor(
      scenario([actor("A", northboundPoints(), COASTER), actor("B", silentPoints(), BIG_SHIP)]),
    );

    expect(html).toContain("no heading and no course: cannot say");
  });

  it("says what is missing rather than guessing it, when there are no particulars", () => {
    const noVessel: Actor = actor("B", westboundPoints());
    const html = panelsFor(scenario([actor("A", northboundPoints(), COASTER), noVessel]));

    expect(html).toContain("carries no vessel particulars");
  });

  it("counts the plausibility findings in the heading of that section", () => {
    expect(html).toMatch(/Plausibility screening \(\d+\)/);
  });

  it("says nothing is wrong rather than showing an empty table on a clean track", () => {
    expect(panelsFor(scenario())).toContain("Nothing implausible.");
  });

  it("declines to compare when the scenario has only one actor", () => {
    const html = panelsFor(scenario([actor("A", northboundPoints(), COASTER)]));
    expect(html).toContain("Needs two actors.");
  });

  it("escapes what it puts into the page", () => {
    const hostile = scenario();
    hostile.meta.title = `<img src=x onerror="alert(1)">`;
    expect(panelsFor(hostile)).not.toContain("<img src=x");
  });
});

describe("the plausibility table", () => {
  /**
   * The screening's whole point is to surface a transcription error before it becomes a
   * video, so the findings have to reach the page rather than only the return value: which
   * ship, when, what kind, and enough detail to check the source by hand.
   */
  it("lists what a ship could not have done, with the time and the reason", () => {
    const impossible: TrackPoint[] = [
      { t: "2025-01-01T00:00:00Z", lat: 0, lon: 0, cogDegreesTrue: 0, sogKnots: 6 },
      // Five kilometres in a minute is about 160 knots.
      { t: "2025-01-01T00:01:00Z", lat: 0.045, lon: 0, cogDegreesTrue: 0, sogKnots: 6 },
    ];
    const html = panelsFor(
      scenario([actor("A", impossible, COASTER), actor("B", westboundPoints(), BIG_SHIP)]),
    );

    expect(html).toContain("implausible-speed");
    expect(html).toContain("00:00:00");
    expect(html).toMatch(/Plausibility screening \([1-9]/);
    expect(html).not.toContain("Nothing implausible.");
  });
});
