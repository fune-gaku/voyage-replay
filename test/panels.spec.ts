import { describe, expect, it } from "vitest";

import { prepareActor } from "../src/core/track.js";
import type { Actor, Mark, Scenario, TrackPoint, Vessel } from "../src/core/types.js";
import { formatClock, formatDate } from "../src/core/time.js";
import { ASSUMED_MARK, buildMark } from "../src/render/mark.js";
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

describe("what the drawn hull rests on", () => {
  /**
   * The shape is generated from length and beam: the right size, a generic form, and
   * everything vertical still a fraction of the beam. The one part that can be measured is
   * where the bridge sits, and a reader has to be able to tell a ship that stated her
   * offsets from one whose bridge was put at a fraction of her length - on screen they look
   * exactly alike.
   */
  it("says whether the bridge was measured or assumed", () => {
    const html = panelsFor(
      scenario([actor("A", northboundPoints(), BIG_SHIP), actor("B", westboundPoints(), COASTER)]),
    );
    expect(html, "BIG_SHIP states her four AIS dimensions").toContain("bridge measured");
    expect(html, "COASTER does not").toContain("bridge assumed");
  });

  // A pushing unit is a pusher against the stern of a barge, and a barge is a box.
  it("names the box bow a pushing unit is drawn with", () => {
    const pusher = actor("A", northboundPoints(), {
      ...COASTER,
      type: "pushing-ahead" as const,
    });
    expect(panelsFor(scenario([pusher, actor("B", westboundPoints(), BIG_SHIP)]))).toContain(
      "box bow",
    );
  });
});

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

describe("whether the sea was in the way", () => {
  /**
   * The section's two halves stand differently, and the panel has to keep them apart. The
   * crest height that would hide her is geometry and holds whatever the file says about the
   * weather; the fraction of the time the sea offers one needs a sea, and the reference
   * case - like most reports - states none.
   */
  it("prints the crest threshold even where the file states no sea", () => {
    const html = panelsFor(scenario());
    expect(html).toContain("Whether the sea was in the way");
    expect(html).toContain("hidden by crests above");
    expect(html).toContain("no sea stated");
    expect(html).toContain("An unstated sea is not a calm one");
  });

  it("spreads a sea state across its class rather than printing one figure", () => {
    const subject = scenario();
    subject.environment = { lightCondition: "night", seaState: 4 };
    const html = panelsFor(subject);

    expect(html).not.toContain("no sea stated");
    expect(html).toContain("between 1.25 and 2.5 m");
    expect(html).toContain(
      "assumed from the height, the file giving neither a period nor a wind speed",
    );
  });

  /**
   * Two ships a few hundred metres apart, one of them 36 m to the top of her
   * superstructure. No sea in the class can put a crest between them, and the cell says so
   * with a single figure - the bounds having collapsed - rather than inventing a spread.
   */
  it("hides nothing at a few hundred metres, and does not print a range for it", () => {
    const subject = scenario();
    subject.environment = { lightCondition: "night", seaState: 4 };
    const html = panelsFor(subject);
    expect(html).toContain("<td>0.0%</td>");
    expect(html).not.toContain("% to ");
  });

  it("says a stated height is stated, and stops assuming a period once given one", () => {
    const subject = scenario();
    subject.environment = {
      lightCondition: "night",
      waves: { significantHeightMetres: 1.8, peakPeriodSeconds: 5, derivation: "measured" },
    };
    const html = panelsFor(subject);

    expect(html).toContain("The file states a significant height of 1.8 m");
    expect(html).not.toContain("The period is assumed from the height");
  });

  it("names the assumed heights as assumed, and points at the issue that fixes them", () => {
    const html = panelsFor(scenario());
    expect(html).toContain("assumed from the beam and neither is recorded");
    expect(html).toContain("issue #8");
    // A night case is argued over lights, and lights are not what this table answers for.
    expect(html).toContain("Her lights stand higher");
  });

  it("says significant height is not the height of the waves", () => {
    const subject = scenario();
    subject.environment = { lightCondition: "night", seaState: 5 };
    const html = panelsFor(subject);
    expect(html).toContain("mean of the highest third");
    expect(html).toContain("highest hundredth");
  });

  it("marks sea state 9 as open above rather than letting 14 m pass for a bound", () => {
    const subject = scenario();
    subject.environment = { lightCondition: "night", seaState: 9 };
    const html = panelsFor(subject);
    expect(html).toContain("14 m or more");
    expect(html).not.toContain("between 14 and 14");
  });

  it("declines rather than guessing when either ship has no particulars", () => {
    const subject = scenario([
      actor("A", northboundPoints()),
      actor("B", westboundPoints(), COASTER),
    ]);
    expect(panelsFor(subject)).toContain("every height here is derived from the beam");
  });

  it("needs two actors, like the rest of the encounter sections", () => {
    const subject = scenario([actor("A", northboundPoints(), COASTER)]);
    expect(panelsFor(subject)).toContain("Needs two actors.");
  });
});

describe("what the sea section says about where its figures came from", () => {
  /**
   * The schema requires a derivation on a stated wave height precisely so that a
   * reconstructed one cannot read as a recorded one. The occlusion figures are more
   * sensitive to this number than to anything else on the row, so dropping it on the way to
   * the panel would put the guarantee back where it started.
   */
  it("prints the derivation beside a stated height", () => {
    const subject = scenario();
    subject.environment = {
      lightCondition: "night",
      waves: { significantHeightMetres: 1.8, derivation: "inferred" },
    };
    expect(panelsFor(subject)).toContain("significant height of 1.8 m (inferred)");

    subject.environment.waves = { significantHeightMetres: 1.8, derivation: "measured" };
    expect(panelsFor(subject)).toContain("significant height of 1.8 m (measured)");
  });

  it("calls a sea state's figures inferred, because somebody read them off the water", () => {
    const subject = scenario();
    subject.environment = { lightCondition: "night", seaState: 4 };
    expect(panelsFor(subject)).toContain("between 1.25 and 2.5 m (inferred)");
  });

  /**
   * The cell has to be the narrower claim of the two. A closed range over a class that runs
   * to any height at all would invent the bound the caveat beneath it is denying.
   */
  it("prints a floor rather than a range where the class is open above", () => {
    const subject = scenario([
      actor("A", northboundPoints(), COASTER),
      actor("B", silentPoints(), COASTER),
    ]);
    subject.environment = { lightCondition: "night", seaState: 9 };
    const html = panelsFor(subject);

    expect(html).toContain("or more</td>");
    expect(html).toContain("the last column is a floor and not a range");
  });
});

describe("the sea marks a scenario carries", () => {
  const buoy = (overrides: Partial<Mark> = {}): Mark => ({
    id: "no-1",
    kind: "buoy",
    at: { lat: 33.9, lon: 131.7 },
    ...overrides,
  });

  it("says nothing at all where a scenario carries no marks", () => {
    expect(panelsFor(scenario())).not.toContain("Sea marks");
  });

  /**
   * On screen a pillar this tool chose and a pillar the source stated look exactly alike,
   * and the shape is a statement: a can is port hand where a cone is starboard. The table
   * has to be able to tell them apart even though the picture cannot.
   */
  it("marks a chosen shape, colour and height as chosen", () => {
    const subject = scenario();
    subject.marks = [buoy()];
    const html = panelsFor(subject);

    expect(html).toContain("Sea marks (1)");
    expect(html).toContain("assumed pillar");
    expect(html).toContain("assumed yellow");
    expect(html).toContain("assumed 2.4 m");
    expect(html).toContain("a shape drawn here is a statement made here");
  });

  it("reports a stated shape, colour and height as stated", () => {
    const subject = scenario();
    subject.marks = [buoy({ shape: "can", colour: "red", heightMetres: 3.1, name: "No. 2" })];
    const html = panelsFor(subject);

    expect(html).toContain("<td>can</td>");
    expect(html).toContain("<td>red</td>");
    expect(html).toContain("<td>3.1 m</td>");
    expect(html).toContain("No. 2");
    // "assumed" appears elsewhere on the page - the hull's bridge, the occlusion heights -
    // so the check has to be about this row rather than about the word.
    expect(html).not.toContain("assumed pillar");
    expect(html).not.toContain("assumed yellow");
    expect(html).not.toContain("assumed 2.4 m");
    expect(html).not.toContain("a statement made here");
  });

  it("gives the position, which is the part a report usually turns on", () => {
    const subject = scenario();
    subject.marks = [buoy({ at: { lat: 33.90512, lon: 131.71166 } })];
    expect(panelsFor(subject)).toContain("33.90512, 131.71166");
  });

  /**
   * A buoy stops heaving at a few hundred metres because the water beneath it has, not
   * because the sea has - which the picture cannot say for itself.
   */
  it("says the buoy rides the sea as drawn, and follows it exactly", () => {
    const subject = scenario();
    subject.marks = [buoy({ shape: "spar", colour: "black", heightMetres: 2 })];
    const html = panelsFor(subject);
    expect(html).toContain("riding the sea as the water is drawn beneath it");
    expect(html).toContain("issue #32");
  });
});

describe("which way the drawn sea runs", () => {
  /**
   * The waves are drawn from one direction with a narrow spread, so a reader can take a
   * bearing off the picture. Where the file gives none, the bearing is this tool's and the
   * page has to say so - otherwise the video asserts a figure nothing in the source
   * contains, which is the fault the whole sea section exists to avoid.
   */
  it("warns off the picture's bearing where the file states no direction", () => {
    const subject = scenario();
    subject.environment = { lightCondition: "night", seaState: 4 };
    const html = panelsFor(subject);

    expect(html).toContain("Nothing states which way the sea runs");
    expect(html).toContain("a bearing this tool chose");
    expect(html).toContain("Do not read a wave direction off the picture");
  });

  it("says the file supplied it where the file did", () => {
    const subject = scenario();
    subject.environment = {
      lightCondition: "night",
      waves: { significantHeightMetres: 2, fromDegreesTrue: 290, derivation: "measured" },
    };
    const html = panelsFor(subject);

    expect(html).toContain("coming from 290 degrees true");
    expect(html).not.toContain("a bearing this tool chose");
  });

  it("does not treat a stated due north as a missing direction", () => {
    const subject = scenario();
    subject.environment = {
      lightCondition: "night",
      waves: { significantHeightMetres: 2, fromDegreesTrue: 0, derivation: "measured" },
    };
    expect(panelsFor(subject)).toContain("coming from 0 degrees true");
  });
});

describe("what the picture itself is claiming", () => {
  /**
   * The renderer draws one sea, not a range, and it draws the ROUGH end - among the seas a
   * class permits, a calmer picture is a stronger claim about what could be seen. A reader
   * measuring a wave height off the video would otherwise take that end for the figure.
   */
  it("says which end of a sea state's class the view actually draws", () => {
    const subject = scenario();
    subject.environment = { lightCondition: "night", seaState: 4 };
    const html = panelsFor(subject);

    expect(html).toContain("the view draws the rougher end");
    expect(html).toContain("Do not measure a wave height off the picture");
  });

  /**
   * The day palette is a clear sky, which lights a wave's face and its back differently and
   * so gives a sea shape. An overcast one flattens it. Cloud decides, and no report states
   * it - so the picture is making the choice and the page has to own it.
   *
   * Over a NIGHT it must not say so at all. The sentence was unconditional when it went in
   * and declared a fine day over the reference case's darkness, with a test pinning it
   * there: the page and the picture flatly contradicting each other, which is the fault the
   * sentence was added to fix.
   */
  it("says the view draws a fine day, but only where it draws a day", () => {
    const day = scenario();
    day.environment = { lightCondition: "day" };
    expect(panelsFor(day)).toContain("The view draws a fine day");
    expect(panelsFor(day)).toContain("cloud is the one thing that would decide it");

    for (const environment of [
      { lightCondition: "night" } as const,
      { lightCondition: "twilight" } as const,
      {},
    ]) {
      const subject = scenario();
      subject.environment = environment;
      expect(panelsFor(subject)).not.toContain("fine day");
      expect(panelsFor(subject)).toContain("draws this as night");
    }
  });
});

describe("the one class whose picture is the calmest sea it allows", () => {
  /**
   * Every other sea state has the ROUGH end drawn, because among the seas a class permits a
   * calmer picture is a stronger claim. State 9 has no rough end - it is "over 14 m" - so
   * the sea drawn there is the calmest that fits, which is the opposite way round and the
   * one case where the picture understates. It has to be said outright.
   */
  it("says state 9 is drawn at the least the class allows, not the most", () => {
    const subject = scenario();
    subject.environment = { lightCondition: "night", seaState: 9 };
    const html = panelsFor(subject);

    expect(html).toContain("The view draws 14 m, which here is the least the class allows");
    expect(html).toContain("a calmer picture is the stronger claim");
    expect(html).not.toContain("the view draws the rougher end");
  });
});

describe("the buoy defaults the page names are the ones the view draws", () => {
  /**
   * Written out twice they drift, and when they do the page names a shape the picture is
   * not drawing - a can where a pillar stands, which in the buoyage is a port-hand mark
   * where a cardinal one is. The same fault as the masthead height, one file over.
   */
  it("takes the assumed shape, colour and height from the renderer's own", () => {
    const subject = scenario();
    subject.marks = [{ id: "no-1", kind: "buoy", at: { lat: 33.9, lon: 131.7 } }];
    const html = panelsFor(subject);

    expect(html).toContain(`assumed ${ASSUMED_MARK.shape}`);
    expect(html).toContain(`assumed ${ASSUMED_MARK.colour}`);
    expect(html).toContain(`assumed ${ASSUMED_MARK.heightMetres} m`);
  });

  it("draws exactly what it named, so the two cannot come apart", () => {
    const bare = buildMark({ id: "no-1", kind: "buoy", at: { lat: 33.9, lon: 131.7 } });
    const named = buildMark({
      id: "no-1",
      kind: "buoy",
      at: { lat: 33.9, lon: 131.7 },
      shape: ASSUMED_MARK.shape,
      colour: ASSUMED_MARK.colour,
      heightMetres: ASSUMED_MARK.heightMetres,
    });
    expect(bare.heightMetres).toBe(named.heightMetres);
    expect(bare.group.children.length).toBe(named.group.children.length);
  });
});

describe("the sea has a section of its own", () => {
  /**
   * The correction that found this: the occlusion table needs two ships and the sea does
   * not. A scenario with one ship and a stated sea drew three metres of it, with a readable
   * height and a readable direction, and the page said nothing whatever about them - the
   * picture asserting a sea the page never mentioned.
   */
  it("describes the sea even where there is no encounter to judge", () => {
    const subject = scenario([actor("A", northboundPoints(), COASTER)]);
    subject.environment = {
      lightCondition: "day",
      waves: {
        significantHeightMetres: 3,
        peakPeriodSeconds: 8.6,
        fromDegreesTrue: 290,
        derivation: "inferred",
      },
    };
    const html = panelsFor(subject);

    // The encounter cannot be judged...
    expect(html).toContain("Needs two actors.");
    // ...but everything the view is drawing is still stated.
    expect(html).toContain("The sea");
    expect(html).toContain("3 m");
    expect(html).toContain("8.6 s");
    expect(html).toContain("290 deg true");
    expect(html).toContain("inferred");
  });

  it("says the view draws flat water, and what that claims, where no sea is stated", () => {
    const subject = scenario([actor("A", northboundPoints(), COASTER)]);
    const html = panelsFor(subject);

    expect(html).toContain("the view therefore draws flat water");
    expect(html).toContain("the strongest claim available");
    expect(html).toContain("An unstated sea is not a calm one");
  });

  it("marks an assumed period and an assumed direction as assumed, in the table", () => {
    const subject = scenario();
    subject.environment = { lightCondition: "night", seaState: 4 };
    const html = panelsFor(subject);

    expect(html).toContain("1.25 to 2.5 m");
    expect(html).toContain("(assumed from the height)");
    expect(html).toContain("assumed - nothing states it");
  });
});

describe("restricted visibility, which is the enum's fourth value and a different axis", () => {
  /**
   * `lightCondition` mixes a statement about the sun with a statement about the air, and
   * this is the value that shows it. The view draws it as a day with fog, so declaring a
   * fine day over it contradicts both the picture and the visibility printed two rows
   * above. A fog in the dark carries the same word and would be drawn wrongly.
   */
  it("does not call a fog a fine day, and says what is drawn instead", () => {
    const subject = scenario();
    subject.environment = { lightCondition: "restricted-visibility", visibilityMetres: 600 };
    const html = panelsFor(subject);

    expect(html).not.toContain("fine day");
    expect(html).not.toContain("draws this as night");
    expect(html).toContain("a statement about the air and not about the sun");
    expect(html).toContain("fog is drawn out to the stated 600 m");
    expect(html).toContain("would be drawn wrongly here");
  });

  it("says no fog is drawn where the file gives no distance", () => {
    const subject = scenario();
    subject.environment = { lightCondition: "restricted-visibility", visibilityMetres: null };
    const html = panelsFor(subject);

    expect(html).toContain("no distance is given, so no fog is drawn");
    expect(html).not.toContain("fine day");
  });
});

describe("a caveat only qualifies figures that are there", () => {
  /**
   * The occlusion column is empty where no sea is stated, and a note explaining that the
   * figures run high and low for such-and-such reasons reads as though something had been
   * computed. The reasons belong with the numbers.
   */
  it("keeps the modelling biases for the rows that carry figures", () => {
    const withSea = scenario();
    withSea.environment = { lightCondition: "night", seaState: 4 };
    expect(panelsFor(withSea)).toContain("count crossings independently");

    const without = scenario();
    expect(panelsFor(without)).not.toContain("count crossings independently");
    expect(panelsFor(without)).toContain("The last column is empty rather than zero");
  });
});

describe("the wind, printed whether or not there is a sea to go with it", () => {
  const withWind = (
    wind: Record<string, unknown>,
    rest: Record<string, unknown> = {},
  ): Scenario => {
    const subject = scenario();
    subject.environment = {
      lightCondition: "day",
      wind: { derivation: "measured", ...wind },
      ...rest,
    };
    return subject;
  };

  /**
   * A wind with no stated sea is not nothing: it bounds how big the sea could have been,
   * and it is the figure a deck log always carries where a wave height almost never is.
   */
  it("prints the wind even where the file states no sea", () => {
    const html = panelsFor(withWind({ fromDegreesTrue: 250, speedKnots: 18 }));
    expect(html).toContain("250 deg true");
    expect(html).toContain("18 kn");
    expect(html).toContain("the view therefore draws flat water");
  });

  it("shows a Beaufort force as its number and its whole class, never as a midpoint", () => {
    const html = panelsFor(withWind({ beaufortForce: 5 }));
    expect(html).toContain("force 5: 17 to 21 kn");
    expect(html).not.toContain("19 kn");
  });

  /**
   * Force 12 runs from 64 knots upward, so its two ends are the same number - and a version
   * that tested them for equality before testing for openness printed "64 kn" over a storm
   * with no ceiling. The sea state 9 fault, one field over.
   */
  it("says force 12 is open above, though both its ends are the same figure", () => {
    const html = panelsFor(withWind({ beaufortForce: 12 }));
    expect(html).toContain("force 12: 64 kn or more");
    expect(html).not.toContain("<td>64 kn</td>");
  });

  /**
   * The wind is what settles a direction a sea state cannot give, and the page has to say
   * that is where it came from - it is still not an observation of the waves.
   */
  it("names the wind as the source of a wave direction taken from it", () => {
    const html = panelsFor(withWind({ fromDegreesTrue: 250, speedKnots: 18 }, { seaState: 4 }));
    expect(html).toContain("drawn from the stated wind");
    expect(html).toContain("A swell runs from wherever its own storm was");
    expect(html).toContain("from the stated wind");
  });

  it("names the wind as the source of a period taken from it", () => {
    const html = panelsFor(withWind({ speedKnots: 22 }, { seaState: 4 }));
    expect(html).toContain("taken forwards from the stated wind");
    expect(html).not.toContain("assumed from the height, the file giving neither");
  });

  /**
   * One-sided. A sea too big for its wind is a swell from elsewhere or a mistranscription;
   * a sea too small is the ordinary case and is passed over in silence.
   */
  it("reports a sea too big for its wind, and stays quiet about one too small", () => {
    const big = panelsFor(
      withWind(
        { speedKnots: 5 },
        { waves: { significantHeightMetres: 4, derivation: "measured" } },
      ),
    );
    expect(big).toContain("bigger than the stated wind can raise");
    expect(big).toContain("a swell is running from another weather system");

    const small = panelsFor(
      withWind(
        { speedKnots: 40 },
        { waves: { significantHeightMetres: 0.5, derivation: "measured" } },
      ),
    );
    expect(small).not.toContain("bigger than the stated wind can raise");
  });

  it("says nothing about a wind where the file gives none", () => {
    expect(panelsFor(scenario())).not.toContain("Wind from");
  });
});

describe("how the disagreement quotes the wind it is comparing against", () => {
  /**
   * A force is a class. Quoting its top as though the file had stated 21 knots hands the
   * reader a figure nobody wrote down - inside the very note that exists to point at a
   * figure being wrong.
   */
  it("names a force as a force, and a stated speed as stated", () => {
    const fromForce = scenario();
    fromForce.environment = {
      wind: { beaufortForce: 3, derivation: "measured" },
      waves: { significantHeightMetres: 4, derivation: "measured" },
    };
    expect(panelsFor(fromForce)).toContain("at the top of the stated force");

    const fromSpeed = scenario();
    fromSpeed.environment = {
      wind: { speedKnots: 10, derivation: "measured" },
      waves: { significantHeightMetres: 4, derivation: "measured" },
    };
    const html = panelsFor(fromSpeed);
    expect(html).toContain("the stated 10 kn");
    expect(html).not.toContain("at the top of the stated force");
  });

  it("says which end of each range it took, since both are ranges", () => {
    const subject = scenario();
    subject.environment = {
      wind: { beaufortForce: 2, derivation: "measured" },
      seaState: 5,
    };
    expect(panelsFor(subject)).toContain(
      "the calmest sea the file allows against the strongest wind it allows",
    );
  });
});

describe("a file that states a speed and a force that are not the same wind", () => {
  /**
   * Eighteen knots and force 9 in one file means one of them is wrong. The speed is used,
   * being the narrower statement - but using it in silence leaves a reader with no way to
   * know the file disagreed with itself, and the sea drawn from one is not the sea drawn
   * from the other.
   */
  it("says so, and does not pretend to know which is right", () => {
    const subject = scenario();
    subject.environment = {
      wind: { speedKnots: 18, beaufortForce: 9, derivation: "measured" },
      seaState: 4,
    };
    const html = panelsFor(subject);

    expect(html).toContain("the two are not the same wind");
    expect(html).toContain("not something this tool can decide");
    expect(html).toContain("<td>18 kn</td>");
    // And the other side of the disagreement, which the reader has to be able to check.
    expect(html).toContain("Beaufort force 9");
    expect(html).toContain("41 to 47 kn");
  });

  it("stays quiet where the two agree, and where only one is stated", () => {
    for (const wind of [
      { speedKnots: 18, beaufortForce: 5 },
      { speedKnots: 18 },
      { beaufortForce: 5 },
    ]) {
      const subject = scenario();
      subject.environment = { wind: { derivation: "measured" as const, ...wind }, seaState: 4 };
      expect(panelsFor(subject)).not.toContain("not the same wind");
    }
  });
});

describe("a flat sea, which has no period and no direction", () => {
  /**
   * Sea state 0 with a calm wind printed "0.5 s (from the stated wind)" - the spectrum's
   * lower clamp, presented as a measurement of water with no waves in it. The figures still
   * exist on the `Seaway`, because its fields are numbers; the page must not present them.
   */
  it("reports no period and no direction rather than the spectrum's floor", () => {
    const subject = scenario();
    subject.environment = { seaState: 0, wind: { speedKnots: 0, derivation: "measured" } };
    const html = panelsFor(subject);

    expect(html).toContain("no waves to have one");
    expect(html).toContain("no waves to come from anywhere");
    expect(html).toContain("there is no period and no direction to give");
    expect(html).not.toContain("0.5 s");
    expect(html).not.toContain("from the stated wind");
  });

  it("still gives a period for the faintest sea that has one", () => {
    const subject = scenario();
    subject.environment = { seaState: 1 };
    const html = panelsFor(subject);
    expect(html).not.toContain("no waves to have one");
  });
});

describe("the disagreement note over a calm, whose class has no top to quote", () => {
  /**
   * `forceClass` models Beaufort 0 as "under 1 knot", and the speed row and the range both
   * show it that way - but the note re-read every force as a closed interval and offered
   * "the 1 kn at the top of the stated force". A knot is force 1. The comparison may use it
   * as a supremum, which keeps the warning conservative; the sentence may not present it as
   * a wind the file stated.
   */
  it("does not offer one knot as the wind it compared against", () => {
    const subject = scenario();
    subject.environment = {
      wind: { beaufortForce: 0, derivation: "measured" },
      waves: { significantHeightMetres: 0.5, derivation: "measured" },
    };
    const html = panelsFor(subject);

    expect(html).toContain("bigger than the stated wind can raise");
    expect(html).toContain("anything under 1 kn could raise at most");
    expect(html).not.toContain("at the top of the stated force");
  });

  it("still quotes the top for a class that has one", () => {
    const subject = scenario();
    subject.environment = {
      wind: { beaufortForce: 3, derivation: "measured" },
      waves: { significantHeightMetres: 4, derivation: "measured" },
    };
    const html = panelsFor(subject);
    expect(html).toContain("10 kn at the top of the stated force");
    expect(html).not.toContain("could raise at most");
  });
});

describe("why the height had to supply the period", () => {
  /**
   * A reader who wrote "force 6" and is told the period was assumed "from the height, the
   * file giving neither a period nor a wind speed" has been told something true and left
   * wondering what happened to their wind. It was declined, and the reason is worth a clause.
   */
  it("says a force was declined because a force is a class", () => {
    const subject = scenario();
    subject.environment = { seaState: 5, wind: { beaufortForce: 6, derivation: "measured" } };
    const html = panelsFor(subject);

    expect(html).toContain("a force is a class");
    expect(html).toContain("taking a speed out of the middle of it");
    expect(html).not.toContain("giving neither a period nor a wind speed");
  });

  it("says a speed was declined because it was too light for the sea", () => {
    const subject = scenario();
    subject.environment = { seaState: 5, wind: { speedKnots: 6, derivation: "measured" } };
    const html = panelsFor(subject);

    expect(html).toContain("too light to have raised this sea");
    expect(html).not.toContain("a force is a class");
  });

  it("says the file gave nothing where it gave nothing", () => {
    const subject = scenario();
    subject.environment = { seaState: 5 };
    const html = panelsFor(subject);

    expect(html).toContain("giving neither a period nor a wind speed");
    expect(html).not.toContain("too light to have raised");
  });

  it("says none of it where the wind did supply the period", () => {
    const subject = scenario();
    subject.environment = { seaState: 5, wind: { speedKnots: 35, derivation: "measured" } };
    const html = panelsFor(subject);

    expect(html).toContain("taken forwards from the stated wind");
    expect(html).not.toContain("too light to have raised");
    expect(html).not.toContain("a force is a class");
  });
});

describe("naming the right refusal, of which there are four", () => {
  /**
   * A stated 150 knots against sea state 9 was reported as "too light". It raises 16.6 m
   * with the margin, which is more than the 14 m the view draws. The class simply has no
   * ceiling, and no finite wind can answer for one - so the page was making a false
   * statement about the reader's own figure and sending them to correct the wrong one.
   */
  it("does not call a hundred and fifty knots too light for anything", () => {
    const subject = scenario();
    subject.environment = { seaState: 9, wind: { speedKnots: 150, derivation: "measured" } };
    const html = panelsFor(subject);

    expect(html).not.toContain("too light to have raised");
    expect(html).toContain("having no upper bound");
    expect(html).toContain("no finite wind can answer for a class that runs past every height");
  });

  it("gives the open class as the reason even where a force was stated too", () => {
    const subject = scenario();
    subject.environment = { seaState: 9, wind: { beaufortForce: 11, derivation: "measured" } };
    const html = panelsFor(subject);

    expect(html).toContain("having no upper bound");
    expect(html).not.toContain("a force is a class");
  });

  it("keeps the other three where they belong", () => {
    const cases: [Record<string, unknown>, string][] = [
      [{ seaState: 5, wind: { beaufortForce: 6, derivation: "measured" } }, "a force is a class"],
      [
        { seaState: 5, wind: { speedKnots: 6, derivation: "measured" } },
        "too light to have raised",
      ],
      [{ seaState: 5 }, "giving neither a period nor a wind speed"],
    ];
    for (const [environment, expected] of cases) {
      const subject = scenario();
      subject.environment = environment;
      expect(panelsFor(subject), expected).toContain(expected);
    }
  });
});

describe("naming the end a period belongs to", () => {
  /**
   * "The rough end" is the internal name, and it is wrong for the one class whose rough end
   * is the calmest sea it allows. The page has just finished explaining that state 9's 14 m
   * is a floor; calling it the rough end two lines later takes that back.
   */
  it("does not call the floor of an open class its rough end", () => {
    const subject = scenario();
    subject.environment = { seaState: 9 };
    const html = panelsFor(subject);

    expect(html).toContain("for the 14 m drawn");
    expect(html).not.toContain("s at the rough end");
  });

  it("still names the rough end of a class that has one", () => {
    const subject = scenario();
    subject.environment = { seaState: 4 };
    expect(panelsFor(subject)).toContain("s at the rough end");
  });
});
