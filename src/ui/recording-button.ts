/**
 * The Record button, and the small state machine behind it.
 *
 * This lives in its own module for one reason: it is asynchronous, it has failure paths,
 * and it was wrong twice while it sat inside `main.ts` where nothing could reach it. Both
 * bugs were of the same kind - a window between the click and the file being in hand, in
 * which the button said something that was no longer true. Reasoning about that window and
 * reading the code back is not a standard this project accepts anywhere else, so the code
 * moved to where a test can hold it instead.
 *
 * Nothing here looks anything up in the document. Every element it touches is handed to it,
 * which is the whole of what makes it testable.
 */

import { CanvasRecorder, downloadRecording, isRecordingSupported } from "../render/record.js";

/** The part of the Replay this button drives. Narrow on purpose - it is all that is used. */
export interface RecordablePlayback {
  readonly startSeconds: number;
  seek(epochSeconds: number): void;
  play(): void;
  pause(): void;
}

export interface RecordingButtonParts {
  button: HTMLButtonElement;
  canvas: HTMLCanvasElement;
  replay: RecordablePlayback;
  /** Names the downloaded file. */
  filename: string;
  /** Called when a recording starts, so the clock keeps up with playback. */
  onStart: () => void;
}

export function wireRecordingButton(parts: RecordingButtonParts): void {
  const { button, canvas } = parts;
  if (!isRecordingSupported()) {
    button.disabled = true;
    button.title = "this browser cannot record the canvas";
    return;
  }

  const recorder = new CanvasRecorder(canvas);
  button.addEventListener("click", () => {
    if (recorder.isRecording) stop(recorder, parts);
    else start(recorder, parts);
  });
}

/**
 * Rewind first: a recording that starts halfway through is not what anyone wants, and
 * remembering to scrub back every time is exactly the kind of step people skip.
 */
function start(recorder: CanvasRecorder, parts: RecordingButtonParts): void {
  const { button, replay, onStart } = parts;

  try {
    // Starting can be refused outright - a canvas the browser will not let anyone capture,
    // an encoder that turns out to be unavailable after all. Nothing is running yet, so
    // saying so is the whole of what is needed.
    replay.seek(replay.startSeconds);
    recorder.start();
  } catch (error) {
    refuse(button, error);
    return;
  }

  try {
    replay.play();
    onStart();
  } catch (error) {
    // Past `recorder.start()` the recorder IS running, so a failure here has to put it
    // back rather than only report it. A button reading "Record" over a recorder that is
    // recording sends the next press into the stop branch: someone who meant to begin a
    // recording is handed the previous one instead.
    void recorder.stop().catch(() => undefined);
    replay.pause();
    refuse(button, error);
    return;
  }

  button.title = "";
  button.textContent = "Stop";
  button.classList.add("recording");
}

/** Leave it a button that says "Record" and can be pressed again, with the reason on it. */
function refuse(button: HTMLButtonElement, error: unknown): void {
  button.title = `the recording could not start: ${String(error)}`;
}

/**
 * Out of action until the file is in hand, which is not the same instant as the click.
 *
 * The browser hands the video over in an event raised after `stop()` returns, so there is
 * a window where the recording is being assembled and the button is still live. Left
 * enabled it reads "Stop" for all of it, and a second press starts a fresh recording that
 * this one then reports over the top of - leaving the page saying "Record" while it
 * records, so the next press stops what the user meant to start. Disabling closes the
 * window rather than working out afterwards which recording a callback belonged to.
 *
 * Which makes releasing it again the thing that must not be conditional. A recording can
 * fail - the stream can end under it, the download can be refused - and a button left
 * disabled and reading "Stop" is a page that has to be reloaded to record anything again.
 * So the release runs whatever happened, and the reason goes on the button rather than
 * only into a console.
 */
function stop(recorder: CanvasRecorder, parts: RecordingButtonParts): void {
  const { button, replay, filename } = parts;
  button.disabled = true;
  replay.pause();

  void recorder
    .stop()
    .then((recording) => {
      downloadRecording(recording, filename);
      button.title = "";
    })
    .catch((error: unknown) => {
      button.title = `the recording failed: ${String(error)}`;
    })
    .finally(() => {
      button.textContent = "Record";
      button.classList.remove("recording");
      button.disabled = false;
    });
}
