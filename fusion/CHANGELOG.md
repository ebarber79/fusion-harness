# Fusion original — Change log

Application: http://localhost:8765/
Project: `/home/siegepi10/fusion`

## 2026-10-06 — GitHub publication verified

- Published current source/tests and prior copy-control documentation to
  https://github.com/ebarber79/fusion-harness/tree/release/fusion-current/fusion.
- Runtime release commit: `8cd6661510a1a5afb1b52408282d2b97de6888e2`. Remote branch SHA verified after push.
- GitHub Actions passed on Python 3.11 and 3.13 / Node 22:
  https://github.com/ebarber79/fusion-harness/actions/runs/37460283556.
- Local verification: 16 Python and 5 Node tests passed; JavaScript syntax and staged whitespace passed.
- Used isolated publication checkouts; main and running services unchanged.
- Excluded credentials, saved runs, caches and session-derived effectiveness report.
- Configured-credential comparison and staged-blob scans found no secret matches.
- Added CommonJS boundary and root CI covering copy regressions; normalized trailing
  whitespace in historical test logs only in the selector publication snapshot.
- Documentation follow-up records this completed publication. Earlier unpublished
  status entries below are historical, not current. No PR, merge or GitHub Release.

## 2026-10-06 — Output copy controls

### Scope and sequence
This entry documents changes made during the current copy-button conversation, not an audited reconstruction of all earlier development. Existing guides and historical verification records remain intact.

1. Added Copy controls to the four output panels on port 8766.
2. Moved those controls beside their titles following user feedback.
3. Added matching title-aligned controls to the three output panels on port 8765.
4. Added this documentation and README links; saved a combined Desktop report.

### Behavior and design
- Each button copies only its panel's complete visible output text, preserving whitespace and line breaks; headings, status, and usage counters are excluded.
- Empty outputs disable Copy. Changed/cleared output resets feedback; normal polling preserves confirmation for unchanged output.
- Success shows “Copied!” and an accessible clipboard confirmation. Clipboard denial tries a local compatibility fallback; failure offers manual selection without claiming success.
- A pending clipboard operation cannot mark replacement output as copied.
- Buttons sit at the upper-right of each panel, beside its title. Shared CSS uses 12px text, 6px vertical/12px horizontal padding, a 1px border, and a 6px corner radius.
- The three original-app buttons measured 56 × 28 CSS pixels with the initial “Copy” label in the automated browser. The “Copied!” label can widen the button; dimensions are not fixed. Rendering can differ with browser/font settings.
- Existing panel grids remain unchanged: original app has three columns on wide screens; selector app has a 2×2 grid. Both stack on narrow screens. Phone use was not verified.

### Files changed per application
- `static/index.html`: accessible copy buttons, live feedback spans, title/control wrappers.
- `static/style.css`: compact matching controls and title-row layout.
- `static/app.js`: clipboard handling, fallback, feedback, and rendering lifecycle integration.
- `test_copy_ui.js`: new offline markup and clipboard/lifecycle tests.
- `CHANGELOG.md` and `README.md`: change record and user-facing instructions.

The original app also clears output when a job is absent or omits a stage during rendering, avoiding a Copy control for missing output. This work did not change backend/provider routing, credential storage, model settings, or output execution behavior.

### Verification
- RED-first tests failed before implementation; position regression failed before moving buttons.
- JavaScript syntax checks passed in both projects.
- Latest rerun: selector `node --test test_copy_ui.js test_models_ui.js` — 13 passed, 0 failed, 0 skipped.
- Latest rerun: original `node --test test_copy_ui.js` — 5 passed, 0 failed, 0 skipped.
- Live-page checks confirmed title alignment on all four selector panels and all three original panels, without title/button overlap on the inspected selector viewport.
- Live-page click handlers passed exact-output matching checks using a substituted clipboard writer. The automated browser denied actual clipboard access/readback; these checks do not prove the user's OS clipboard was populated. Real browser permissions still apply.
- Existing displayed outputs were used; no new paid generation was submitted. Python/backend suites were not rerun for this frontend-only change.

### Deployment and version-control status
Static updates are visible from the existing running servers after browser refresh. No service restart was performed; existing jobs were not replaced. Refresh the page, or use Ctrl+Shift+R if assets appear stale.

At documentation time, the selector working copy's `main` branch had no HEAD commit; frontend files were modified and the new copy test was untracked. The original app directory was not a Git repository. None of this conversation's changes has been committed or pushed. Existing unrelated staged/modified files were left intact. This record is documentation, not a claim of Git publication.

### Kimi inspection (no integration change)
A read-only check found no Kimi executable on PATH, no Kimi model in the local Ollama catalog, no Kimi/Moonshot references in the two apps' runtime/UI files, and no Kimi/Moonshot configuration references in the inspected main Hermes settings. Kimi/Moonshot and OpenRouter keys were absent from the inspected shell environment and main Hermes `.env`. Ollama listed only `qwen2.5-coder:0.5b` and `qwen2.5-coder:1.5b`; Hermes main configuration selected `gpt-6.1-sol` via `openai-codex`. No API credential values were displayed and no Kimi request was made. Other profiles, external credential stores, or installations outside PATH were not exhaustively audited.

### Documentation convention
Future entries should identify request/scope, files changed, behavior, tests and outcomes, live checks, limitations, deployment/restart status, and Git commit/push status. Record inspection-only findings as such, without implying an implementation. Keep secrets and private output contents out of documentation. Append or update the relevant project record when making a change; Git history supplements but does not replace these records.
