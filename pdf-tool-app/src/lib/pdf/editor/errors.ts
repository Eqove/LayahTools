/** Stable, public error codes of `EditorSession`. The UI may switch on these; never rename or reuse one. */
export type EditorErrorCode =
  | "ALREADY_OPEN" | "NOT_OPEN" | "DISPOSED" | "SESSION_FAULTED"
  | "PASSWORD_REQUIRED" | "OPEN_FAILED"
  | "INVALID_ARGUMENT" | "STALE_ID" | "NOTHING_TO_DO" | "UNEDITABLE_PAGE"
  | "FONT_COVERAGE" | "ENGINE_FAILURE" | "ROLLBACK_FAILED" | "REENTRANT_CALL";

export class EditorSessionError extends Error {
  readonly code: EditorErrorCode;
  readonly cause?: unknown;
  readonly details?: Record<string, unknown>;
  constructor(code: EditorErrorCode, message: string, opts: { cause?: unknown; details?: Record<string, unknown> } = {}) {
    super(message);
    this.name = "EditorSessionError";
    this.code = code;
    if (opts.cause !== undefined) this.cause = opts.cause;
    this.details = opts.details;
  }
}

/** Thrown (after rolling back) when the original font lacks glyphs for some of the new text. */
export class FontCoverageError extends EditorSessionError {
  constructor(public fontName: string | undefined, public missing: string[]) {
    super("FONT_COVERAGE", `The original font${fontName ? ` (${fontName.replace(/^[A-Z]{6}\+/, "")})` : ""} doesn't contain: ${missing.join(" ") || "some of these characters"}.`, { details: { fontName, missing } });
    this.name = "FontCoverageError";
  }
}

/** Typed failure of `EditorEngine.load`, so the session need not match message text. */
export class EngineError extends Error {
  constructor(public kind: "password" | "format" | "internal", message: string) {
    super(message);
    this.name = "EngineError";
  }
}
