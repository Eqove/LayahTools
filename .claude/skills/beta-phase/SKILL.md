---
name: beta-phase
description: Execute one assigned Beta sub-phase (e.g. B-1.2) in a single focused pass, then report. Manual only, invoke with /beta-phase <sub-phase>.
disable-model-invocation: true
---

# beta-phase

Execute ONLY the sub-phase named in the arguments (`$ARGUMENTS`). Project rules, lane ownership and git safety are in the
root `CLAUDE.md`; do not restate or relax them. Approved decisions live in `pdf-tool-app/DEVELOPMENT_LOG.md` (the only development log; never create a root copy).

## Process
1. **Scope.** Restate the sub-phase goal in one line. If it is unclear or needs a decision not already approved, ask once, then stop.
2. **Read narrowly.** Read the sub-phase entry in `pdf-tool-app/DEVELOPMENT_LOG.md`, `BETA_ISSUE_LEDGER.md`, and only the source files the task touches. No repo-wide audits, no exploratory investigations, no re-auditing approved architecture.
3. **Implement** in one focused pass, following the existing Beta plan and architecture. Beta lane only; if Alpha-owned code must change, log a request in the ledger instead of editing it.
4. **Verify.** Every sub-phase: targeted tests and relevant type checks (from `pdf-tool-app/`). Add regression tests when the changed component warrants them. Run full `npm test` and `npm run build` at master-phase completion. Never defer a P0 defect or proceed with a known-broken prerequisite. Report failures as they are.
5. **Triage** every finding as:
   - **P0** blocks this sub-phase or breaks an invariant/data: fix now.
   - **P1** real defect or gap with a downstream dependency: log in ledger, continue if safe.
   - **P2** minor/polish: log in ledger, continue.
   Do not widen scope to fix unrelated findings.
6. **Ledger.** Before adding a row, search `BETA_ISSUE_LEDGER.md`; update an existing row (evidence, status, resolution) instead of duplicating. Next ID = highest `BL-nnn` + 1.
7. **Docs.** Append a short status to `pdf-tool-app/DEVELOPMENT_LOG.md` keeping implementation, automated tests and human acceptance as separate statuses. Never edit the local-only planning files.
8. **Commit** on `develop` only if the assignment says to; stage files by name, never `git add -A`. Otherwise report "not committed".
9. **Stop.** Do not start the next sub-phase without explicit instruction.

## Never
Touch `main`, rewrite history, force-push, change dependencies or the lockfile, change architecture without approval, or modify the seven local-only planning documents.

## Report (short)
- Files changed
- Implementation status (plus automated tests / human acceptance, separately)
- Checks performed and results
- Issues logged (ledger IDs, priority)
- Commit hash (or "not committed")
