/**
 * Ties a scenario to a canvas: builds the cast, moves them, and answers "what does this
 * look like from there".
 */

import type { PerspectiveCamera } from "three";
import { Group, WebGLRenderer, type Camera, type OrthographicCamera } from "three";

import {
  hullCentreOffset,
  NO_OFFSET,
  offsetMetres,
  type OffsetMetres,
} from "../actors/vessel/reference-point.js";
import { offsetAlongHeading, relativeBearingDegrees, type LocalPosition } from "../core/geodesy.js";
import { prepareActor, sampleAt, type PreparedTrack, type SampledState } from "../core/track.js";
import type { Actor, Scenario, Vessel } from "../core/types.js";
import {
  frameOverheadCamera,
  makeBridgeCamera,
  makeOverheadCamera,
  placeBridgeCamera,
} from "./cameras.js";
import { headingToRotationY, toWorld } from "./coords.js";
import { buildHull } from "./hull.js";
import {
  buildNavigationLights,
  type LampAudience,
  type NavigationLightGroup,
} from "./navlights.js";
import { buildScene, buildTrackLine, type SceneParts } from "./scene.js";

/** Red for the first ship, blue for the second - the colours JTSB uses in its own charts. */
const ACTOR_COLOURS = [0xd8443c, 0x3f7bd8, 0xd8b23c, 0x46b07a];

const DEFAULT_VESSEL: Vessel = { loaMetres: 30, beamMetres: 8 };

export interface ViewSelection {
  kind: "overhead" | "bridge";
  /** Which ship's bridge. Ignored for the overhead view. */
  actorId?: string;
}

interface Cast {
  actor: Actor;
  track: PreparedTrack;
  vessel: Vessel;
  group: Group;
  /** Holds the hull and the lamps, offset from the reported position to the hull's centre. */
  onHull: Group;
  lights: NavigationLightGroup;
  /** That offset, along the ship's own axes. Only applies while she has a direction. */
  hullOffset: OffsetMetres;
  eyeHeightMetres: number;
  /** The bridge, forward of the HULL's centre - hull.ts's frame, not the reported one. */
  bridgeOffsetForwardMetres: number;
}

/**
 * What the source says about where she is pointing, and what follows for the hull.
 *
 * A hull has to be pointed somewhere: with no heading and no course there is still a ship to
 * draw, so she points north and the panels' aspect column says the geometry cannot be read.
 * She must not be MOVED somewhere on the same footing. The antenna offset runs along her
 * heading, so applying it to an invented one displaces her tens of metres away from the one
 * thing the source does state - her position - and the result looks exactly like a ship that
 * was placed correctly.
 *
 * A track that states a direction at some points and not at others therefore jumps when the
 * offset switches on, at the midpoint of the span, which is an artefact of how sampleAt
 * blends a value against a missing one rather than anything in the data. That instant is
 * already a discontinuity - the hull snaps from north to the stated course there - and every
 * cheap way of smoothing it either embellishes a measured point or invents positions, so it
 * is issue #12 rather than something to paper over here.
 */
function placementOf(member: Cast, state: SampledState): { heading: number; offset: OffsetMetres } {
  const stated = state.headingDegreesTrue ?? state.cogDegreesTrue;
  return stated === undefined
    ? { heading: 0, offset: NO_OFFSET }
    : { heading: stated, offset: member.hullOffset };
}

/** The watchkeeper the picture is being drawn for: which ship, where her eyes are, and her bow. */
interface Eye {
  member: Cast;
  position: LocalPosition;
  heading: number;
}

/**
 * Who this ship's lamps are being lit for.
 *
 * The bearing handed on is the observer's, measured from the bow of the ship carrying the
 * lamps - the argument order CLAUDE.md warns about, because reversing it comes out exactly
 * 180 degrees round and still looks like a ship. Note which heading it is measured against:
 * hers, never the watcher's.
 *
 * No eye at all means the plan view, or a bridge whose own track has run out; both want the
 * diagram, which is what the renderer drew before any of this and is right for a picture
 * that is annotating itself rather than reporting a sighting.
 */
function audienceFor(
  member: Cast,
  position: LocalPosition,
  heading: number,
  eye: Eye | null,
): LampAudience {
  if (!eye) return { kind: "diagram" };
  if (eye.member === member) return { kind: "self" };
  return {
    kind: "observer",
    relativeBearingDegrees: relativeBearingDegrees(position, eye.position, heading),
  };
}

/**
 * Everything that comes from the scenario, as opposed to from the canvas.
 *
 * The split is worth a name: the stage is decided once by the case being reconstructed and
 * never changes, while the renderer and the cameras below it belong to whatever surface
 * happens to be showing it and are rebuilt or resized freely.
 */
interface Stage {
  startSeconds: number;
  endSeconds: number;
  sceneParts: SceneParts;
  diagram: Group;
  cast: Cast[];
  minimumOverheadExtent: number;
}

export class Replay {
  readonly startSeconds: number;
  readonly endSeconds: number;

  private readonly stage: Stage;
  private readonly renderer: WebGLRenderer;
  private readonly overhead: OrthographicCamera;
  private readonly bridge: PerspectiveCamera;

  private aspect: number;
  private view: ViewSelection = { kind: "overhead" };
  private currentSeconds: number;
  private playing = false;
  private speed = 20;
  private lastFrameMs: number | null = null;
  private frameRequest: number | null = null;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    scenario: Scenario,
  ) {
    this.stage = buildStage(scenario);
    this.startSeconds = this.stage.startSeconds;
    this.endSeconds = this.stage.endSeconds;
    this.currentSeconds = this.startSeconds;

    this.renderer = new WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.aspect = canvas.clientWidth / Math.max(canvas.clientHeight, 1);
    this.overhead = makeOverheadCamera();
    this.bridge = makeBridgeCamera(this.aspect);

    this.resize();
    this.update();
  }

  get timeSeconds(): number {
    return this.currentSeconds;
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  get speedMultiplier(): number {
    return this.speed;
  }

  get actorIds(): string[] {
    return this.stage.cast.map((c) => c.actor.id);
  }

  setView(view: ViewSelection): void {
    this.view = view;
    this.update();
  }

  setSpeed(multiplier: number): void {
    this.speed = multiplier;
  }

  seek(epochSeconds: number): void {
    this.currentSeconds = Math.min(Math.max(epochSeconds, this.startSeconds), this.endSeconds);
    this.update();
  }

  play(): void {
    if (this.playing) return;
    if (this.currentSeconds >= this.endSeconds) this.currentSeconds = this.startSeconds;
    this.playing = true;
    this.lastFrameMs = null;
    this.tick();
  }

  pause(): void {
    this.playing = false;
    if (this.frameRequest !== null) cancelAnimationFrame(this.frameRequest);
    this.frameRequest = null;
  }

  resize(): void {
    const width = this.canvas.clientWidth;
    const height = Math.max(this.canvas.clientHeight, 1);
    this.renderer.setSize(width, height, false);
    this.aspect = width / height;
    this.bridge.aspect = this.aspect;
    this.bridge.updateProjectionMatrix();
    this.update();
  }

  dispose(): void {
    this.pause();
    this.renderer.dispose();
  }

  /** Place every ship at the current instant and draw one frame. */
  update(): void {
    const diagramMode = this.view.kind === "overhead";
    const eye = diagramMode ? null : this.eye();
    for (const member of this.stage.cast) {
      this.place(member, diagramMode, eye);
    }

    this.stage.diagram.visible = diagramMode;
    this.stage.sceneParts.setDiagramLighting(diagramMode);
    this.renderer.render(this.stage.sceneParts.scene, this.activeCamera());
  }

  /** The ship the camera is standing on, if it is standing on one. */
  private viewer(): Cast | null {
    if (this.view.kind !== "bridge") return null;
    const cast = this.stage.cast;
    return cast.find((c) => c.actor.id === this.view.actorId) ?? cast[0] ?? null;
  }

  /**
   * Where the watchkeeper's eyes are, worked out once.
   *
   * The camera goes here and the light arcs are answered from here, and they have to be the
   * same point or the picture disagrees with itself: this is tens of metres from the
   * reported position on a large ship - antenna to hull centre, then hull centre to the
   * wheelhouse - which is nothing at four miles and decides which sidelight shows at a
   * cable.
   */
  private eye(): Eye | null {
    const member = this.viewer();
    if (!member) return null;

    const state = sampleAt(member.track, this.currentSeconds);
    if (!state) return null;

    const { heading, offset } = placementOf(member, state);
    return {
      member,
      heading,
      position: offsetAlongHeading(
        state.position,
        heading,
        member.bridgeOffsetForwardMetres + offset.forwardMetres,
        offset.starboardMetres,
      ),
    };
  }

  /** One ship at the current instant, or hidden if her track does not reach it. */
  private place(member: Cast, diagramMode: boolean, eye: Eye | null): void {
    const state = sampleAt(member.track, this.currentSeconds);
    member.group.visible = state !== null;
    if (!state) return;

    // The reported position, which is the antenna. The hull hangs off this group at the
    // offset below, so what moves here is the point the source states.
    member.group.position.copy(toWorld(state.position));

    // Heading is what the hull points along. Where the source has none - a Class B
    // transponder transmits no heading - the course over ground stands in, because
    // something has to be drawn; the panel says so rather than hiding it.
    const { heading, offset } = placementOf(member, state);
    member.group.rotation.y = headingToRotationY(heading);
    member.onHull.position.set(offset.starboardMetres, 0, -offset.forwardMetres);

    // The arcs are a diagram for the plan view. From a bridge they would be a picture
    // of the rules rather than of the night.
    member.lights.sectors.visible = diagramMode;

    member.lights.showFor(audienceFor(member, state.position, heading, eye));
  }

  /** Follow whoever is on stage, wide enough to hold them all with room to read. */
  private frameOverhead(): void {
    const bounds = boundsOfVisible(this.stage.cast, this.currentSeconds);
    if (!bounds) return;

    const centre = {
      east: (bounds.east.min + bounds.east.max) / 2,
      north: (bounds.north.min + bounds.north.max) / 2,
    };
    const span = Math.max(bounds.east.max - bounds.east.min, bounds.north.max - bounds.north.min);
    const extent = Math.max(span * 1.9, this.stage.minimumOverheadExtent);

    frameOverheadCamera(this.overhead, centre, extent, this.aspect);
    this.stage.sceneParts.setViewExtent(extent);
  }

  private activeCamera(): Camera {
    if (this.view.kind === "overhead") {
      this.frameOverhead();
      return this.overhead;
    }

    // The eye goes wherever the hull went, or it ends up outside the ship it belongs to.
    const eye = this.eye();
    if (!eye) return this.overhead;

    placeBridgeCamera(this.bridge, eye.position, eye.heading, eye.member.eyeHeightMetres);
    return this.bridge;
  }

  private tick = (): void => {
    if (!this.playing) return;
    const now = performance.now();
    const elapsedMs = this.lastFrameMs === null ? 0 : now - this.lastFrameMs;
    this.lastFrameMs = now;

    this.currentSeconds += (elapsedMs / 1000) * this.speed;
    if (this.currentSeconds >= this.endSeconds) {
      this.currentSeconds = this.endSeconds;
      this.playing = false;
    }

    this.update();
    if (this.playing) this.frameRequest = requestAnimationFrame(this.tick);
  };
}

function buildStage(scenario: Scenario): Stage {
  const prepared = scenario.actors.map((actor) => ({
    actor,
    track: prepareActor(actor, scenario.origin),
  }));
  const tracks = prepared.map((p) => p.track);
  const sceneParts = buildScene(scenario.environment, extentOf(tracks));

  // Track lines belong to the diagram, not to the night: nobody on a bridge sees where
  // the other ship has been. They are the strongest orientation cue in the plan view
  // and a fiction from a wheelhouse window.
  const diagram = new Group();
  sceneParts.scene.add(diagram);
  const cast = prepared.map((entry, index) => enterStage(entry, index, sceneParts, diagram));

  return {
    startSeconds: Math.min(...tracks.map((t) => t.startSeconds)),
    endSeconds: Math.max(...tracks.map((t) => t.endSeconds)),
    sceneParts,
    diagram,
    cast,
    // Never let the plan view zoom closer than a few ship lengths, or the frame collapses
    // onto the hulls at contact and the approach geometry - the thing worth looking at -
    // leaves the screen just as it matters.
    minimumOverheadExtent: Math.max(...cast.map((c) => c.vessel.loaMetres * 7), 300),
  };
}

/** Build one ship and put her, and her track line, into the scene. */
function enterStage(
  { actor, track }: { actor: Actor; track: PreparedTrack },
  index: number,
  sceneParts: SceneParts,
  diagram: Group,
): Cast {
  const colour = ACTOR_COLOURS[index % ACTOR_COLOURS.length] ?? 0xffffff;
  const member = castMember(actor, track, colour);
  sceneParts.actors.add(member.group);
  diagram.add(buildTrackLine(track, colour));
  return member;
}

function castMember(actor: Actor, track: PreparedTrack, colour: number): Cast {
  const vessel = actor.vessel ?? DEFAULT_VESSEL;
  const hull = buildHull(vessel, colour);
  const lights = buildNavigationLights(vessel, hull.eyeHeightMetres * 0.4);

  // The track reports the GPS antenna; a hull is drawn about its own centre. Everything
  // bolted to the ship - hull and lamps alike, since a sidelight is on the ship and not on
  // the antenna - hangs off one inner group carrying that offset, so the outer group's
  // rotation carries it round with the heading and it stays along the ship's own axes.
  const onHull = new Group();
  onHull.add(hull.group);
  onHull.add(lights.group);

  const group = new Group();
  group.add(onHull);

  return {
    actor,
    track,
    vessel,
    group,
    onHull,
    lights,
    hullOffset: offsetMetres(
      hullCentreOffset(actor.track.positionAt, actor.vessel?.referencePointOffsets),
    ),
    eyeHeightMetres: hull.eyeHeightMetres,
    bridgeOffsetForwardMetres: hull.bridgeOffsetForwardMetres,
  };
}

interface Bounds {
  east: Extremes;
  north: Extremes;
}

interface Extremes {
  min: number;
  max: number;
}

/** The box round every ship that has a position at this instant, or null if none has. */
function boundsOfVisible(cast: Cast[], epochSeconds: number): Bounds | null {
  const positions = cast
    .map((member) => sampleAt(member.track, epochSeconds))
    .filter((state) => state !== null)
    .map((state) => state.position);
  if (positions.length === 0) return null;

  return {
    east: extremesOf(positions.map((p) => p.east)),
    north: extremesOf(positions.map((p) => p.north)),
  };
}

function extremesOf(values: number[]): Extremes {
  return { min: Math.min(...values), max: Math.max(...values) };
}

/** Half-width of a square that comfortably holds every track. */
function extentOf(tracks: PreparedTrack[]): number {
  const positions = tracks.flatMap((track) => track.points.map((p) => p.position));
  const east = extremesOf(positions.map((p) => p.east));
  const north = extremesOf(positions.map((p) => p.north));
  const span = Math.max(east.max - east.min, north.max - north.min, 500);
  return span * 1.15;
}
