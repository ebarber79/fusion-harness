# Release readiness

Verified 2026-10-04 on the deployed local Fusion selector at http://localhost:8766/.

## Release scope

Trusted-user desktop app: OpenAI architecture; Ollama, Grok or Perplexity building; OpenAI synthesis; OpenAI user-facing Reasoning / Divergence comparison. Claude runtime integration remains removed. This is orchestration, not a newly trained model. It is not a public web service.

## Automated verification

- `python3 -m unittest -q`: 67 discovered, 60 passed, 7 explicitly skipped for deferred mobile work; no failures.
- `node test_models_ui.js`: passed provider selection, usage, four-stage lifecycle, identity, history and reset behavior.
- `node --check static/app.js` and `node --check test_models_ui.js`: passed.
- Independent full-source review found one release privacy blocker: missing exclusions for private historical runs. Added .gitignore; verified saved-run*.json is excluded and local originals preserved. No other concrete runtime security or logic blockers were identified by the reviewer.
- GitHub Actions configuration repeats offline regression/UI checks on Python 3.11 and 3.13 / Node 22. The hosted workflow has not run yet; local verification used the installed runtimes.

## Fresh live browser smoke tests

The same small, non-sensitive coding prompt was submitted through Run Fusion with each builder. Each job reached `completed`, every stage reached `completed` with nonempty text, usage was reported, and the browser rendered all four panels with correct provider/model labels and re-enabled Run.

| Builder | OpenAI roles | Four-stage result | Reported total tokens |
| --- | --- | --- | --- |
| Perplexity perplexity/sonar | gpt-5.5 | Completed | 3062 |
| xAI grok-4.3 | gpt-5.5 | Completed | 3251 |
| Ollama qwen2.5-coder:0.5b | gpt-5.5 | Completed | 3160 |

Cloud requests were real and billable. Token counts are provider-reported, not dollar estimates. The coding prompt requested no web search and the Perplexity response returned zero sources. Citation extraction/security is covered offline, but live web-search/citation behavior was not smoke-tested. No model-generated code was executed. Model-answer accuracy and instruction compliance beyond basic output/rendering were not independently certified.

Authenticated live catalogs reported Ollama, xAI and Perplexity available. Catalog membership is not a generation guarantee for all listed models: only the builders in this table were tested. Browser console check recorded no messages or JavaScript errors.

The selector service, original Fusion service and Ollama service were active. The selector service was enabled. No service restart or runtime-source change was needed. This is not a reboot test or endurance/load test.

## Publication safety

Initialized a local main-branch Git repository. Added exclusions for credentials, saved runs, logs and generated caches, plus an offline CI workflow and SECURITY.md. A release-candidate scan checked provider-token/private-key patterns and exact configured credential values without displaying them; no matches were found. Private credential files remain outside the repository.

Publication target confirmed by the owner: ebarber79/fusion-harness, branch release/fusion-model-selector. This release is added under fusion-model-selector/ with a repository-root .github/workflows/fusion-model-selector.yml workflow; existing main history and files are preserved. SSH authentication was verified as ebarber79. The existing repository LICENSE remains unchanged. No credentials, saved-run exports or caches are included. Do not use `git add -f` for ignored private files. Push and hosted CI outcomes are reported separately after publication.

## Explicit limitations

- Phone/private-network access and QR panel remain unimplemented; 7 mobile tests are skipped. No real-phone verification.
- No public-hosting authentication, multi-user authorization or public production deployment guarantee.
- Latest-job history is in-memory and is lost on restart.
- No load, endurance, reboot, penetration or exhaustive model-entitlement test.
- Hosted GitHub CI results remain pending until a remote push.

Verdict: smoke-tested for the documented local desktop scope and prepared for initial GitHub publication. Mobile/public-hosting production readiness is not claimed.
