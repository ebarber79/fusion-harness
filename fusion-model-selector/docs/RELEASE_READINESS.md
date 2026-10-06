# Release readiness

Historical deployed baseline was verified 2026-10-04 at http://localhost:8766/. The new Claude architect changes below are deployed; provider activation is blocked by an Anthropic credential/authentication error.

## Current Claude change status

- OpenAI remains the default; catalog-verified Claude can be selected as architect or a one-shot backup after OpenAI architect failure. Other stages retain their routing.
- Latest offline run: 90 Python tests, 83 passed and 7 deferred mobile tests skipped; 8 Node checks passed. JavaScript syntax and git diff whitespace checks passed.
- Review fixes cover default-model resolution, empty-output fallback, failed-attempt totals and model identity, saved next-run preference precedence, credential control characters, and whole-request generation deadlines.
- Credential metadata only: saved Anthropic file present/nonempty, owned by the current user, mode 0600; no service environment override present. This does not establish authentication, credits or generation.
- A completed pre-change run was backed up privately to /home/siegepi10/.local/share/fusion/backups/pre-claude-job.json.
- Subsequent authorized restart deployed the new Python backend after an idle-job check and private backup; selector service is active/enabled. Live browser confirms one architect dropdown with named GPT entry, no separate backup model field, and disabled Claude fallback while unavailable. Direct Anthropic Models API returned HTTP 400, invalid_request_error, credential/authentication category; raw errors and secrets withheld. Replace the saved API credential through setup_anthropic_key.py and Refresh. Paid Claude generation and live failure fallback remain unverified.
- Original port 8765 was not changed. No paid requests were made for this Claude verification.

The sections below are historical baseline evidence, not proof of readiness for the new Claude feature.

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

No remote repository was selected or created, and nothing was pushed. Review staged files and choose repository owner/name and visibility before publishing. No license has been assigned; choose an appropriate license before advertising licensed open-source reuse. Do not use `git add -f` for ignored private files.

## Explicit limitations

- Phone/private-network access and QR panel remain unimplemented; 7 mobile tests are skipped. No real-phone verification.
- No public-hosting authentication, multi-user authorization or public production deployment guarantee.
- Latest-job history is in-memory and is lost on restart.
- No load, endurance, reboot, penetration or exhaustive model-entitlement test.
- Hosted GitHub CI results remain pending until a remote push.

Verdict: smoke-tested for the documented local desktop scope and prepared for initial GitHub publication. Mobile/public-hosting production readiness is not claimed.
