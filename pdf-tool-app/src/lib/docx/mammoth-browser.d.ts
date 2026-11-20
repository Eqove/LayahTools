/**
 * Minimal declarations for Mammoth's prebuilt browser bundle.
 *
 * The `mammoth` package (1.13.0) ships no `.d.ts` and no `exports` map, and adding
 * `@types/mammoth` would introduce a dependency. Only the surface used by
 * `extract-text.ts` is declared here.
 */
declare module "mammoth/mammoth.browser.js" {
  export interface MammothMessage {
    type: "warning" | "error" | string;
    message: string;
  }

  export interface MammothResult {
    value: string;
    messages: MammothMessage[];
  }

  /** The browser bundle accepts `{ arrayBuffer }` only; `{ buffer }` and `{ path }` are rejected. */
  export interface MammothInput {
    arrayBuffer: ArrayBuffer;
  }

  export interface MammothBrowser {
    extractRawText(input: MammothInput): Promise<MammothResult>;
  }

  const mammoth: MammothBrowser;
  export default mammoth;
}
