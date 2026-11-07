# LayahTools Development Log

Running log of state, decisions and open issues. Architecture lives in `LAYAH_ARCHITECTURE.md`; rules for agents in
`CLAUDE.md`. Planning documents (repo root, currently untracked): `../1_LayahTools_PDF_Workspace_Checklist.md`,
`../2_Beta_Plan_ClaudeCode.md`, `../3_Alpha_Plan_Antigravity.md`, `../LayahTools_Development_Phases.md`.

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
| D-05 | Investigate lockfile and `MEMORY.md` before acting | Investigated; **decision needed** (below) |

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
- **Not reverted.** Options: (a) restore the npm-11 lockfile from `44b5991` and agree one npm version for the team,
  (b) keep as is. Recommendation: (a) plus a `packageManager`/`engines` pin, as one deliberate commit.

### MEMORY.md
- Added to the repo root by teammate `aravindh13` in `44b5991` ("phase 7 completed"); 196 lines, titled "System Memory
  & Knowledge Base ... Single Source of Truth". The merge also added `MEMORY.md` and `.agent-memory/` to both
  `.gitignore` files under "# Agent Memory", so the intent appears to be private AI-agent working notes. But the file is
  already tracked, so the ignore has no effect, and the file contains the teammate's absolute local paths
  (`c:/Users/Lenovo/Downloads/...`).
- Content overlaps the architecture docs and records Phase 7 as done, including "File drag-to-reorder" (see A-1.1 below).
- **Left untouched** (not deleted, not untracked). **Decision needed from founder/teammate:** shared project context
  (then commit it intentionally, remove the ignore entry, strip local paths) or private working context (then
  `git rm --cached MEMORY.md`, keep the ignore).

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
| 4 | Lockfile lost `libc` hints | Investigated; decision pending (D-05) |
| 5 | `MEMORY.md` tracked and ignored | Investigated; decision pending (D-05) |
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
2. D-05 lockfile: restore from `44b5991` + pin npm, or keep?
3. D-05 `MEMORY.md`: shared or private?
4. Planning files at repo root are untracked: commit them, or keep local? Docs link to them.
5. Scanned and password-protected PDFs still unvalidated end to end.
6. `npm run lint` not run in this phase.

## Next gate
P1 (Workspace stability, checklist 2.1) is **not started**. P2 does not begin until P1 acceptance.

## Changed in the Phase 0 documentation commit
`CLAUDE.md` (rewritten), `LAYAH_ARCHITECTURE.md` (updated), `DEVELOPMENT_LOG.md` (new),
`src/components/pdf/interactive/SelectionOverlay.tsx` (handles removed). Untracked root files left untouched.
