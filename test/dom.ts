/**
 * Browser stand-ins, for the one place this project draws with something other than WebGL.
 *
 * The attribution overlay rasterises a line of text through a 2D canvas, so it is the only
 * module here that asks the document for anything. Everything it then does with the result
 * is arithmetic - how wide the caption is, where in the frame it goes - and that is what
 * these let a test reach without a browser.
 */

/**
 * A canvas that measures text and remembers nothing else.
 *
 * Eight pixels per character is not any real font. It is a rule simple enough that the
 * expected size of a caption can be worked out by whoever is reading the test.
 */
export function fakeCanvas(withContext = true): HTMLCanvasElement {
  const context = {
    font: "",
    fillStyle: "",
    textBaseline: "",
    measureText: (text: string) => ({ width: text.length * 8 }),
    clearRect: () => undefined,
    fillRect: () => undefined,
    fillText: () => undefined,
    // The real one is reachable from its context, and the overlay uses that rather than
    // holding the canvas twice - so the stand-in has to close the loop the same way.
    canvas: null as unknown as HTMLCanvasElement,
  };
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => (withContext ? context : null),
  };
  context.canvas = canvas as unknown as HTMLCanvasElement;
  return canvas as unknown as HTMLCanvasElement;
}

/** A `document` with nothing on it but the ability to make the canvas above. */
export function fakeDocument(withContext = true): { createElement: () => HTMLCanvasElement } {
  return { createElement: () => fakeCanvas(withContext) };
}
