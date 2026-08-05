/**
 * Recording straight off the canvas, rather than screen-capturing the window.
 *
 * Three reasons it is worth the small amount of code: the output does not depend on the
 * window size or on what else is on the screen; playing at 30x does not drop frames the
 * way a screen recorder does; and a retake is one click.
 *
 * The output is WebM, because that is what browsers encode to. YouTube accepts it. If an
 * MP4 is needed, convert with ffmpeg - or wait for a headless renderer, which is the
 * proper answer and a later phase.
 */

export interface Recording {
  blob: Blob;
  mimeType: string;
  durationMs: number;
}

const CANDIDATE_TYPES = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"] as const;

/**
 * How long to wait for the browser to finish a recording before giving up on it.
 *
 * Generous: finalising a WebM of a few minutes is quick, and the cost of being wrong in
 * this direction is a recording thrown away a moment before it arrived.
 */
const STOP_TIMEOUT_MS = 10_000;

export function isRecordingSupported(): boolean {
  return typeof MediaRecorder !== "undefined" && pickMimeType() !== null;
}

function pickMimeType(): string | null {
  if (typeof MediaRecorder === "undefined") return null;
  for (const type of CANDIDATE_TYPES) {
    if (MediaRecorder.isTypeSupported(type)) return type;
  }
  return null;
}

export class CanvasRecorder {
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private startedAtMs = 0;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly framesPerSecond = 60,
  ) {}

  get isRecording(): boolean {
    return this.recorder !== null && this.recorder.state === "recording";
  }

  start(): void {
    if (this.isRecording) return;
    const mimeType = pickMimeType();
    if (!mimeType) throw new Error("this browser cannot record the canvas");

    const stream = this.canvas.captureStream(this.framesPerSecond);
    // The array belongs to this recording rather than to the recorder, and the handler
    // closes over it rather than reading it back off `this`. Stopping is asynchronous, so
    // a second recording can be under way before the first has finished collecting itself,
    // and the two must not be writing into the same place when it does.
    const chunks: Blob[] = [];
    this.chunks = chunks;
    this.recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 12_000_000 });
    this.recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };
    this.startedAtMs = performance.now();
    this.recorder.start();
  }

  /**
   * Let the recorder go BEFORE the wait, not after it.
   *
   * The browser hands over the last of the video in an event raised after `stop()` has
   * returned, and the Record button is live again in that window - `state` goes inactive
   * at once. Someone who stops a recording and immediately starts another therefore has a
   * new recorder running by the time this resolves, and clearing the field at the end
   * would clear THAT one: the page would be left reporting that it is not recording, with
   * a Record button that does nothing and no error anywhere to say why.
   */
  async stop(): Promise<Recording> {
    const recorder = this.recorder;
    if (!recorder) throw new Error("not recording");

    const mimeType = recorder.mimeType;
    const durationMs = performance.now() - this.startedAtMs;
    const chunks = this.chunks;
    this.recorder = null;
    this.chunks = [];

    await new Promise<void>((resolve, reject) => {
      // A deadline, because the alternative to a lost recording is not a kept one.
      //
      // Nothing resolves this but the browser's `stop` event, and a browser that accepts
      // `stop()` and then never raises it leaves the promise pending for good - taking the
      // caller's own state with it. The page ends up disabled and reading "Stop" with no
      // way back short of a reload, which is worse than being told the recording is gone.
      const deadline = setTimeout(() => {
        reject(new Error("the browser never finished stopping the recording"));
      }, STOP_TIMEOUT_MS);

      recorder.onstop = () => {
        clearTimeout(deadline);
        resolve();
      };
      recorder.stop();
    });

    return { blob: new Blob(chunks, { type: mimeType }), mimeType, durationMs };
  }
}

export function downloadRecording(recording: Recording, filename: string): void {
  const url = URL.createObjectURL(recording.blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename.endsWith(".webm") ? filename : `${filename}.webm`;
  anchor.click();
  // Revoking immediately can cancel the download in some browsers; a tick is enough.
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 1000);
}
