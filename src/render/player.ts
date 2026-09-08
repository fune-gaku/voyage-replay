/**
 * Ties a scenario to a canvas: builds the cast, moves them, and answers "what does this
 * look like from there".
 */

import type { PerspectiveCamera } from "three";
import { Group, Vector3, WebGLRenderer, type Camera, type OrthographicCamera } from "three";

import {
  hullCentreOffset,
  NO_OFFSET,
  offsetMetres,
  type OffsetMetres,
} from "../actors/vessel/reference-point.js";
import {
  distanceMetres,
  offsetAlongHeading,
  relativeBearingDegrees,
  toLocalPosition,
  type LocalPosition,
} from "../core/geodesy.js";
import { dropMetres } from "../core/horizon.js";
import { formatClock, formatDate } from "../core/time.js";
import { prepareActor, sampleAt, type PreparedTrack, type SampledState } from "../core/track.js";
import type { Actor, Scenario, Vessel } from "../core/types.js";
import { BASEMAP_CREDIT } from "./basemap.js";
import {
  frameOverheadCamera,
  makeBridgeCamera,
  makeOverheadCamera,
  placeBridgeCamera,
} from "./cameras.js";
import { headingToRotationY, toWorld } from "./coords.js";
import { buildOverlay, type Caption, type Overlay } from "./overlay.js";
import { pixelAngle } from "./waves.js";
import { lightOf, type LightReading } from "../actors/mark/light.js";
import { ridingOf, type Riding } from "../actors/mark/riding.js";
import { drawnAppearance } from "../actors/mark/appearance.js";
import { floats } from "../actors/mark/mooring.js";
import { buildHull } from "./hull.js";
import { showingAt } from "../core/light-character.js";
import { buildMark, LAMP_COLOURS, type MarkParts } from "./mark.js";
import {
  buildNavigationLights,
  type LampAudience,
  type NavigationLightGroup,
} from "./navlights.js";
import {
  buildScene,
  buildTrackLine,
  isNight,
  type Ground,
  type SceneParts,
  type TrackLine,
} from "./scene.js";
import { TERRAIN_CREDIT } from "./terrain.js";

/** Red for the first ship, blue for the second - the colours JTSB uses in its own charts. */
const ACTOR_COLOURS = [0xd8443c, 0x3f7bd8, 0xd8b23c, 0x46b07a];

const DEFAULT_VESSEL: Vessel = { loaMetres: 30, beamMetres: 8 };

/**
 * The opening shot: how wide it starts, and how long it takes to close in.
 *
 * A reconstruction answers "what happened" and says nothing about "where". Framed on the
 * action from the first frame, every case looks like the same patch of open water, and a
 * reader who does not already know the Suo-nada from the Inland Sea has no way to find
 * out. A thousand kilometres holds a country; a few seconds is long enough to read it and
 * short enough not to be in the way.
 *
 * In wall-clock milliseconds, not scenario seconds, because it is a camera move rather
 * than part of the record - it has to feel the same at 1x and at 60x. The clock is held
 * while it runs, so nothing of the encounter happens behind it.
 */
const OPENING_EXTENT_METRES = 1_000_000;
const OPENING_MS = 3_500;

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
  /** Her track on the water, split at wherever she has got to. */
  line: TrackLine;
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
 * How far below the tangent plane the earth's bulge has carried this ship, seen from that
 * eye. Zero for the plan view, which is a chart and is drawn flat.
 *
 * The whole ship moves by one number. Over a 180 m hull at twenty kilometres, bow and stern
 * differ by 0.49 m - a tilt of 0.16 degrees, in a renderer that models neither heel nor
 * pitch - so bending her along her length would be precision about the wrong thing. The
 * water and the land, which are tens of thousands of vertices spanning tens of kilometres,
 * are bent properly, in the shader. See `render/curvature.ts`.
 */
function sinkage(position: LocalPosition, eye: Eye | null): number {
  return eye ? -dropMetres(distanceMetres(position, eye.position)) : 0;
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
/** One mark in the scene, with its place worked out once and whether it floats. */
interface Moored {
  parts: MarkParts;
  at: LocalPosition;
  /** A buoy rides the sea; a beacon is built on the ground and does not. */
  floats: boolean;
  /** How she answers it, where she floats at all. Worked out once: her shape does not change. */
  riding: Riding | undefined;
  /** Its light, or why nothing can be shown flashing. Read once - the file does not change. */
  light: LightReading;
}

interface Stage {
  startSeconds: number;
  endSeconds: number;
  sceneParts: SceneParts;
  diagram: Group;
  cast: Cast[];
  marks: Moored[];
  minimumOverheadExtent: number;
}

export class Replay {
  readonly startSeconds: number;
  readonly endSeconds: number;

  private readonly stage: Stage;
  private readonly overlay: Overlay;
  private readonly clock: Caption;
  private readonly credit: Caption;
  private readonly timeZone: string;
  /**
   * Whether the scene is the night, asked of `scene.ts` rather than of the scenario again.
   * A mark's light is drawn on the same answer that darkened the water, so the page, the sea
   * and the lamps cannot disagree about what time of day it was.
   */
  private readonly night: boolean;
  private readonly renderer: WebGLRenderer;
  private readonly overhead: OrthographicCamera;
  private readonly bridge: PerspectiveCamera;

  private aspect: number;
  private view: ViewSelection = { kind: "overhead" };
  /**
   * The plan view's scale in metres, or null while it follows the ships.
   *
   * Not clamped by `minimumOverheadExtent` the way the automatic framing is. That floor is
   * there to stop the frame collapsing onto two hulls at the moment they touch when nobody
   * asked it to; somebody who picks two hundred metres has asked.
   */
  private fixedExtentMetres: number | null = null;
  /** Whether a map tile has arrived, which is what the plan view's credit answers for. */
  private mapCredited = false;
  /** The same question for the land, which only the bridge view draws. */
  private landCredited = false;
  /**
   * Where the plan view is looking, or null while it follows the ships.
   *
   * Separate from the scale, because they are separately worth overriding: somebody who
   * has zoomed in to read a passing distance still wants the frame to keep up with the
   * ships, and somebody who has dragged the view onto a headland still wants it to open
   * out as they separate.
   */
  private fixedCentre: LocalPosition | null = null;
  /** The opening shot, while one is running. See OPENING_EXTENT_METRES. */
  private opening: { startedMs: number; progress: number } | null = null;
  /** What the plan view is actually showing, chosen or worked out. See planExtentMetres. */
  private planExtent: number;
  /** Where it is actually looking, chosen or worked out. A drag starts from here. */
  private planCentre: LocalPosition = { east: 0, north: 0 };
  private currentSeconds: number;
  private playing = false;
  private speed = 20;
  private lastFrameMs: number | null = null;
  private frameRequest: number | null = null;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    scenario: Scenario,
  ) {
    // Built before the stage, because the stage is what starts fetching the map and the
    // credit is what answers for it having arrived.
    this.overlay = buildOverlay();
    this.clock = this.overlay.caption("top-right", "figures");
    this.credit = this.overlay.caption("bottom-right", "text");
    this.timeZone = scenario.meta.timeZone;
    this.night = isNight(scenario.environment?.lightCondition);
    this.stage = buildStage(scenario, this.tileArrivals());
    this.startSeconds = this.stage.startSeconds;
    this.endSeconds = this.stage.endSeconds;
    this.currentSeconds = this.startSeconds;
    this.planExtent = this.stage.minimumOverheadExtent;

    this.renderer = new WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.aspect = canvas.clientWidth / Math.max(canvas.clientHeight, 1);
    this.overhead = makeOverheadCamera();
    this.bridge = makeBridgeCamera(this.aspect);

    this.resize();
    this.update();
  }

  /**
   * What to do when the first map or land tile lands.
   *
   * A redraw rather than nothing: the tiles arrive long after the opening frame was drawn,
   * and the credit for them is drawn INSIDE the canvas, so a frame that was correct when it
   * was made becomes one that shows a map with no attribution on it.
   */
  private tileArrivals(): Omit<Ground, "origin"> {
    return {
      onFirstTile: () => {
        this.mapCredited = true;
        this.update();
      },
      onFirstLandTile: () => {
        this.landCredited = true;
        this.update();
      },
    };
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

  /**
   * How much sea the plan view is showing from top to bottom, right now.
   *
   * Whether that was chosen or worked out is not part of the answer, and that is the
   * point: a control that takes over from the automatic framing has to start from where
   * the picture already is, or the first turn of a wheel jumps to the far end of the range.
   */
  get planExtentMetres(): number {
    return this.planExtent;
  }

  setView(view: ViewSelection): void {
    this.view = view;
    this.update();
  }

  setSpeed(multiplier: number): void {
    this.speed = multiplier;
  }

  /**
   * Fix how much sea the plan view shows, top to bottom, or hand it back to the automatic
   * framing with null.
   *
   * Only the scale: the frame still centres on whoever is on stage. Panning as well would
   * mean a picture that no longer answers "what were these two doing", which is what this
   * view is for, and it is a separate thing to want.
   */
  setScale(extentMetres: number | null): void {
    this.fixedExtentMetres = extentMetres;
    this.opening = null;
    this.update();
  }

  /**
   * Drag the plan view, in canvas pixels, so the ground stays under the pointer.
   *
   * In pixels rather than metres because the caller has a pointer and this class has the
   * projection. How many metres a pixel is worth depends on the scale in use and on how
   * tall the canvas is, and both of those live here - a caller that did the arithmetic
   * would be a second place that had to be right about it.
   */
  panByPixels(dxPixels: number, dyPixels: number): void {
    const metresPerPixel = this.planExtent / Math.max(this.canvas.clientHeight, 1);
    // Screen up is north, and the ground moves the opposite way to the frame: pull the map
    // to the right and the view has moved west, not east.
    this.fixedCentre = {
      east: this.planCentre.east - dxPixels * metresPerPixel,
      north: this.planCentre.north + dyPixels * metresPerPixel,
    };
    this.opening = null;
    this.update();
  }

  /** Hand the plan view back to following the ships. Leaves the scale as it is. */
  recentre(): void {
    this.fixedCentre = null;
    this.update();
  }

  seek(epochSeconds: number): void {
    this.currentSeconds = Math.min(Math.max(epochSeconds, this.startSeconds), this.endSeconds);
    this.opening = null;
    this.update();
  }

  play(): void {
    if (this.playing) return;
    if (this.currentSeconds >= this.endSeconds) this.currentSeconds = this.startSeconds;
    this.opening = this.wantsOpening() ? { startedMs: performance.now(), progress: 0 } : null;
    this.playing = true;
    this.lastFrameMs = null;
    this.tick();
  }

  /**
   * Only from the top, and only over a frame nobody has taken charge of.
   *
   * Resuming after a pause is not an opening, and flying out to a thousand kilometres in
   * the middle of an encounter loses the reader's place rather than giving them one. A
   * chosen scale or a dragged centre is somebody having said where they want to be looking,
   * which this must not overrule.
   */
  private wantsOpening(): boolean {
    return (
      this.fixedExtentMetres === null &&
      this.fixedCentre === null &&
      this.currentSeconds === this.startSeconds
    );
  }

  pause(): void {
    this.playing = false;
    this.opening = null;
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
    // The shortest wave the sea can carry is a property of the frame: a fixed figure would
    // keep the chop until it crawled on a small window and drop it early on a large one, so
    // the drawn band would depend on how big somebody's browser is.
    //
    // **Times the pixel ratio, because the fragment shader runs on the drawing buffer and
    // not on the CSS box.** A retina screen puts two device pixels in each of these, so
    // taking the layout height would drop every component at half the range it should - the
    // drawn band would then depend on the reader's DISPLAY rather than on the window.
    this.stage.sceneParts.setPixelAngle(
      pixelAngle(this.bridge.fov, height * this.renderer.getPixelRatio()),
    );
    this.overlay.resize(width, height);
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
      // Where she has got to, on her own track, before anything is said about her hull.
      member.line.setNow(this.currentSeconds);
      this.place(member, diagramMode, eye);
    }

    this.stage.diagram.visible = diagramMode;
    this.stage.sceneParts.setDiagramView(diagramMode);
    this.stage.sceneParts.setSeaClock(this.currentSeconds - this.startSeconds);
    // After the eye is known, since what the sea does under a buoy depends on how far off
    // it is - the water's geometry fades with distance and the buoy has to fade with it.
    this.stage.sceneParts.setEye(eye?.position ?? null, eye?.heading ?? 0);
    for (const mark of this.stage.marks) {
      this.float(mark, eye);
      this.shine(mark, diagramMode);
    }
    this.renderer.render(this.stage.sceneParts.scene, this.activeCamera());
    this.drawOverlay(diagramMode);
  }

  /**
   * A second pass over the frame just drawn, in pixel space, without clearing it.
   *
   * The clock goes on every frame: it is the one thing a recording cannot recover for
   * itself, and the plan view no longer says night by being dark. The credit is narrower -
   * only once a tile has arrived, and only in the view that tile is drawn in. A caption
   * crediting a basemap over a bridge view, or over a scene whose tiles never loaded, is a
   * false statement about the picture rather than an attribution of it. Two layers now, in
   * two views, so the caption names whichever one is actually on screen.
   */
  private drawOverlay(diagramMode: boolean): void {
    this.clock.set(
      `${formatDate(this.currentSeconds, this.timeZone)} ` +
        `${formatClock(this.currentSeconds, this.timeZone)} local`,
    );
    this.credit.set(this.creditFor(diagramMode));
    if (!this.overlay.showing) return;

    this.renderer.autoClear = false;
    this.renderer.render(this.overlay.scene, this.overlay.camera);
    this.renderer.autoClear = true;
  }

  /** Whichever layer of ground this view is actually showing, or nothing. */
  private creditFor(diagramMode: boolean): string {
    if (diagramMode) return this.mapCredited ? BASEMAP_CREDIT : "";
    return this.landCredited ? TERRAIN_CREDIT : "";
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

  /**
   * One buoy, riding the sea as it is drawn under her.
   *
   * A buoy is small against an ocean wave, so she follows the surface rather than arguing
   * with it: her deck lies along the local slope and her waterline is the local height. A
   * beacon leaves before any of that - it is built on the ground and the sea runs past it.
   * That is a real approximation and it fails in short steep seas, where a buoy of a few
   * metres spans a wave and cannot follow - the same response question issue #32 holds
   * back for ships, and the reason nothing here pretends to a period of its own.
   */
  private float(mark: Moored, eye: Eye | null): void {
    // A beacon stands on a foundation on the shoal it marks. It neither heaves nor tilts,
    // and putting it on the surface would draw a structure riding a swell.
    if (!mark.floats) {
      mark.parts.group.position.copy(toWorld(mark.at, sinkage(mark.at, eye)));
      return;
    }
    const seconds = this.currentSeconds - this.startSeconds;
    // Her own answer to the sea, not the sea. A float on a long swell follows the surface
    // and one in a short chop moves further than it and later, and a spar buoy - which
    // exists to stay upright - hardly leans at all.
    const sea = this.stage.sceneParts.drawnSurfaceAt(mark.at, seconds, mark.riding);
    mark.parts.group.position.copy(toWorld(mark.at, sinkage(mark.at, eye) + sea.heightMetres));
    // The surface normal, in the scene's axes: north is -z, so a rise to the north tilts
    // the buoy towards +z. Getting that sign wrong leans every buoy the wrong way, which
    // reads as plausible until it is watched against the waves going past.
    UP.set(-sea.slopeEast, 1, sea.slopeNorth).normalize();
    mark.parts.group.quaternion.setFromUnitVectors(VERTICAL, UP);
  }

  /**
   * Whether this mark's light is showing at this instant, and in what colour.
   *
   * **The rhythm is the mark.** Under IALA the four cardinal marks are told apart by nothing
   * else, so a steady dot where a Q(9) should be is not a lesser picture but a different
   * mark - which is why an unreadable character shows nothing at all rather than something
   * plainer.
   *
   * Drawn from a bridge at night and nowhere else. A chart is not a moment, so a plan view
   * has no business blinking; and a light is not what a mark looks like by day. Both of
   * those are the judgement `setDiagramView` already makes about lighting and the map.
   */
  private shine(mark: Moored, diagramMode: boolean): void {
    const lamp = mark.parts.lamp;
    if (!lamp) return;
    if (diagramMode || !this.night || !mark.light.known) {
      lamp.visible = false;
      return;
    }

    const showing = showingAt(mark.light.phases, this.currentSeconds - this.startSeconds);
    lamp.visible = showing !== null;
    if (showing !== null) lamp.material.color.set(LAMP_COLOURS[showing]);
  }

  /** One ship at the current instant, or hidden if her track does not reach it. */
  private place(member: Cast, diagramMode: boolean, eye: Eye | null): void {
    const state = sampleAt(member.track, this.currentSeconds);
    member.group.visible = state !== null;
    if (!state) return;

    // The reported position, which is the antenna. The hull hangs off this group at the
    // offset below, so what moves here is the point the source states. The height is the
    // earth getting in the way, and only from a bridge - see `sinkage`.
    member.group.position.copy(toWorld(state.position, sinkage(state.position, eye)));

    // Heading is what the hull points along. Where the source has none - a Class B
    // transponder transmits no heading - the course over ground stands in, because
    // something has to be drawn; the panel says so rather than hiding it.
    const { heading, offset } = placementOf(member, state);
    member.group.rotation.y = headingToRotationY(heading);
    member.onHull.position.set(offset.starboardMetres, 0, -offset.forwardMetres);

    // The arcs are a diagram for the plan view. From a bridge they would be a picture
    // of the rules rather than of the night.
    member.lights.sectors.visible = diagramMode;

    // Her lamps and her sectors hang off onHull, so the arcs have to be answered from the
    // hull's centre too. Answering from the reported position instead puts the wedge the
    // plan view draws and the lamp the bridge view lights on different bearings, by the
    // whole antenna offset - fifty metres on the ship in the fixtures.
    member.lights.showFor(
      audienceFor(
        member,
        offsetAlongHeading(state.position, heading, offset.forwardMetres, offset.starboardMetres),
        heading,
        eye,
      ),
    );
  }

  /** Follow whoever is on stage, wide enough to hold them all with room to read. */
  private frameOverhead(): void {
    const bounds = boundsToHold(this.stage.cast, this.currentSeconds);
    // A dragged view has somewhere to be even at an instant no ship's track reaches; an
    // undragged one has nothing to follow, so it stays where it was rather than jumping.
    const centre = this.fixedCentre ?? (bounds ? midpointOf(bounds) : null);
    if (!centre) return;
    this.planCentre = centre;

    const span = bounds ? spanOf(bounds) : 0;
    const settled = Math.max(span * 1.9, this.stage.minimumOverheadExtent);
    const extent = this.fixedExtentMetres ?? this.openingExtent(settled);
    this.planExtent = extent;

    frameOverheadCamera(this.overhead, centre, extent, this.aspect);
    // The same three numbers the camera was framed with, so the map fetches the ground the
    // frame is actually over rather than an approximation of it.
    this.stage.sceneParts.setView({ centre, extentMetres: extent, aspect: this.aspect });
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

  /**
   * How wide the plan view is while the opening shot runs, easing in.
   *
   * Interpolated on the LOGARITHM of the two extents, because a zoom is a ratio rather
   * than a difference: stepping linearly from a thousand kilometres to fifty spends most
   * of its length crossing ground nothing can be made out in and then arrives with a jolt.
   * Constant ratio per second is what reads as flying in.
   */
  private openingExtent(settled: number): number {
    const opening = this.opening;
    if (!opening) return settled;
    // Smoothstep, so it leaves and arrives without a start and a stop.
    const eased = opening.progress * opening.progress * (3 - 2 * opening.progress);
    return Math.exp(Math.log(OPENING_EXTENT_METRES) * (1 - eased) + Math.log(settled) * eased);
  }

  private tick = (): void => {
    if (!this.playing) return;
    const now = performance.now();
    const elapsedMs = this.lastFrameMs === null ? 0 : now - this.lastFrameMs;
    this.lastFrameMs = now;

    // The clock is held while the camera flies in, so nothing of the encounter happens
    // behind the opening shot.
    if (this.opening) this.advanceOpening(now);
    else this.playing = this.advancePlayback(elapsedMs);

    this.update();
    if (this.playing) this.frameRequest = requestAnimationFrame(this.tick);
  };

  private advanceOpening(nowMs: number): void {
    const opening = this.opening;
    if (!opening) return;
    opening.progress = Math.min((nowMs - opening.startedMs) / OPENING_MS, 1);
    if (opening.progress >= 1) this.opening = null;
  }

  /**
   * Move the clock on, and say whether the tracks have anything left.
   *
   * Answering rather than setting `playing` from in here, because the caller is what the
   * loop reads to decide whether to ask for another frame - and a flag put down out of
   * sight is one the compiler stops believing can change, which is how a loop that has
   * stopped goes on requesting frames with nothing to say about it.
   */
  private advancePlayback(elapsedMs: number): boolean {
    const wanted = this.currentSeconds + (elapsedMs / 1000) * this.speed;
    this.currentSeconds = Math.min(wanted, this.endSeconds);
    return this.currentSeconds < this.endSeconds;
  }
}

/** Scratch vectors for `float`, which runs for every buoy on every frame. */
const VERTICAL = new Vector3(0, 1, 0);
const UP = new Vector3();

/**
 * Every mark in the scenario, placed once and asked once what it is.
 *
 * Both questions are settled here rather than per frame: neither the file nor the ground a
 * beacon stands on changes while a replay runs, and re-reading a light's character sixty
 * times a second would be parsing a string to get the same answer every time.
 */
function moorMarks(scenario: Scenario, sceneParts: SceneParts): Moored[] {
  // The buoyage region decides the lateral colours and nothing else, and it cannot be worked
  // out from where the scenario is: the boundary between the two is a map, not a formula.
  const region = scenario.meta.buoyageRegion ?? null;
  return (scenario.marks ?? []).map((mark) => {
    const parts = buildMark(mark, region);
    sceneParts.actors.add(parts.group);
    // The same resolution the renderer drew from, so how she answers the sea and how she
    // looks cannot come from two different shapes.
    const shape = drawnAppearance(mark, region).shape?.value;
    return {
      parts,
      at: toLocalPosition(mark.at, scenario.origin),
      floats: floats(mark),
      // From the shape that was DRAWN, which for a mark with a purpose comes from the
      // buoyage rather than from a stated field - a safe-water sphere and a spar answer the
      // same sea very differently.
      riding: shape ? ridingOf(shape, parts.heightMetres, mark.draughtMetres) : undefined,
      light: lightOf(mark, region),
    };
  });
}

function buildStage(scenario: Scenario, arrivals: Omit<Ground, "origin">): Stage {
  const prepared = scenario.actors.map((actor) => ({
    actor,
    track: prepareActor(actor, scenario.origin),
  }));
  const tracks = prepared.map((p) => p.track);
  const sceneParts = buildScene(scenario.environment, extentOf(boundsOfTracks(tracks)), {
    origin: scenario.origin,
    ...arrivals,
  });

  // Track lines belong to the diagram, not to the night: nobody on a bridge sees where
  // the other ship has been. They are the strongest orientation cue in the plan view
  // and a fiction from a wheelhouse window.
  const diagram = new Group();
  diagram.name = "diagram";
  sceneParts.scene.add(diagram);
  const cast = prepared.map((entry, index) => enterStage(entry, index, sceneParts, diagram));
  const marks = moorMarks(scenario, sceneParts);

  return {
    startSeconds: Math.min(...tracks.map((t) => t.startSeconds)),
    endSeconds: Math.max(...tracks.map((t) => t.endSeconds)),
    sceneParts,
    diagram,
    cast,
    marks,
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
  diagram.add(member.line.group);
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
    line: buildTrackLine(track, colour),
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

function midpointOf(bounds: Bounds): LocalPosition {
  return {
    east: (bounds.east.min + bounds.east.max) / 2,
    north: (bounds.north.min + bounds.north.max) / 2,
  };
}

function spanOf(bounds: Bounds): number {
  return Math.max(bounds.east.max - bounds.east.min, bounds.north.max - bounds.north.min);
}

/**
 * The box the plan view has to hold: every ship in the case, not only the ones whose track
 * reaches this instant.
 *
 * Tracks rarely start together. In this project's reference case one transponder is
 * recorded half an hour before the other, and framing only what is on stage collapses the
 * view onto a single ship for the first ninety seconds of the replay - the part that is
 * meant to show two ships approaching from opposite ends of the sea.
 *
 * So a track that does not reach this instant is asked for its nearest moment instead: its
 * first reported position before it starts, its last after it ends. That is a claim about
 * framing, not about the ship - she is still hidden until her own record begins, and what
 * fills the space is her track line, which the plan view draws whole.
 */
function boundsToHold(cast: Cast[], epochSeconds: number): Bounds | null {
  const positions = cast
    .map((member) => sampleAt(member.track, withinTrack(member.track, epochSeconds)))
    .filter((state) => state !== null)
    .map((state) => state.position);
  if (positions.length === 0) return null;

  return {
    east: extremesOf(positions.map((p) => p.east)),
    north: extremesOf(positions.map((p) => p.north)),
  };
}

function withinTrack(track: PreparedTrack, epochSeconds: number): number {
  return Math.min(Math.max(epochSeconds, track.startSeconds), track.endSeconds);
}

function extremesOf(values: number[]): Extremes {
  return { min: Math.min(...values), max: Math.max(...values) };
}

/** The box round every point of every track, whether or not anyone is there at the time. */
function boundsOfTracks(tracks: PreparedTrack[]): Bounds {
  const positions = tracks.flatMap((track) => track.points.map((p) => p.position));
  return {
    east: extremesOf(positions.map((p) => p.east)),
    north: extremesOf(positions.map((p) => p.north)),
  };
}

/** Half-width of a square that comfortably holds every track. */
function extentOf(bounds: Bounds): number {
  return Math.max(spanOf(bounds), 500) * 1.15;
}
