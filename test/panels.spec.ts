import { describe, expect, it } from "vitest";

import { prepareActor } from "../src/core/track.js";
import type { Actor, Scenario, TrackPoint } from "../src/core/types.js";
import { escapeHtml, formatClock, formatDate, renderPanels } from "../src/ui/panels.js";
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

  it("reports the closest approach in both metres and miles", () => {
    expect(html).toMatch(/\d+ m \(\d+\.\d\d NM\)/);
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
