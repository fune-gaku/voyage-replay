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
    this.chunks = [];
    this.recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 12_000_000 });
    this.recorder.ondataavailable = (event) => {
      if (event.data.size > 0) this.chunks.push(event.data);
    };
    this.startedAtMs = performance.now();
    this.recorder.start();
  }

  async stop(): Promise<Recording> {
    const recorder = this.recorder;
    if (!recorder) throw new Error("not recording");

    const mimeType = recorder.mimeType;
    const durationMs = performance.now() - this.startedAtMs;

    await new Promise<void>((resolve) => {
      recorder.onstop = () => {
        resolve();
      };
      recorder.stop();
    });

    this.recorder = null;
    return { blob: new Blob(this.chunks, { type: mimeType }), mimeType, durationMs };
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
