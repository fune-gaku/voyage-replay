import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  fileNameFor,
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
  /** Set to accept stop() and then never raise the event that says it finished. */
  static neverFinishes = false;

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
    if (FakeMediaRecorder.neverFinishes) return;
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

function wire(
  canvas: HTMLCanvasElement = { captureStream: () => ({}) } as unknown as HTMLCanvasElement,
  onStart: () => void = vi.fn(),
): { button: HTMLButtonElement; replay: ReturnType<typeof playback> } {
  const button = fakeButton();
  const replay = playback();
  const parts: RecordingButtonParts = {
    button,
    canvas,
    replay,
    title: "Suo-nada collision, 27 November 2025",
    onStart,
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
  FakeMediaRecorder.neverFinishes = false;
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

describe("when the browser will not let it start at all", () => {
  /**
   * `isRecordingSupported` only asks whether an encoding exists; it cannot ask whether
   * this particular canvas may be captured. So starting can still be refused, and an
   * exception thrown out of a click handler leaves the page looking like the press did
   * nothing at all.
   */
  it("leaves a button that can be pressed again, and says why", () => {
    const refusing = {
      captureStream: () => {
        throw new DOMException("tainted", "SecurityError");
      },
    } as unknown as HTMLCanvasElement;
    const { button } = wire(refusing);

    expect(() => {
      press(button);
    }).not.toThrow();
    expect(button.textContent, "still offering to record").toBe("Record");
    expect(button.classList.contains("recording")).toBe(false);
    expect(button.disabled).toBe(false);
    expect(button.title).toContain("could not start");
  });
});

describe("when the browser accepts the stop and then never finishes it", () => {
  /**
   * Nothing but the browser's `stop` event resolves the wait, so a browser that takes the
   * call and never raises it would leave the page disabled and reading "Stop" with no way
   * back short of a reload. Losing the recording is bad; losing the page is worse.
   */
  it("gives up after a deadline rather than holding the button for good", async () => {
    FakeMediaRecorder.neverFinishes = true;
    const { button } = wire();
    press(button);
    press(button);
    expect(button.disabled).toBe(true);

    await vi.advanceTimersByTimeAsync(11_000);
    expect(button.disabled, "released once the deadline passed").toBe(false);
    expect(button.textContent).toBe("Record");
    expect(button.title).toContain("failed");
  });
});

describe("when something fails after the recorder is already running", () => {
  const workingCanvas = (): HTMLCanvasElement =>
    ({ captureStream: () => ({}) }) as unknown as HTMLCanvasElement;

  /**
   * The catch has to put the recorder back, not merely report that it could not be
   * started. `recorder.start()` has already succeeded by this point, so a button left
   * reading "Record" over a running recorder sends the next press into the stop branch -
   * and someone who meant to begin a recording is handed the previous one instead.
   */
  it("stops the recording it had already begun, so the next press starts a new one", () => {
    let attempts = 0;
    const failsAfterStart = (): void => {
      attempts += 1;
      if (attempts === 1) throw new Error("no frames");
    };
    const { button, replay } = wire(workingCanvas(), failsAfterStart);

    press(button);
    expect(button.textContent, "the page is not recording").toBe("Record");
    expect(button.title).toContain("could not start");
    expect(replay.paused, "and playback was put back too").toBe(1);

    press(button);
    expect(button.textContent, "the next press begins a recording rather than ending one").toBe(
      "Stop",
    );
  });
});

describe("when even the rollback fails", () => {
  // The recording is unrecoverable either way; the button is not, and it is the button the
  // user is left holding.
  it("still leaves a button that can start a new recording", () => {
    FakeMediaRecorder.failOnStop = true;
    const { button } = wire({ captureStream: () => ({}) } as unknown as HTMLCanvasElement, () => {
      throw new Error("no frames");
    });

    expect(() => {
      press(button);
    }).not.toThrow();
    expect(button.textContent).toBe("Record");
    expect(button.disabled).toBe(false);
  });
});

describe("fileNameFor", () => {
  it("turns a title into something a filesystem will take", () => {
    expect(fileNameFor("Suo-nada collision, 27 November 2025")).toBe(
      "suo-nada-collision-27-november-2025",
    );
  });

  /**
   * Most of the reports this tool reads are typeset in Japanese, and a title with no ASCII
   * letters in it reduces to an empty string. A download named "" is one the browser
   * quietly refuses, so there has to be something left.
   */
  it("still names the file when the title has nothing ASCII in it", () => {
    expect(fileNameFor("周防灘における衝突")).toBe("voyage-replay");
  });

  it("leaves no separator dangling at either end", () => {
    expect(fileNameFor("  (2025) collision!  ")).toBe("2025-collision");
  });
});
