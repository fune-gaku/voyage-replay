/**
 * Ties a scenario to a canvas: builds the cast, moves them, and answers "what does this
 * look like from there".
 */

import type { PerspectiveCamera } from "three";
import {
  Color,
  Group,
  NeutralToneMapping,
  NoToneMapping,
  Vector3,
  WebGLRenderer,
  type Camera,
  type MeshStandardMaterial,
  type OrthographicCamera,
} from "three";

import {
  hullCentreOffset,
  offsetMetres,
  placementFor,
  type OffsetMetres,
} from "../actors/vessel/reference-point.js";
import { conditionsAt, type Conditions } from "../core/conditions.js";
import { minimumCandelaForRange } from "../core/illumination.js";
import {
  distanceMetres,
  METRES_PER_NAUTICAL_MILE,
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
import type { LitLamp } from "./lamps.js";
import {
  frameOverheadCamera,
  makeBridgeCamera,
  makeFreeCamera,
  makeOverheadCamera,
  placeBridgeCamera,
  placeFreeCamera,
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
import { ASSUMED_MARK, buildMark, LAMP_COLOURS, type MarkParts } from "./mark.js";
import { orbitEye, pictureOf, type Picture, type ViewSelection } from "./view.js";
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

/**
 * The brightest a hull may be taken to reflect, once its colour is an albedo (#60).
 *
 * **An identity colour is not a measured paint.** The reds and blues above are the ones an
 * investigator's chart uses to tell two ships apart, chosen to be legible on white paper -
 * and the red's linear value is 0.68, which is more light than any paint returns. Left as an
 * albedo it makes a hull that clips to a bright coral in full sun and stays plainly visible
 * under starlight, both of which are claims about how she looked that nothing supports.
 *
 * A third is about the top of what a gloss topcoat manages. Scaling to it keeps the hue that
 * identifies her - which is the whole job of the colour - and takes away the brightness,
 * which was never doing any work. The chart's hulls darken with it, being the same material,
 * and stay the same red and blue.
 */
const BRIGHTEST_PAINT = 0.35;

/** An identity colour as something that could reflect light. See `BRIGHTEST_PAINT`. */
function hullAlbedo(colour: number): Color {
  const albedo = new Color(colour);
  const brightest = Math.max(albedo.r, albedo.g, albedo.b);
  return brightest > BRIGHTEST_PAINT ? albedo.multiplyScalar(BRIGHTEST_PAINT / brightest) : albedo;
}

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

interface Cast {
  actor: Actor;
  track: PreparedTrack;
  vessel: Vessel;
  group: Group;
  /** Holds the hull and the lamps, offset from the reported position to the hull's centre. */
  onHull: Group;
  /**
   * Her hull's material and the two colours it takes.
   *
   * **A chart is a drawing and the world is a place**, which is the split #63 made and the
   * one `setDiagramView` already applies to the lighting, the map's tint and the grid. The
   * chart wants the identity colour as authored, legible the way an investigator's chart is;
   * the world wants an albedo, since a red of 0.68 linear is more than any paint returns and
   * clips in sunlight (#60). One colour cannot be both, and choosing either everywhere loses
   * something real - a washed-out hull in the sun, or a dark smudge on the chart.
   */
  painted: { material: MeshStandardMaterial; chart: Color; world: Color };
  lights: NavigationLightGroup;
  /** Her track on the water, split at wherever she has got to. */
  line: TrackLine;
  /** That offset, along the ship's own axes. Only applies while she has a direction. */
  hullOffset: OffsetMetres;
  eyeHeightMetres: number;
  /** The bridge, forward of the HULL's centre - hull.ts's frame, not the reported one. */
  bridgeOffsetForwardMetres: number;
  /**
   * Which way she was pointed at the instant last drawn, or null where her track does not
   * reach it.
   *
   * Written by `place` rather than worked out again, because the arcs her lamps lay on the
   * water are measured off this bow: a second answer would put the streak and the lamp on
   * different bearings by whatever `placementOf` decided differently.
   */
  headingDegreesTrue: number | null;
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
  const placed = placementFor(state.headingDegreesTrue ?? state.cogDegreesTrue, member.hullOffset);
  return { heading: placed.headingDegreesTrue, offset: placed.offset };
}

/** The watchkeeper the picture is being drawn for: which ship, where her eyes are, and her bow. */
interface Eye {
  position: LocalPosition;
  heading: number;
  /** How high above the water it is, which is the ship's on a bridge and its own otherwise. */
  eyeHeightMetres: number;
  /**
   * The ship it is standing on, and null where it is standing on none.
   *
   * **The one field that stopped a free viewpoint being expressible.** An eye used to BE a
   * ship's bridge - it carried the `Cast` - so an eye anywhere else could not be constructed,
   * whatever the cameras did. Aboard nobody, every ship is another ship: `audienceFor` hands
   * back an observer for all of them, which is what `LampAudience` already meant.
   */
  aboard: Cast | null;
  /**
   * How far below the horizontal it looks. Zero on a bridge, where a watchkeeper is looking
   * at the horizon.
   *
   * **Here rather than worked out again beside the camera.** It was: `facing()` asked the
   * view what kind it was and returned zero for anything it did not recognise, so a viewpoint
   * added without touching it came out level - placed correctly, pointed wrongly, and moving
   * smoothly enough to look deliberate. An aim that travels with the eye cannot be forgotten.
   */
  depressionDegrees?: number;
}

/** What the corner of the frame says while the exposure is not the condition's own. */
function stopsWord(stops: number): string {
  const many = Math.abs(stops) === 1 ? "stop" : "stops";
  return `Exposure ${stops > 0 ? "+" : "-"}${Math.abs(stops)} ${many} from this condition's own`;
}

/** Which way an eye that is not on a bridge looks. Level unless it was given a depression. */
function facingOf(eye: Eye): { headingDegreesTrue: number; depressionDegrees: number } {
  return { headingDegreesTrue: eye.heading, depressionDegrees: eye.depressionDegrees ?? 0 };
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
  if (eye.aboard === member) return { kind: "self" };
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
  /**
   * The conditions at an instant, which the sky needs and the renderer must not work out for
   * itself.
   *
   * A closure rather than the environment block, because `render/` reads `Conditions` and
   * never the scenario's own fields - and a function of time rather than a value, because
   * the sun and the moon are the one part of the weather that moves while a scenario runs.
   */
  conditionsAt: (epochSeconds: number) => Conditions;
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
  /** Says what has been done TO the frame, which the other two never do. See `stops`. */
  private readonly exposureNote: Caption;
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
  private readonly free: PerspectiveCamera;

  private aspect: number;
  private view: ViewSelection = { kind: "chart" };
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
  /**
   * How far the reader has moved the exposure from the one this condition draws at, in
   * photographic stops - each one a doubling.
   *
   * **Zero is not a default that can be argued with; it is the condition's own figure.** A
   * fixed exposure is what lets two frames of one scenario be compared, and it is also why
   * a view that faces the sun is a white sheet: the glitter's peak is nineteen times a clear
   * sky and no single mapping holds both (#71). So the reader may move it, and the picture
   * carries a caption saying by how much for as long as it is moved.
   */
  private stops = 0;
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
    this.exposureNote = this.overlay.caption("top-left", "text");
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
    this.free = makeFreeCamera(this.aspect);

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
    // Leaving the chart part way through its opening leaves the clock held by a camera move
    // nobody can see any more. The picture it belonged to is gone; so is it.
    if (pictureOf(view) !== "chart") this.opening = null;
    this.view = view;
    this.update();
  }

  setSpeed(multiplier: number): void {
    this.speed = multiplier;
  }

  /** Move the exposure off the one the condition draws at, in stops. Zero puts it back. */
  setExposureStops(stops: number): void {
    this.stops = stops;
    this.update();
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

  /**
   * Where the action is, right now, for a viewpoint that wants to be told once.
   *
   * **Asked, not restated.** The sea view stands off a fixed place (#67), and the place it
   * opens on is wherever the frame was already looking - so the control needs this answer,
   * and there must go on being only one of it. A copy of the arithmetic in the controls is
   * two answers to "where is the action", which is the failure this project keeps meeting.
   */
  get actionCentre(): LocalPosition {
    return this.centreOfAction() ?? this.planCentre;
  }

  /**
   * Take the ground under a point of the picture as the place to look at, and say which
   * ground that was.
   *
   * In pixels from the CENTRE of the picture, for the reason `panByPixels` takes deltas: the
   * caller has a pointer and this class has the projection. It answers with the position as
   * well as moving the frame onto it, because the sea view has to be able to stand off the
   * same spot the chart just centred on and must not work it out a second way.
   */
  lookAtPixels(dxPixels: number, dyPixels: number): LocalPosition {
    const metresPerPixel = this.planExtent / Math.max(this.canvas.clientHeight, 1);
    // Screen right is east and screen up is north: the overhead camera is north up.
    const at = {
      east: this.planCentre.east + dxPixels * metresPerPixel,
      north: this.planCentre.north - dyPixels * metresPerPixel,
    };
    this.fixedCentre = at;
    this.opening = null;
    this.update();
    return at;
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
   * Only from the top, only over a frame nobody has taken charge of, and only over a chart.
   *
   * Resuming after a pause is not an opening, and flying out to a thousand kilometres in
   * the middle of an encounter loses the reader's place rather than giving them one. A
   * chosen scale or a dragged centre is somebody having said where they want to be looking,
   * which this must not overrule.
   *
   * **And it is the chart's camera that flies in - `openingExtent` feeds `frameOverhead`
   * and nothing else.** Started over a viewpoint in the world it holds the clock for three
   * and a half seconds while nothing whatever moves on screen, which does not read as a
   * camera move: it reads as a Play button that does not work, and then as a Pause button
   * that does not work either, because every press from the top starts the hold again.
   */
  private wantsOpening(): boolean {
    return (
      pictureOf(this.view) === "chart" &&
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
    for (const camera of [this.bridge, this.free]) {
      camera.aspect = this.aspect;
      camera.updateProjectionMatrix();
    }
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

  /**
   * What a candela per square metre draws as, in this picture.
   *
   * **Khronos's PBR Neutral rather than a filmic curve**, because this tool has no business
   * grading anything: it leaves colours alone until they approach the top and then rolls
   * them off instead of clipping, which is the whole of what is wanted - a full moon's
   * glitter and a night sea are three orders of magnitude apart and both have to be on the
   * screen at once.
   *
   * **And it is off over a chart.** A drawing is not a photograph, so its colours pass
   * through untouched; the curve subtracts a small offset even from the dark end, so a plan
   * view drawn through it would come out slightly and pointlessly wrong. Changing the mode
   * makes three rebuild the programs it has cached, which is a hitch the first time each
   * picture is drawn and nothing afterwards.
   */
  private expose(picture: Picture): void {
    const measured = this.stage.sceneParts.exposureFor(picture);
    this.renderer.toneMapping = measured === null ? NoToneMapping : NeutralToneMapping;
    this.renderer.toneMappingExposure = measured === null ? 1 : measured * 2 ** this.stops;
    // The haze fades towards the sky as the SCREEN shows it, so it follows the exposure.
    this.stage.sceneParts.hazeAt(this.renderer.toneMappingExposure);
    // **A frame taken at an exposure the condition did not choose says so, in the picture.**
    // The recording is `canvas.captureStream()`, so anything outside it is not in the film -
    // and this is exactly the kind of change that must not be able to travel without its
    // caption. Issue #56's requirement, arriving through #71.
    this.exposureNote.set(measured === null || this.stops === 0 ? "" : stopsWord(this.stops));
  }

  /** Place every ship at the current instant and draw one frame. */
  update(): void {
    // **Asked once, of the viewpoint, and handed down.** Every consumer below used to derive
    // it again from which camera was up, which is why a third viewpoint had no answer to any
    // of them: they were not asking about the picture, they were asking about the camera.
    const picture = pictureOf(this.view);
    const eye = this.eyeFor(picture);
    for (const member of this.stage.cast) {
      // Where she has got to, on her own track, before anything is said about her hull.
      member.line.setNow(this.currentSeconds);
      this.place(member, picture, eye);
    }

    this.stage.diagram.visible = picture === "chart";
    this.stage.sceneParts.setDiagramView(picture);
    for (const member of this.stage.cast) {
      const { material, chart, world } = member.painted;
      material.color.copy(picture === "chart" ? chart : world);
    }
    this.expose(picture);
    this.stage.sceneParts.setSeaClock(this.currentSeconds - this.startSeconds);
    // Every frame, because the sky is the one part of the environment that moves: the
    // reference case runs eighty-seven minutes and nautical twilight ends eleven of them
    // before the collision. A sky set once would freeze the moon at the opening frame.
    this.stage.sceneParts.setSky(this.stage.conditionsAt(this.currentSeconds));
    // After the eye is known, since what the sea does under a buoy depends on how far off
    // it is - the water's geometry fades with distance and the buoy has to fade with it.
    this.stage.sceneParts.setEye(eye?.position ?? null, eye?.heading ?? 0);
    for (const mark of this.stage.marks) {
      this.float(mark, eye);
      this.shine(mark, picture);
    }
    // After the lamps have been shown or hidden, since what is lit is what lays a streak.
    this.stage.sceneParts.setLamps(this.lampsLit(picture));
    this.renderer.render(this.stage.sceneParts.scene, this.activeCamera(picture, eye));
    this.drawOverlay(picture);
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
  private drawOverlay(picture: Picture): void {
    this.clock.set(
      `${formatDate(this.currentSeconds, this.timeZone)} ` +
        `${formatClock(this.currentSeconds, this.timeZone)} local`,
    );
    this.credit.set(this.creditFor(picture));
    if (!this.overlay.showing) return;

    this.renderer.autoClear = false;
    this.renderer.render(this.overlay.scene, this.overlay.camera);
    this.renderer.autoClear = true;
  }

  /** Whichever layer of ground this view is actually showing, or nothing. */
  private creditFor(picture: Picture): string {
    // **The layer this PICTURE shows, not the camera that showed it.** A free eye is in the
    // world, so it stands over the elevation tiles; drawing the pale basemap under one would
    // be a chart seen from an angle, which is a different claim about what is on screen.
    if (picture === "chart") return this.mapCredited ? BASEMAP_CREDIT : "";
    return this.landCredited ? TERRAIN_CREDIT : "";
  }

  /** The ship the camera is standing on, if it is standing on one. */
  private viewer(): Cast | null {
    if (this.view.kind !== "bridge") return null;
    const wanted = this.view.actorId;
    const cast = this.stage.cast;
    return cast.find((c) => c.actor.id === wanted) ?? cast[0] ?? null;
  }

  /**
   * Where the eye is, worked out once.
   *
   * The camera goes here, the light arcs are answered from here, the earth bends away from
   * here and the water is drawn around here. They have to be the same point or the picture
   * disagrees with itself: on a bridge this is tens of metres from the reported position -
   * antenna to hull centre, then hull centre to the wheelhouse - which is nothing at four
   * miles and decides which sidelight shows at a cable.
   *
   * **A chart has none.** Not "the eye is somewhere unhelpful": a drawing is not taken from
   * anywhere, and the difference is what the flat earth and the unlit lamps rest on.
   */
  private eyeFor(picture: Picture): Eye | null {
    // **Whether there is an eye at all is one of the eight**, so it follows the picture. A
    // drawing is not taken from anywhere; where the eye stands, when there is one, is the
    // viewpoint's own business and is settled below.
    if (picture === "chart") return null;
    if (this.view.kind === "free") {
      return {
        position: this.view.at,
        heading: this.view.headingDegreesTrue,
        eyeHeightMetres: this.view.heightMetres,
        aboard: null,
        depressionDegrees: this.view.depressionDegrees ?? 0,
      };
    }
    if (this.view.kind === "orbit") return this.orbitingEye(this.view);
    return this.bridgeEye();
  }

  /**
   * An eye standing off a chosen place at an angle and a range, aboard nobody.
   *
   * **The place is the view's own and nothing here moves it.** It orbited whatever the chart
   * was framing, which followed the ships - so a viewpoint set up to be read drifted while it
   * was being read (#67). Where the action is is still worked out in one place, below;
   * whoever opens this view asks for it once and holds what it was told.
   *
   * **Never null.** A bridge eye can be missing, because a ship's own track need not reach
   * this instant, and `activeCamera` falls back to the overhead camera when it is. That
   * fallback is a chart's camera: taken while the picture is still the world, it would draw a
   * curved earth in parallel projection, which is a picture nobody designed. An orbit always
   * has somewhere to stand, because it was told where.
   */
  private orbitingEye(view: Extract<ViewSelection, { kind: "orbit" }>): Eye {
    const eye = orbitEye(view);
    return {
      position: eye.at,
      heading: eye.headingDegreesTrue,
      eyeHeightMetres: eye.heightMetres,
      aboard: null,
      depressionDegrees: eye.depressionDegrees,
    };
  }

  /** The watchkeeper's eyes, or nothing where her own track has not reached this instant. */
  private bridgeEye(): Eye | null {
    const member = this.viewer();
    if (!member) return null;

    const state = sampleAt(member.track, this.currentSeconds);
    if (!state) return null;

    const { heading, offset } = placementOf(member, state);
    return {
      heading,
      eyeHeightMetres: member.eyeHeightMetres,
      aboard: member,
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
  private shine(mark: Moored, picture: Picture): void {
    const lamp = mark.parts.lamp;
    if (!lamp) return;
    if (picture === "chart" || !this.night || !mark.light.known) {
      lamp.visible = false;
      return;
    }

    const showing = showingAt(mark.light.phases, this.currentSeconds - this.startSeconds);
    lamp.visible = showing !== null;
    if (showing !== null) lamp.material.color.set(LAMP_COLOURS[showing]);
  }

  /**
   * Every lamp lit over this water, for the streaks it lays on it.
   *
   * **Not only the lamps drawn.** Which lamps a viewer can SEE is a question about the
   * observer's bearing and `showFor` answers it; which patch of water carries a lamp's colour
   * is a question about that patch, measured off the bow of the ship carrying it. Her own
   * sidelights colour the water alongside her, and a watchkeeper on her bridge sees that
   * while never seeing the lamps themselves.
   *
   * A chart has no streaks on it and neither has a day, which is the judgement `setDiagramView`
   * has already made about the lighting, the map and the glitter path.
   */
  private lampsLit(picture: Picture): LitLamp[] {
    if (picture === "chart" || !this.night) return [];
    const lamps: LitLamp[] = [];
    for (const member of this.stage.cast) {
      const heading = member.headingDegreesTrue;
      if (heading === null) continue;
      for (const { light, at } of member.lights.lit()) {
        lamps.push({
          at,
          colour: new Color(LAMP_COLOURS[light.colour]),
          // Rule 22's range, turned into the minimum candela it was set from - Annex I, section 8.
          minimumCandela: minimumCandelaForRange(light.nominalRangeNauticalMiles),
          headingDegreesTrue: heading,
          arcStartDegrees: light.arc.startDegrees,
          arcEndDegrees: light.arc.endDegrees,
          nominalRangeMetres: light.nominalRangeNauticalMiles * METRES_PER_NAUTICAL_MILE,
        });
      }
    }
    for (const mark of this.stage.marks) lamps.push(...this.markLamp(mark));
    return lamps;
  }

  /**
   * A mark's lamp, if it is showing at this instant.
   *
   * **The rhythm carries onto the water.** A steady lane under a `Q(9)` would be a worse
   * claim than no lane at all, because the rhythm is the whole of what identifies the mark -
   * so the streak is asked the same question the lamp was, at the same moment, and is absent
   * for every dark phase.
   */
  private markLamp(mark: Moored): LitLamp[] {
    const lamp = mark.parts.lamp;
    if (!lamp?.visible) return [];
    return [
      {
        at: lamp.getWorldPosition(new Vector3()),
        colour: lamp.material.color.clone(),
        minimumCandela: minimumCandelaForRange(ASSUMED_MARK.lightRangeNauticalMiles),
        // All-round: IALA marks show over the whole horizon, and this format carries no
        // sectored lights to say otherwise.
        headingDegreesTrue: 0,
        arcStartDegrees: 0,
        arcEndDegrees: 360,
        nominalRangeMetres: ASSUMED_MARK.lightRangeNauticalMiles * METRES_PER_NAUTICAL_MILE,
      },
    ];
  }

  /** One ship at the current instant, or hidden if her track does not reach it. */
  private place(member: Cast, picture: Picture, eye: Eye | null): void {
    const state = sampleAt(member.track, this.currentSeconds);
    member.group.visible = state !== null;
    if (!state) {
      member.headingDegreesTrue = null;
      return;
    }

    // The reported position, which is the antenna. The hull hangs off this group at the
    // offset below, so what moves here is the point the source states. The height is the
    // earth getting in the way, and only from a bridge - see `sinkage`.
    member.group.position.copy(toWorld(state.position, sinkage(state.position, eye)));

    // Heading is what the hull points along. Where the source has none - a Class B
    // transponder transmits no heading - the course over ground stands in, because
    // something has to be drawn; the panel says so rather than hiding it.
    const { heading, offset } = placementOf(member, state);
    member.headingDegreesTrue = heading;
    member.group.rotation.y = headingToRotationY(heading);
    member.onHull.position.set(offset.starboardMetres, 0, -offset.forwardMetres);

    // The arcs are a diagram for the chart. In the world they would be a picture of the
    // rules rather than of the night, wherever the eye is standing.
    member.lights.sectors.visible = picture === "chart";

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

  /**
   * Where the action is: what the chart frames on, and what an orbit turns about.
   *
   * **One answer, asked in two places.** The chart's framing and the orbit's centre are the
   * same question, and the alternative - the control that drives the orbit working it out for
   * itself - is two answers that drift apart. What is NOT shared is the rest of
   * `frameOverhead`: the extent it settles on also decides which ground the basemap fetches,
   * and a viewpoint in the world sending the map after a rectangle nothing draws is the
   * failure #63 named. Issue #65.
   *
   * A dragged view has somewhere to be even at an instant no ship's track reaches; an
   * undragged one has nothing to follow, so the caller keeps it where it was rather than
   * jumping.
   */
  private centreOfAction(): LocalPosition | null {
    const bounds = boundsToHold(this.stage.cast, this.currentSeconds);
    return this.fixedCentre ?? (bounds ? midpointOf(bounds) : null);
  }

  /** Follow whoever is on stage, wide enough to hold them all with room to read. */
  private frameOverhead(): void {
    const centre = this.centreOfAction();
    if (!centre) return;
    const bounds = boundsToHold(this.stage.cast, this.currentSeconds);
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

  private activeCamera(picture: Picture, eye: Eye | null): Camera {
    // **Framing is the chart's, and only the chart's** - a picture decision, not a camera
    // one. `frameOverhead` also tells the map which ground to fetch, so running it for a
    // viewpoint in the world would send the basemap after a rectangle nothing is drawing.
    if (picture === "chart") {
      this.frameOverhead();
      return this.overhead;
    }

    // No eye means a bridge whose own track has not reached this instant. Nothing to stand on.
    if (!eye) return this.overhead;

    // Which camera, on the other hand, is a question about the camera. Both viewpoints that
    // are not aboard a ship take the one that can be pointed down; a bridge takes the one
    // that cannot, which is the claim `placeBridgeCamera` exists to make.
    if (eye.aboard === null) {
      placeFreeCamera(this.free, eye.position, facingOf(eye), eye.eyeHeightMetres);
      return this.free;
    }
    placeBridgeCamera(this.bridge, eye.position, eye.heading, eye.eyeHeightMetres);
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
    conditionsAt: (epochSeconds: number): Conditions =>
      conditionsAt(scenario.origin, scenario.environment, epochSeconds),
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
  // The track line keeps the identity colour as authored - it is a line on a drawing, not a
  // surface with light falling on it - while the hull takes it as something that could
  // reflect. See `BRIGHTEST_PAINT`.
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
    painted: { material: hull.painted, chart: new Color(colour), world: hullAlbedo(colour) },
    lights,
    line: buildTrackLine(track, colour),
    hullOffset: offsetMetres(
      hullCentreOffset(actor.track.positionAt, actor.vessel?.referencePointOffsets),
    ),
    eyeHeightMetres: hull.eyeHeightMetres,
    bridgeOffsetForwardMetres: hull.bridgeOffsetForwardMetres,
    // Nothing has placed her yet, which is not the same as pointing her north.
    headingDegreesTrue: null,
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
