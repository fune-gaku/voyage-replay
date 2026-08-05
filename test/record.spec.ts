import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import { CanvasRecorder, downloadRecording, isRecordingSupported } from "../src/render/record.js";

/**
 * Enough of MediaRecorder for CanvasRecorder to drive.
 *
 * This file was excluded from coverage for a while on the grounds that it needed a real
 * browser. It does not. Nothing in it touches a GL context or lays out a page - it asks the
 * canvas for a stream and hands that to a recorder - so a stand-in for the one browser API
 * it calls is the whole environment required.
 */
class FakeMediaRecorder {
  static supported: string[] = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"];
  static last: FakeMediaRecorder | null = null;

  static isTypeSupported(type: string): boolean {
    return FakeMediaRecorder.supported.includes(type);
  }

  state = "inactive";
  readonly mimeType: string;
  readonly videoBitsPerSecond: number | undefined;
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;

  /**
   * What the encoder is still holding when recording stops.
   *
   * This is not a detail of the stand-in, it is the main path. `CanvasRecorder.start()`
   * passes no timeslice, so the browser never hands anything over mid-recording: the
   * whole video arrives in one `dataavailable` raised by `stop()`, and only then is
   * `stop` raised. Code that assembled the blob before waiting for that would produce an
   * empty file every time, so the fake has to raise the two in the real order.
   */
  pending: string | null = "the recording";

  constructor(
    readonly stream: unknown,
    options: { mimeType: string; videoBitsPerSecond?: number },
  ) {
    this.mimeType = options.mimeType;
    this.videoBitsPerSecond = options.videoBitsPerSecond;
    FakeMediaRecorder.last = this;
  }

  start(): void {
    this.state = "recording";
  }

  /** A chunk arriving from the encoder mid-recording. */
  emit(text: string): void {
    this.ondataavailable?.({ data: new Blob([text]) });
  }

  stop(): void {
    this.state = "inactive";
    // Asynchronously, and data before stop, as the browser does both.
    queueMicrotask(() => {
      if (this.pending !== null) this.ondataavailable?.({ data: new Blob([this.pending]) });
      this.onstop?.();
    });
  }
}

/** The spy is handed back separately: reading it back off the canvas is an unbound method. */
function fakeCanvas(): { canvas: HTMLCanvasElement; captureStream: Mock } {
  const captureStream = vi.fn(() => ({ id: "stream" }));
  return { canvas: { captureStream } as unknown as HTMLCanvasElement, captureStream };
}

beforeEach(() => {
  FakeMediaRecorder.supported = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"];
  FakeMediaRecorder.last = null;
  vi.stubGlobal("MediaRecorder", FakeMediaRecorder);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("isRecordingSupported", () => {
  // The button is disabled on this answer, so a wrong "yes" surfaces as a click that
  // throws rather than as a missing feature.
  it("says no where the browser has no MediaRecorder at all", () => {
    vi.stubGlobal("MediaRecorder", undefined);
    expect(isRecordingSupported()).toBe(false);
  });

  it("says no where none of the candidate encodings is available", () => {
    FakeMediaRecorder.supported = ["video/mp4"];
    expect(isRecordingSupported()).toBe(false);
  });

  it("says yes where one is", () => {
    expect(isRecordingSupported()).toBe(true);
  });
});

describe("CanvasRecorder", () => {
  it("records the canvas itself rather than the screen", () => {
    const { canvas, captureStream } = fakeCanvas();
    new CanvasRecorder(canvas, 30).start();

    expect(captureStream).toHaveBeenCalledWith(30);
    expect(FakeMediaRecorder.last?.stream).toEqual({ id: "stream" });
  });

  // VP9 first, then VP8, then whatever WebM the browser has. Taking the last supported
  // type instead would silently hand back a worse encode on every browser that has both.
  it("takes the best encoding the browser offers, not the first it finds", () => {
    new CanvasRecorder(fakeCanvas().canvas).start();
    expect(FakeMediaRecorder.last?.mimeType).toBe("video/webm;codecs=vp9");

    FakeMediaRecorder.supported = ["video/webm;codecs=vp8", "video/webm"];
    new CanvasRecorder(fakeCanvas().canvas).start();
    expect(FakeMediaRecorder.last?.mimeType).toBe("video/webm;codecs=vp8");
  });

  /**
   * The output is the deliverable - it goes into an article or a report - so it is encoded
   * well above what a browser would choose by default. A dark sea with a handful of point
   * lights is exactly the picture a low bitrate destroys.
   */
  it("encodes at a bitrate the result can survive", () => {
    new CanvasRecorder(fakeCanvas().canvas).start();
    expect(FakeMediaRecorder.last?.videoBitsPerSecond).toBeGreaterThanOrEqual(8_000_000);
  });

  it("reports whether it is recording", () => {
    const recorder = new CanvasRecorder(fakeCanvas().canvas);
    expect(recorder.isRecording).toBe(false);
    recorder.start();
    expect(recorder.isRecording).toBe(true);
  });

  it("ignores a second start rather than dropping what it already has", () => {
    const recorder = new CanvasRecorder(fakeCanvas().canvas);
    recorder.start();
    const first = FakeMediaRecorder.last;
    recorder.start();

    expect(FakeMediaRecorder.last).toBe(first);
  });

  it("refuses to start where the browser cannot encode", () => {
    FakeMediaRecorder.supported = [];
    expect(() => {
      new CanvasRecorder(fakeCanvas().canvas).start();
    }).toThrow(/cannot record/);
  });

  it("refuses to stop when it never started", async () => {
    await expect(new CanvasRecorder(fakeCanvas().canvas).stop()).rejects.toThrow(/not recording/);
  });

  /**
   * The one that matters, and the reason the fake raises `dataavailable` from inside
   * `stop()`. With no timeslice the entire video arrives in that last event, so a `stop()`
   * that assembled the blob before waiting for it would hand back an empty file - on every
   * recording, not on an edge case. A test that fed the chunks in by hand beforehand would
   * not notice.
   */
  it("waits for the video the browser only hands over as it stops", async () => {
    const recorder = new CanvasRecorder(fakeCanvas().canvas);
    recorder.start();

    const recording = await recorder.stop();
    expect(recording.blob.size).toBe("the recording".length);
  });

  it("gathers the chunks into one blob of the type it recorded", async () => {
    const recorder = new CanvasRecorder(fakeCanvas().canvas);
    recorder.start();
    FakeMediaRecorder.last!.pending = "third";
    FakeMediaRecorder.last!.emit("first");
    FakeMediaRecorder.last!.emit("second");

    const recording = await recorder.stop();
    expect(recording.mimeType).toBe("video/webm;codecs=vp9");
    expect(recording.blob.size).toBe("firstsecondthird".length);
    expect(recording.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("drops the empty chunks the encoder emits", async () => {
    const recorder = new CanvasRecorder(fakeCanvas().canvas);
    recorder.start();
    FakeMediaRecorder.last!.pending = null;
    FakeMediaRecorder.last!.ondataavailable?.({ data: new Blob([]) });
    FakeMediaRecorder.last!.emit("kept");

    expect((await recorder.stop()).blob.size).toBe("kept".length);
  });

  // The chunks belong to the recording that collected them, not to the recorder.
  it("does not carry the last recording's video into the next one", async () => {
    const recorder = new CanvasRecorder(fakeCanvas().canvas);
    recorder.start();
    const first = await recorder.stop();

    recorder.start();
    const second = await recorder.stop();
    expect(second.blob.size).toBe(first.blob.size);
  });

  it("can be started again after it has stopped", async () => {
    const recorder = new CanvasRecorder(fakeCanvas().canvas);
    recorder.start();
    await recorder.stop();
    expect(recorder.isRecording).toBe(false);

    recorder.start();
    expect(recorder.isRecording).toBe(true);
  });
});

describe("downloadRecording", () => {
  const anchor = { href: "", download: "", click: vi.fn() };
  // Held as their own bindings rather than read back off the stubbed URL, which would be
  // an unbound method access.
  const createObjectURL = vi.fn(() => "blob:voyage");
  const revokeObjectURL = vi.fn();

  beforeEach(() => {
    anchor.href = "";
    anchor.download = "";
    anchor.click.mockClear();
    createObjectURL.mockClear();
    revokeObjectURL.mockClear();
    vi.stubGlobal("document", { createElement: () => anchor });
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });
  });

  function recording(): { blob: Blob; mimeType: string; durationMs: number } {
    return { blob: new Blob(["v"]), mimeType: "video/webm", durationMs: 1000 };
  }

  it("names the file after the scenario and gives it a .webm extension", () => {
    downloadRecording(recording(), "suo-nada-2025-11-27");

    expect(anchor.download).toBe("suo-nada-2025-11-27.webm");
    expect(anchor.href).toBe("blob:voyage");
    expect(anchor.click).toHaveBeenCalledOnce();
  });

  it("does not double the extension when the caller already added one", () => {
    downloadRecording(recording(), "already.webm");
    expect(anchor.download).toBe("already.webm");
  });

  // Revoking in the same tick cancels the download in some browsers, so the URL is held
  // for a moment. That delay is the behaviour, not an accident of ordering.
  it("holds the object URL until after the download has begun", () => {
    vi.useFakeTimers();
    downloadRecording(recording(), "held");

    expect(revokeObjectURL).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:voyage");
  });
});
