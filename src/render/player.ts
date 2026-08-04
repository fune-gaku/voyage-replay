/**
 * Ties a scenario to a canvas: builds the cast, moves them, and answers "what does this
 * look like from there".
 */

import type { PerspectiveCamera } from "three";
import { Group, WebGLRenderer, type Camera, type OrthographicCamera } from "three";

import { prepareActor, sampleAt, type PreparedTrack } from "../core/track.js";
import type { Actor, Scenario, Vessel } from "../core/types.js";
import {
  frameOverheadCamera,
  makeBridgeCamera,
  makeOverheadCamera,
  placeBridgeCamera,
  type BridgeFit,
} from "./cameras.js";
import { headingToRotationY, toWorld } from "./coords.js";
import { buildHull } from "./hull.js";
import { buildNavigationLights } from "./navlights.js";
import { buildScene, buildTrackLine } from "./scene.js";

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
  sectors: Group;
  fit: BridgeFit;
}

export class Replay {
  readonly startSeconds: number;
  readonly endSeconds: number;

  private readonly renderer: WebGLRenderer;
  private readonly cast: Cast[] = [];
  private readonly sceneParts: ReturnType<typeof buildScene>;
  private readonly overhead: OrthographicCamera;
  private readonly bridge: PerspectiveCamera;
  private readonly extentMetres: number;

  private readonly diagram: Group;
  private readonly minimumOverheadExtent: number;
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
    const prepared = scenario.actors.map((actor) => ({
      actor,
      track: prepareActor(actor, scenario.origin),
    }));

    this.startSeconds = Math.min(...prepared.map((p) => p.track.startSeconds));
    this.endSeconds = Math.max(...prepared.map((p) => p.track.endSeconds));
    this.currentSeconds = this.startSeconds;
    this.extentMetres = extentOf(prepared.map((p) => p.track));

    this.sceneParts = buildScene(scenario.environment, this.extentMetres);
    // Track lines belong to the diagram, not to the night: nobody on a bridge sees where
    // the other ship has been. They are the strongest orientation cue in the plan view
    // and a fiction from a wheelhouse window.
    this.diagram = new Group();
    this.sceneParts.scene.add(this.diagram);

    prepared.forEach(({ actor, track }, index) => {
      const vessel = actor.vessel ?? DEFAULT_VESSEL;
      const colour = ACTOR_COLOURS[index % ACTOR_COLOURS.length] ?? 0xffffff;
      const hull = buildHull(vessel, colour);
      const freeboard = hull.eyeHeightMetres * 0.4;
      const lights = buildNavigationLights(vessel, freeboard);

      const group = new Group();
      group.add(hull.group);
      group.add(lights.group);
      this.sceneParts.actors.add(group);
      this.diagram.add(buildTrackLine(track, colour));

      this.cast.push({
        actor,
        track,
        vessel,
        group,
        sectors: lights.sectors,
        fit: {
          eyeHeightMetres: hull.eyeHeightMetres,
          bridgeOffsetForwardMetres: hull.bridgeOffsetForwardMetres,
        },
      });
    });

    this.renderer = new WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    this.aspect = canvas.clientWidth / Math.max(canvas.clientHeight, 1);
    this.overhead = makeOverheadCamera();
    this.bridge = makeBridgeCamera(this.aspect);

    // Never let the plan view zoom closer than a few ship lengths, or the frame collapses
    // onto the hulls at contact and the approach geometry - the thing worth looking at -
    // leaves the screen just as it matters.
    this.minimumOverheadExtent = Math.max(...this.cast.map((c) => c.vessel.loaMetres * 7), 300);

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
    return this.cast.map((c) => c.actor.id);
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
    for (const member of this.cast) {
      const state = sampleAt(member.track, this.currentSeconds);
      if (!state) {
        member.group.visible = false;
        continue;
      }
      member.group.visible = true;
      member.group.position.copy(toWorld(state.position));

      // Heading is what the hull points along. Where the source has none - a Class B
      // transponder transmits no heading - the course over ground stands in, because
      // something has to be drawn; the panel says so rather than hiding it.
      const heading = state.headingDegreesTrue ?? state.cogDegreesTrue ?? 0;
      member.group.rotation.y = headingToRotationY(heading);

      // The arcs are a diagram for the plan view. From a bridge they would be a picture
      // of the rules rather than of the night.
      member.sectors.visible = this.view.kind === "overhead";
    }

    const diagramMode = this.view.kind === "overhead";
    this.diagram.visible = diagramMode;
    this.sceneParts.setDiagramLighting(diagramMode);

    this.renderer.render(this.sceneParts.scene, this.activeCamera());
  }

  /** Follow whoever is on stage, wide enough to hold them all with room to read. */
  private frameOverhead(): void {
    let east = { min: Infinity, max: -Infinity };
    let north = { min: Infinity, max: -Infinity };
    let any = false;

    for (const member of this.cast) {
      const state = sampleAt(member.track, this.currentSeconds);
      if (!state) continue;
      any = true;
      east = {
        min: Math.min(east.min, state.position.east),
        max: Math.max(east.max, state.position.east),
      };
      north = {
        min: Math.min(north.min, state.position.north),
        max: Math.max(north.max, state.position.north),
      };
    }
    if (!any) return;

    const centre = { east: (east.min + east.max) / 2, north: (north.min + north.max) / 2 };
    const span = Math.max(east.max - east.min, north.max - north.min);
    const extent = Math.max(span * 1.9, this.minimumOverheadExtent);

    frameOverheadCamera(this.overhead, centre, extent, this.aspect);
    this.sceneParts.setViewExtent(extent);
  }

  private activeCamera(): Camera {
    if (this.view.kind === "overhead") {
      this.frameOverhead();
      return this.overhead;
    }

    const member = this.cast.find((c) => c.actor.id === this.view.actorId) ?? this.cast[0];
    if (!member) return this.overhead;

    const state = sampleAt(member.track, this.currentSeconds);
    if (!state) return this.overhead;

    placeBridgeCamera(
      this.bridge,
      state.position,
      state.headingDegreesTrue ?? state.cogDegreesTrue ?? 0,
      member.fit,
    );
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

/** Half-width of a square that comfortably holds every track. */
function extentOf(tracks: PreparedTrack[]): number {
  let east = { min: Infinity, max: -Infinity };
  let north = { min: Infinity, max: -Infinity };
  for (const track of tracks) {
    for (const point of track.points) {
      east = {
        min: Math.min(east.min, point.position.east),
        max: Math.max(east.max, point.position.east),
      };
      north = {
        min: Math.min(north.min, point.position.north),
        max: Math.max(north.max, point.position.north),
      };
    }
  }
  const span = Math.max(east.max - east.min, north.max - north.min, 500);
  return span * 1.15;
}
