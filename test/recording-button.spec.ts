import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  wireRecordingButton,
  type RecordablePlayback,
  type RecordingButtonParts,
} from "../src/ui/recording-button.js";

/**
 * The Record button was wrong twice while it lived inside `main.ts`, where nothing could
 * reach it, and both bugs were in the window between the click and the file being in hand.
 * These tests exist to hold that window open and look at it.
 */
class FakeMediaRecorder {
  static supported = true;
  static last: FakeMediaRecorder | null = null;
  /** Set to make stop() fail the way a stream ending under the recorder would. */
  static failOnStop = false;

  static isTypeSupported(): boolean {
    return FakeMediaRecorder.supported;
  }

  state = "inactive";
  readonly mimeType = "video/webm;codecs=vp9";
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;

  constructor() {
    FakeMediaRecorder.last = this;
  }

  start(): void {
    this.state = "recording";
  }

  stop(): void {
    // Synchronously, as the real API does when the recorder is no longer in a state it can
    // stop from - which is what rejects the promise CanvasRecorder is waiting on.
    if (FakeMediaRecorder.failOnStop)
      throw new DOMException("the stream ended", "InvalidStateError");

    this.state = "inactive";
    setTimeout(() => {
      this.ondataavailable?.({ data: new Blob(["video"]) });
      this.onstop?.();
    }, 0);
  }
}

function fakeButton(): HTMLButtonElement {
  const classes = new Set<string>();
  return {
    textContent: "Record",
    title: "",
    disabled: false,
    classList: {
      add: (c: string) => classes.add(c),
      remove: (c: string) => classes.delete(c),
      contains: (c: string) => classes.has(c),
    },
    addEventListener: (_: string, handler: () => void) => {
      clicks.push(handler);
    },
  } as unknown as HTMLButtonElement;
}

let clicks: (() => void)[] = [];
let downloads: boolean[] = [];

/** What the user does. A disabled button does not raise a click event at all. */
function press(button: HTMLButtonElement): void {
  if (button.disabled) return;
  clicks[0]?.();
}

function playback(): RecordablePlayback & { seeks: number[]; paused: number; played: number } {
  const seeks: number[] = [];
  const state = { seeks, paused: 0, played: 0 };
  return {
    ...state,
    startSeconds: 0,
    seek: (epochSeconds: number) => seeks.push(epochSeconds),
    play: () => {
      state.played += 1;
    },
    pause: () => {
      state.paused += 1;
    },
    get played(): number {
      return state.played;
    },
    get paused(): number {
      return state.paused;
    },
  };
}

function wire(): { button: HTMLButtonElement; replay: ReturnType<typeof playback> } {
  const button = fakeButton();
  const replay = playback();
  const parts: RecordingButtonParts = {
    button,
    canvas: { captureStream: () => ({}) } as unknown as HTMLCanvasElement,
    replay,
    filename: "suo-nada",
    onStart: vi.fn(),
  };
  wireRecordingButton(parts);
  return { button, replay };
}

/** Let the queued stop task and the promise chain behind it run to the end. */
async function settle(): Promise<void> {
  await vi.advanceTimersByTimeAsync(1);
  await Promise.resolve();
}

beforeEach(() => {
  clicks = [];
  downloads = [];
  FakeMediaRecorder.supported = true;
  FakeMediaRecorder.failOnStop = false;
  FakeMediaRecorder.last = null;
  vi.stubGlobal("MediaRecorder", FakeMediaRecorder);
  vi.stubGlobal("document", {
    createElement: () => ({ href: "", download: "", click: () => downloads.push(true) }),
  });
  vi.stubGlobal("URL", { createObjectURL: () => "blob:x", revokeObjectURL: () => undefined });
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("a browser that cannot record", () => {
  it("says so on the button rather than offering a control that throws", () => {
    FakeMediaRecorder.supported = false;
    const { button } = wire();

    expect(button.disabled).toBe(true);
    expect(button.title).toContain("cannot record");
    expect(clicks, "nothing is wired up at all").toHaveLength(0);
  });
});

describe("starting", () => {
  it("rewinds before it records, so the file starts at the beginning", () => {
    const { button, replay } = wire();
    press(button);

    expect(replay.seeks).toEqual([0]);
    expect(replay.played).toBe(1);
    expect(button.textContent).toBe("Stop");
    expect(button.classList.contains("recording")).toBe(true);
  });
});

describe("stopping", () => {
  it("pauses at once and offers the file when it arrives", async () => {
    const { button, replay } = wire();
    press(button);
    press(button);

    expect(replay.paused).toBe(1);
    expect(downloads, "nothing to hand over yet").toHaveLength(0);

    await settle();
    expect(downloads, "the file is offered once the browser hands it over").toHaveLength(1);
    expect(button.textContent).toBe("Record");
    expect(button.classList.contains("recording")).toBe(false);
    expect(button.disabled).toBe(false);
  });

  /**
   * The window this module exists for. `stop()` returns before the browser has handed the
   * video over, and the button used to stay live for that gap: a second press started a
   * fresh recording, the first one's callback then put the button back to "Record", and
   * the page sat there claiming not to be recording while it recorded. The next press
   * stopped what the user had meant to start.
   */
  it("cannot be pressed again while the recording is still being assembled", async () => {
    const { button } = wire();
    press(button);
    press(button);

    expect(button.disabled, "out of action until the file is in hand").toBe(true);
    press(button);
    expect(button.textContent, "and the second press did nothing").toBe("Stop");

    await settle();
    expect(button.disabled).toBe(false);
    expect(button.textContent).toBe("Record");
  });

  it("can record again once the first file is in hand", async () => {
    const { button, replay } = wire();
    press(button);
    press(button);
    await settle();

    press(button);
    expect(button.textContent).toBe("Stop");
    expect(replay.played).toBe(2);
  });
});

describe("when the recording fails", () => {
  /**
   * A stream can end under the recorder, and a download can be refused. Releasing the
   * button only on the way through the success path leaves it disabled and reading "Stop"
   * for good - a page that has to be reloaded before it can record anything again.
   */
  it("gives the button back rather than leaving the page stuck", async () => {
    FakeMediaRecorder.failOnStop = true;
    const { button } = wire();
    press(button);
    press(button);

    await settle();
    expect(button.disabled, "released even though the recording was lost").toBe(false);
    expect(button.textContent).toBe("Record");
    expect(button.classList.contains("recording")).toBe(false);
  });

  it("says why, where the user is looking", async () => {
    FakeMediaRecorder.failOnStop = true;
    const { button } = wire();
    press(button);
    press(button);

    await settle();
    expect(button.title).toContain("failed");
  });

  // The other end of the same window: the video arrives, and handing it to the browser as
  // a download is what fails. The button has to come back from that too.
  it("gives the button back when the download itself is refused", async () => {
    vi.stubGlobal("URL", {
      createObjectURL: () => {
        throw new Error("refused");
      },
      revokeObjectURL: () => undefined,
    });
    const { button } = wire();
    press(button);
    press(button);

    await settle();
    expect(button.disabled).toBe(false);
    expect(button.title).toContain("failed");
  });

  it("clears a stale failure once a recording succeeds", async () => {
    const { button } = wire();
    button.title = "the recording failed: something";
    press(button);
    press(button);

    await settle();
    expect(button.title).toBe("");
  });
});
