# LayahTools Development Log

Running log of state, decisions and open issues. Architecture lives in `LAYAH_ARCHITECTURE.md`; rules for agents in
`CLAUDE.md` (project-wide rules are in the repository-root `CLAUDE.md`).

**Local-only planning documents.** The founder keeps seven planning files at the git root:
`1_LayahTools_PDF_Workspace_Checklist.md`, `2_Beta_Plan_ClaudeCode.md`, `3_Alpha_Plan_Antigravity.md`,
`LayahTools_Development_Phases.md`, `LayahTools_Master_Context.md`, `LayahTools_Project_Handover.md` and `.docx`.
They are **untracked and not in the repository**; a clone will not have them. This log cites their item IDs (A-1.1,
P0-P2, "checklist 2.1") only as references to those local files.

## Phase 0 (audit and baseline) - current state

| | |
|---|---|
| Baseline commit | `2fc52704f8f5042f990d1ed9dc7173f9fa975fa0` (merge of `44b5991` + `70c2210`) |
| Tags | `baseline-phase0-2fc5270` (new, annotated); `known-good-pre-integration` (untouched, same commit) |
| Branches | `main` (stable baseline, unchanged, `origin/main`); `develop` (created from `2fc5270`) |
| `npm test` | 98 PASS, 0 FAIL (15 file-collection + 83 editor-session) |
| `npm run build` | exit 0, compiled, TypeScript clean, 4 static routes, no warnings printed |
| Not run | `npm run lint` (legacy backlog), older diagnostic scripts, any physical mouse/trackpad test |

## Decisions

| ID | Decision | Status |
|---|---|---|
| D-01 | Create `develop` from `2fc5270`; keep `main` stable; no history rewrite | Done |
| D-02 | Annotated tag `baseline-phase0-2fc5270`; leave `known-good-pre-integration` | Done |
| D-03 | Write `CLAUDE.md`, update `LAYAH_ARCHITECTURE.md` (6px threshold, CDN deps, Alpha/Beta, links, limitations) | Done (this commit) |
| D-04 | Hide the 8 cosmetic handles now; defer nudge/history coalescing to P2 with local drag preview; no P2 before P1 acceptance | Handles removed; coalescing deferred |
| D-05 | Investigate lockfile and `MEMORY.md` before acting | Investigated; resolved in housekeeping (D-06, D-07) |
| D-06 | Keep the npm 11.13.0 lockfile; pin `packageManager: npm@11.13.0`; no dependency changes | Done (housekeeping commit) |
| D-07 | `MEMORY.md` is private agent memory: untrack (`git rm --cached`), keep file locally, keep ignore rule | Done (housekeeping commit) |
| D-08 | Planning files stay untracked and untouched; docs state they are local-only | Done (housekeeping commit) |
| D-09 | Primary `CLAUDE.md` moved to the git root; app-specific notes stay in `pdf-tool-app/CLAUDE.md` | Done (housekeeping commit) |
| D-10 | A-1.1 FILES reorder stays OPEN pending a human mouse test; no speculative fix | Open |

## D-04: handles removed
`SelectionOverlay.tsx` no longer renders the 8 corner/mid-side boxes (they were `pointer-events-none`) nor the
`CornerHandle` component. Nothing else used them. Verified in the browser (scripted pointer events): a click still
selects (1 selection box, Delete enabled) and zero handle elements exist. Moving, the drag ghost/badge, marquee and
keyboard code were not touched. `tsc` clean.

## D-05 findings

### package-lock.json
- Founder's npm is `11.13.0` (Node `v24.16.0`). Lockfiles at `d7c92df` and `44b5991` (written by this npm) contain 38
  `"libc"` entries; the teammate's `70c2210` lockfile contains 0. Both are `lockfileVersion: 3`. So an older npm on the
  teammate's machine rewrote the lockfile and dropped the `libc: glibc|musl` hints on the optional `sharp`/libvips
  binaries (all removed lines are exactly those hints; no version or integrity changes).
- Deployment implication: `libc` lets npm skip optional native packages built for the wrong C library on Linux
  (glibc vs musl). Without it, a Linux/musl install may fetch binaries it can't use. It does not change resolved
  versions. Nothing in the repo pins a deploy platform, Node or npm (no `engines`, `packageManager`, `.nvmrc`,
  netlify/vercel config), so the effect is currently theoretical.
- Check: `npm install --package-lock-only --dry-run` with npm 11.13.0 reports "up to date" and left the file untouched,
  so the current lockfile is valid for installs; it just isn't what npm 11 would write.
- **Decision (D-06): keep the current lockfile, do not restore `44b5991`.** `packageManager: "npm@11.13.0"` added to
  `package.json`; no dependency versions changed. Verification after the change: `npm ci --dry-run` and
  `npm install --package-lock-only --dry-run` both report up to date, and `package-lock.json` is byte-identical
  (md5 `2b0f1485e1847ad049cbe550d7e5551e` before and after). A full clean `npm ci` into an empty folder was not run.
  Note: the lockfile still lacks the `libc` hints, so teammates should install with npm 11.13.0 to avoid churn.

### MEMORY.md
- Added to the repo root by teammate `aravindh13` in `44b5991` ("phase 7 completed"); 196 lines, titled "System Memory
  & Knowledge Base ... Single Source of Truth". The merge also added `MEMORY.md` and `.agent-memory/` to both
  `.gitignore` files under "# Agent Memory", so the intent appears to be private AI-agent working notes. But the file is
  already tracked, so the ignore has no effect, and the file contains the teammate's absolute local paths
  (`c:/Users/Lenovo/Downloads/...`).
- Content overlaps the architecture docs and records Phase 7 as done, including "File drag-to-reorder" (see A-1.1 below).
- **Decision (D-07): private agent memory.** Removed from the index with `git rm --cached MEMORY.md`; the local file is
  intact (md5 `4d28b38d9bebbf75e7dfd466d5343800` before and after) and `git check-ignore` confirms both `.gitignore`
  rules match it. It remains in git history at `44b5991`/`2fc5270` (history not rewritten), so its contents, including
  the teammate's local paths, are still visible in old commits. Treat its claims (e.g. "reorder implemented") as unverified.

## A-1.1 (FILES reorder): NOT accepted
Verified, not assumed. Environment: dev server at `develop`, three PDFs loaded in Merge.
1. **Pure logic / state:** dispatching `dragstart`/`dragenter`/`dragover`/`drop`/`dragend` programmatically on the cards
   reordered `A,B,C` to `C,A,B`. Cards are `draggable=true`.
2. **Merge consumes order:** running the app's `mergePdfFiles` on `A,B,C` gives first page 612x792; after the same
   `reorderFiles` call the UI makes, `C,A,B` gives first page 1440x810 (C's size) and output named `C-merged.pdf`.
   Visible order = merge order at the logic level.
3. **Real mouse drag: not demonstrable here.** The browser tool's native drag fired `dragstart` on the card,
   `dragenter` on the target, then `dragend` ~20 ms later with no drop. A bare draggable/dropzone probe I added to the
   page behaved identically (`dragstart`, `dragend`, no `drop`), so this is a tool limitation, not proof the app works.
   The founder's own report (could not reorder with a real mouse) stands. Treat as **open**.
4. Suspected cause (hypothesis, untested): `onDragStart` sets `effectAllowed` but never `dataTransfer.setData(...)`;
   Firefox does not start a drag without it. Which browser the founder used is unknown.
5. Gaps against the Alpha spec A-1.1: no unit tests for `reorderFiles`; no up/down buttons (keyboard access); no
   visible order numbers (checklist 2.1).
6. Related defect: the Merge note "File order determines merge order" never renders (Configuration section is hidden
   for merge), so users get no hint at all.

## Phase 0 findings triage (status after this commit)

| # | Finding | Status |
|---|---|---|
| 1 | Merge-order note unreachable (`Workspace.tsx:576`) | Open (Alpha, P1) |
| 2 | 8 non-functional resize handles | **Fixed** (removed) |
| 3 | Arrow-nudge = full mutation + snapshot per keypress | Deferred to P2 (D-04) |
| 4 | Lockfile lost `libc` hints | Kept; npm pinned to 11.13.0 (D-06) |
| 5 | `MEMORY.md` tracked and ignored | Untracked, kept locally (D-07) |
| 5b | `pdf-tool-app/.next-build/` had 109 tracked build-output files (stale `distDir`) | **Fixed**: untracked, gitignored, local files kept |
| 6 | No tests for Phase 7 code (`reorderFiles`, overlay, shortcuts) | Open |
| 7 | Ctrl+A always prevents default; selects nothing before a page is clicked | Open (P2) |
| 8 | Keydown listener re-registered every render (`run` identity) | Open, minor |
| 9 | Escape-during-drag edge case unverified | Open, unverified |
| 10 | PDF to Word/Excel are stubs that throw after a fake delay | Open (hide or label "Coming soon", Alpha P1 audit) |
| 11 | `CommandBar` inert; header "Sign In" link is `href="#"` | Open (checklist 2.1) |
| 12 | PDF.js worker (6 sites) and Tesseract load from CDNs | Documented; open |
| 13 | Reconciliation/validation modules unused by the live session | Documented; open |
| 14 | `@embedpdf/pdfium` uses a floating range `^2.15.0`; PDFium license attribution not shipped | Open |

## Unresolved / needs a human
1. Physical mouse/trackpad acceptance test of the editor and FILES reorder (checklist P0), in the browser the founder used.
2. A-1.1 FILES reorder: needs a human mouse test (and a decision on browser support) before it can be closed.
3. Scanned and password-protected PDFs still unvalidated end to end.
4. `npm run lint` not run in this phase.

## Next gate
P1 (Workspace stability, checklist 2.1) is **not started**. P2 does not begin until P1 acceptance.

## Changed in the Phase 0 documentation commit (`3b1ba16`)
`CLAUDE.md` (rewritten), `LAYAH_ARCHITECTURE.md` (updated), `DEVELOPMENT_LOG.md` (new),
`src/components/pdf/interactive/SelectionOverlay.tsx` (handles removed). Untracked root files left untouched.

## Changed in the Phase 0 housekeeping commit
- `package.json`: added `"packageManager": "npm@11.13.0"` (no dependency changes; `package-lock.json` unchanged).
- `MEMORY.md`: removed from the index only (local file preserved, still ignored).
- `CLAUDE.md` (git root, new): project-wide rules. `pdf-tool-app/CLAUDE.md`: reduced to app-specific notes.
- `LAYAH_ARCHITECTURE.md`, `DEVELOPMENT_LOG.md`: planning documents now stated as local-only and untracked; decisions
  D-06 to D-10 recorded.
- The seven untracked planning files were not touched (checksums verified before and after).

## B-1.1: non-editing interactions never mutate the PDF

Three statuses, kept separate.

| Status | State |
|---|---|
| **Implementation** | Done on `develop` (commit recorded below) |
| **Automated test coverage** | 62 new checks, `npm test` 160/160 PASS; build passes |
| **Human acceptance** | **Not done.** No physical mouse/trackpad test; real touch/pen cancel never exercised |

**Seam.** New pure module `src/lib/document/gestures.ts` (no React/DOM/session). `EditorController`'s page overlay now only
translates events into `gestureDown/Move/Up/Cancel` and `selectAllOnPage`; hit-testing candidates and the marquee code moved
there unchanged. The seam reads the state machine (not React props) to decide whether a gesture is in flight.

**Bug fixed: cancel committed the drag.** `onPointerCancel` was `onPointerUp`, so a cancelled drag emitted a move intent
and mutated the document. Now `onPointerCancel` and a new `onLostPointerCapture` call `gestureCancel` (returns `void`, so it
cannot yield an intent). Selection made by the press is kept; the machine returns to idle; the next gesture works (tested).
`lostpointercapture` also fires after every normal release, where it is a no-op (tested).

**No-op drags.** After crossing the threshold, a drag released within `NOOP_MOVE_TOLERANCE_PX = 0.25` CSS px of its start
produces no intent. Chosen as the largest value below any pointer's granularity (device pixel = 0.33 CSS px at 3x DPR), so
it cannot swallow a deliberate move; a 1 px net move still commits (tested). Threshold unchanged at 6 px.

**Tests (`scripts/test-no-mutation.ts`, `scripts/lib/mutation-probe.ts`).** Counters: engine mutators (7), `export`, `load`,
raw PDFium calls (GenerateContent, Transform, RemoveObject, InsertObject, SetText, SaveAsCopy, LoadMemDocument,
CloseDocument), `generation`, history past/future, byte identity. All must be unchanged for: press/release, shift-click,
empty click, hover, run/block/image selection, select-all, clear, marquee and sub-4pt marquee, sub-threshold jitter at
50/100/150/200% (6 directions x 5 sub-pixel offsets, below 5.99/5.94 px), pointercancel, lostpointercapture (drag and
marquee), Escape mid-drag, return-to-origin, zoom changes, page switch. Above threshold (6.01/6.02 px) at all zooms a move
intent with the exact pixel travel is produced. Exactly 6.00 px is deliberately not asserted (float-dependent at 150%).
**Positive controls (observed):** a drag-move of a 2-object run gives `moveObject` +2, `transformObject` +2,
`export` +1, `load` +1, generation +1, history +1, bytes replaced; nudge identical; delete `deleteObject` +4 (one run's
sources), export/load +1; undo `load` +1, `export` 0, history -1 / redo +1. **Controlled violations:** (a) the legacy
"cancel commits" flow and (b) a mutation hidden in a selection are both reported by the probe. Mutating the production
seam also fails the suite: threshold 6 -> 3 gives 16 FAIL; tolerance 0.25 -> 0 gives 1 FAIL (file restored byte-identical).

**Browser check (scripted pointer events, dev server).** On `double coloumn sample.pdf`: pointercancel and
lostpointercapture mid-drag removed the drag ghost and left Undo disabled (no history), the next click selected normally, a
4 px jitter click made no history, and a real drag enabled Undo and kept 3 visible canvases. Scripted events only.

**Remaining limitations / not verified.**
- React event wiring (which event reaches which handler) has no automated test; only the scripted-event browser check above.
- `PdfViewer` zoom/page-navigation state is checked structurally (no session/engine reference) and not executed.
- Real mouse/trackpad, touch and pen behaviour (including true `pointercancel` sources) untested by a human.
- Probe reads TypeScript-private fields (`engine`, `past`, `future`); it throws if they are renamed, but it is coupled to them.
- Arrow-key nudge still makes one full mutation + snapshot per keypress (P2, untouched). Marquee threshold is still 4 PDF
  points, not screen pixels (pre-existing). Escape clears selection via `machine.reset()` in the controller (not in the seam).
- A-1.1 FILES reorder remains OPEN (untouched).
