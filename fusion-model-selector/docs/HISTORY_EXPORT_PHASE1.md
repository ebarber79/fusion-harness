# Fusion history/export Phase 1 continuation

Reference: FUSION-8766-HISTORY-EXPORT-PHASE1
Date: 2026-10-09
Project: /home/siegepi10/fusion-model-selector
Target: http://localhost:8766

## Status
Saved, offline verified and subsequently deployed with user authorization. Not committed or pushed in this continuation. Before deployment, GET /api/history returned HTTP 404 and GET /api/job returned job=null. After the authorized restart, history returns HTTP 200. No paid generation was performed. Original port 8765 files/service were not modified.

## Work recovered and completed
The worktree already contained history.py, Python history tests, history controls and export routes. Initial Python verification ran 110 tests with one failure and seven existing mobile skips. A latched storage failure during a provider call did not stop later calls.

Added latch checks before later stages and before the optional Claude fallback. The original regression passed after the change. A new fallback regression first failed with two provider calls instead of one, then passed after the fallback check.

History UI now rejects stale poll, history-list, historical selection and deletion responses/errors; returning to latest and accepting a run invalidate pending historical loads. Accepted submissions remain locked until active polling settles. Ten additional history UI regressions were implemented with RED/GREEN evidence by the delegated worker, then independently rerun.

Direct Jobs fixtures now register cleanup to join workers and close SQLite stores. The previously observed unclosed SQLite ResourceWarnings disappeared in independent full-suite verification.

## Implemented feature contracts
- Owner-only SQLite storage under ~/.local/share/fusion-model-selector (directory 0700, files 0600).
- Single process-lifetime owner lock and bind-before-recovery startup.
- Persist acceptance before worker launch and stage transitions/results before later work.
- Recover unfinished work as interrupted, retaining committed outputs without automatic replay.
- Retain 100 terminal runs plus active work.
- Browse history separately from active job and next-run preferences.
- Markdown download with prompt, configuration, identity, status, outputs, errors and reported usage; collision-safe fences contain untrusted text.
- Confirm deletion; reject deletion of active runs atomically.
- Latch storage failures, stop later stages/fallback and reject new runs until repaired/restarted.

Storage is plaintext, not encryption. History is not backup. Logical deletion/retention is not forensic erasure. Download permissions depend on browser/OS. Keep saved outputs and exports outside publication.

## Independent final offline verification
Commands:
```
PYTHONDONTWRITEBYTECODE=1 python3 -W always::ResourceWarning -m unittest -q
node --test test_models_ui.js test_history_ui.js test_copy_ui.js
node --check static/app.js
git diff --check
```
Python: 111 tests ran; 104 passed, 7 existing mobile tests skipped. No ResourceWarnings observed.
Node: 26 passed, 0 failed, 0 skipped.
JavaScript syntax and tracked diff whitespace: passed.
Mocked-provider/temporary-server coverage includes durable storage, restart recovery, owner exclusion, private paths, retention, deletion, HTTP export and storage failure. This is not real-provider or deployed real-browser verification.

## Files changed during this continuation
- fusion.py
- static/app.js
- test_history.py
- test_history_ui.js
- test_analysis.py
- test_anthropic.py
- test_architect.py
- test_claude_fallback.py
- test_fusion.py
- test_openai_catalog.py
- test_perplexity.py
- test_usage.py
- test_xai.py
- README.md
- docs/HISTORY_EXPORT_PHASE1.md

The repository already had extensive staged/unstaged changes and no commits on its local main branch. Those existing changes were preserved; no publication was attempted.

## Deployment gate recorded before authorization
Obtain authorization to restart only fusion-model-selector.service. Recheck GET /api/job immediately before restart, preserve any valuable current output privately, and do not interrupt running work. Then verify history endpoint, actual browser controls/download and restart persistence without replay. Real-provider paid generation is a separate optional check, not required to exercise persistence using isolated mocked providers.


## Authorized deployment verification

After user authorization, restarted only fusion-model-selector.service. Immediately before restart, GET /api/job was null. The service is active and enabled. GET /api/history now returns HTTP 200 with runs=[]; GET /api/job remains null. The initial connection-refused response during startup succeeded on bounded retry.

Browser verification at http://localhost:8766 shows Run history, Saved run selector, Refresh history, Active/latest, Delete saved run and Export Markdown. Refresh history was clicked; browser console reported no JavaScript errors or console messages. No real saved runs currently exist, so historical selection, actual browser download and persistence of a real production run across restart remain unverified. Export/recovery behavior is covered by isolated mocked tests, not a production generation claim.

Production storage modes verified: directory 0700, database and owner.lock 0600. All 16 focused history Python tests passed again after deployment. Original fusion.service stayed active with unchanged PID 1191. No paid generation, credential changes, commit or push occurred.

Final status: saved and deployed locally; offline tests and live empty-history UI/API verified; not committed or pushed.
