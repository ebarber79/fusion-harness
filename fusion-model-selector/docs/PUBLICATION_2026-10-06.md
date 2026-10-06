# Publication snapshot — 2026-10-06

Repository: https://github.com/ebarber79/fusion-harness
Target branch: `release/fusion-model-selector`
Application directory: `fusion-model-selector/`

## Scope and history

This snapshot publishes the current locally saved harness, including its backend,
frontend, setup scripts, offline regression tests, and title-aligned copy controls.
The selector includes Claude architect/fallback and current OpenAI catalog changes;
provider authentication/generation limitations in RELEASE_READINESS remain applicable.
Original Fusion remains the three-stage OpenAI/Ollama app.

Earlier CHANGELOG and release-readiness entries are historical snapshots of status,
not a claim that this release remains unpublished. Hosted CI and remote publication
are verified separately after pushing. This publication does not merge into main,
create a PR or GitHub Release, restart services, or configure public hosting.

## Local verification of this exact application snapshot

- 95 Python tests discovered: 88 passed, 7 deferred mobile tests skipped; 13 Node tests passed.
- JavaScript syntax check passed.
- Offline tests do not require real provider credentials or paid requests.
- Root GitHub Actions workflow repeats tests on Python 3.11/3.13 and Node 22,
  including new copy-button regressions and committed whitespace checks.
- CommonJS package boundary prevents inherited parent ESM settings from breaking tests.

## Publication safety

- Only allowlisted source, tests, setup tools, and reviewed documentation are copied.
- Credentials, saved-run exports, caches, logs, and environments are excluded.
- Session-derived FUSION_EFFECTIVENESS_REPORT.md is intentionally kept local.
- Read-only review found no exact configured credentials in either app snapshot.
- A staged-blob scan is required before the release commit is pushed.
- Existing repository history and main are preserved; no force push.
- Source-service working directories and existing staged changes are preserved.

## Limits

Clipboard automation used substituted writes; actual clipboard reads were blocked
by browser permissions. This is a trusted-user local desktop app, not evidence of
public-service security or mobile readiness. Previously recorded paid-generation,
provider-authentication and mobile limitations are not resolved by a Git push.

## Verified runtime release

Runtime release commit: `558e8b8a394d411319c5179b8022fc99255a201e`. Remote matched after push.
Hosted CI passed on Python 3.11 and 3.13 / Node 22:
https://github.com/ebarber79/fusion-harness/actions/runs/37460287050

This record is committed in a documentation-only follow-up. Main remains unchanged.
