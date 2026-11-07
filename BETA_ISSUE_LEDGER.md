# BETA_ISSUE_LEDGER

Central ledger of Beta-lane issues. One row per issue: search before adding, update the existing row instead of duplicating.
IDs are `BL-nnn`, never reused. Priority: **P0** blocks the sub-phase (fix now), **P1** real defect with downstream
dependency, **P2** minor. Status: `open`, `in-progress`, `fixed`, `wontfix`. Maintained via `/beta-phase`.

| ID | Sub-phase | Issue | Evidence | Priority | Downstream dependency | Status | Resolution |
|---|---|---|---|---|---|---|---|
| BL-001 | B-1.2 | `EditorSession.dispose()` is not terminal: `undo()` after dispose reloads a PDFium document nobody frees | DEVELOPMENT_LOG B-1.2 inspection, probe 13 | P1 | B-1.2 contract (lifecycle) | fixed | Terminal dispose, DISPOSED rejection, in-flight result discarded (B-1.2); contract tests |
| BL-002 | B-1.2 | `store` is publicly mutable; stale ids can resolve to a different object and `move()` acts on it silently | B-1.2 probes 9, E1/E2 | P1 | B-1.2 contract (revision-stamped ids, frozen model) | fixed | `store` internal, frozen `getPage()`, generation-stamped ids with STALE_ID (B-1.2); contract tests |
| BL-003 | B-1.2 | `undo`/`redo` change stacks before reload and are not atomic if reload fails; rollback-reload failure has no defined state | Code reading only, not exercised | P1 | B-1.2 contract (transactions, `faulted` status) | fixed | Atomic undo/redo, rollback, `faulted` status (B-1.2); fault-injection tests |
| BL-004 | P2 | Arrow-key nudge creates one history entry per keypress (no coalescing) | B-1.1 decision D-04 | P2 | P2 phase | open | Deferred by founder decision |
| BL-005 | B-1.2 | Reentrancy guard only detects calls made synchronously inside an engine call; a call after an `await` inside an engine method would deadlock the queue | Code comment in `session.ts` (shortcut); no real engine calls back | P2 | None (engines are internal; doubles must not call back) | open | Accepted limit; revisit if third-party engines are injected |
| BL-006 | B-1.2 | `EditorController` changed (`pageOf`, `open` transfer, read-only pages) but not exercised in a browser or with a real mouse | tsc clean, session/gesture suites pass; no browser run | P1 | Human acceptance of the editor interaction layer (with B-1.1) | open | Needs a human pass: open PDF, select, drag, edit text, undo/redo, download |
| BL-007 | B-1.2 | New contract tests not mutation-tested (no deliberately broken session to prove they fail) | Two guards broken on purpose in B-1.2: suite failed each time | P2 | None | open | Partially addressed; exhaustive mutation testing optional later |
| BL-008 | B-1.2 | `pdf-tool-app/CLAUDE.md` still says `npm test` is 160 checks (now 259) and does not list the contract suite | npm test output | P2 | None | open | Docs outside this sub-phase's allowed edits; update in the next docs pass |
