# Fusion model selector — Change log

Application: http://localhost:8766/
Project: `/home/siegepi10/fusion-model-selector`

## 2026-10-11 — Read aloud: opt-in ElevenLabs cloud voice (user's own clone)

- New Voice choice "My Voice – Brand — ElevenLabs cloud" (backend ID `elevenlabs-my-voice-brand`,
  model `eleven_multilingual_v2`; the account's voice ID is read from `~/.config/elevenlabs/voice_id`, not source). It uses the voice's saved
  ElevenLabs settings (stability 0.65, similarity 0.85); Fusion's speed maps to ElevenLabs speed, clamped 0.7–1.2.
- **Cloud, not offline:** each chunk's text is sent to api.elevenlabs.io and uses account credits. The dropdown
  labels it "cloud — sends text to ElevenLabs, uses credits"; it is never auto-selected and never a fallback
  for Piper or browser voices. Key is read from `~/.config/elevenlabs/key` per request (never sent to the browser).
- Same `/api/speech` contract (1–220 chars, rate 0.5–2, Host/Origin checks). PCM 22.05 kHz is wrapped as
  mono 16-bit WAV; one cloud request at a time (409 busy), 45 s timeout, errors return 503.
- Verification: 121 Python tests (0 failures, 7 skipped) incl. 2 new mocked cloud tests (no network),
  78 Node UI tests incl. 1 new cloud-label/no-auto-select test. Only `fusion-model-selector.service` restarted
  (no active run); live `/api/speech` returned a valid 2.9 s WAV in the cloned voice (one paid call).
  Saved and live-served; not committed or pushed.
- Follow-up (user request): this voice is now the **default** selection whenever available and no other voice
  has been chosen in the page; Piper and browser voices remain optional in the same dropdown. If the key is
  missing, the previous local-voice default applies. The privacy note states the default sends text to ElevenLabs.
  UI test updated (default, survives reloads, explicit choice kept, keyless fallback); 78 UI + 121 Python pass.
  Static files only — no service restart.

## 2026-10-10 — Read aloud: pauses after list items and bold label lines

- Verification of the Markdown cleanup against the latest saved run found no leftover Markdown,
  but Piper read straight through unpunctuated line breaks: "LED / Photodiode / Simple rule"
  had a 30 ms gap versus 170 ms with periods (measured on live `en_US-lessac-low` audio).
- `speechText()` now ends bulleted and numbered list items, and whole-line bold labels, with a
  period unless they already end in punctuation. Other plain text is still unchanged.
- Latest run: unpunctuated spoken lines fell from 166 to 0 (synthesis) and 42 to 0 (architect).
- Test seen failing first; Node suite 77/77. Live-served, no restart.
- Not verified: listening in the real browser (the Windows Chrome needs an SSH tunnel to reach the Pi).

## 2026-10-10 — Read aloud quality: Markdown cleanup, Piper prefetch, volume headroom

- `speechText()` in `static/app.js` turns Markdown into prose before chunking, for all voices.
  It removes heading, emphasis, list, quote and table symbols; says "Python code block omitted."
  instead of reading code; turns links into their text and bare URLs into "link to <domain>";
  and reads arrows as "to". Plain text passes through unchanged.
- Piper now requests the next chunk as soon as the current one starts playing, so the ~6 s
  synthesis time overlaps playback instead of causing a silent gap. Each chunk is still
  requested once; Stop aborts the prefetch; a failed prefetch is reported when its chunk is reached.
- `piper_worker.py` sets `volume=0.8`. Piper peak-normalizes to full scale, so clips previously
  peaked at 0 dBFS; live output now peaks at -1.9 dBFS with no full-scale samples.
- Tests: two new UI tests plus a worker assertion, seen failing first. Full suites: 77/77 Node,
  117 Python (7 skipped). No restart needed: the worker and `app.js` are loaded per request.
- Not verified: listening in the real browser.

## 2026-10-10 — Offline Piper voices installed and deployed

- Installed `en_US-lessac-low`, `en_US-ryan-low` and `en_GB-alan-low` (`.onnx` + `.onnx.json`) from
  Hugging Face `rhasspy/piper-voices` v1.0.0 into `~/.local/share/fusion-piper/voices`. Each model's
  SHA-256 matched Hugging Face's published hash; hashes are recorded in `docs/PIPER_OFFLINE.md`.
- Restarted only `fusion-model-selector.service` (no active run). The previous process predated the
  speech backend, so `/api/speech/voices` had returned 404. `fusion.service` (port 8765) was untouched.
- Live checks on localhost:8766: all three voices report available, and each returned valid,
  non-silent 16 kHz mono WAV audio. A 220-character chunk takes about 6 s to synthesize.
- `test_piper` (6) and `test_speech_ui.js` (23) passed. No code changes, paid calls, commit or push.
- Not verified: playback through the browser and speaker, and review of each voice's license.

## 2026-10-06 — GitHub publication verified

- Published current source/tests and prior copy-control documentation to
  https://github.com/ebarber79/fusion-harness/tree/release/fusion-model-selector/fusion-model-selector.
- Runtime release commit: `558e8b8a394d411319c5179b8022fc99255a201e`. Remote branch SHA verified after push.
- GitHub Actions passed on Python 3.11 and 3.13 / Node 22:
  https://github.com/ebarber79/fusion-harness/actions/runs/37460287050.
- Local verification: 95 Python discovered: 88 passed and 7 skipped; 13 Node passed; JavaScript syntax and staged whitespace passed.
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
