# Fusion model selector (independent fork)

Open http://localhost:8766 on the Pi. This app lives at /home/siegepi10/fusion-model-selector. The original /home/siegepi10/fusion on port 8765 is independent and must not be restarted or modified when deploying this fork.

## Workflow and controls

1. OpenAI architect receives the user request (gpt-5.5 by default).
2. The selected installed Ollama local, Grok / xAI cloud, or Perplexity cloud builder receives the request and architecture.
3. OpenAI synthesis receives the request, architecture, and builder output.
4. OpenAI Reasoning / Divergence analysis runs AFTER synthesis, receiving the request and all three visible outputs using the same OpenAI model as synthesis. This adds API cost and sequential latency. It is a user-facing output comparison, not hidden chain of thought: concise agreements and divergences cite visible evidence; possible causes are labeled hypotheses (role instructions, context, model limits), never asserted internals. It explains synthesis resolutions and remaining uncertainties/tests, warns about unavailable/truncated evidence, and must not invent discrepancies.

The OpenAI field controls synthesis, analysis, and the default architect. The architect selector is OpenAI-only; an explicit OpenAI override restored from a job remains supported independently of synthesis/analysis. Builder choices include installed local models, Grok text models, and Perplexity Sonar. The four panels form a 2x2 grid on wide screens and stack on narrow screens. Output panel labels use job metadata, not selections for the next run. Legacy three-stage history shows analysis as unavailable, not a fabricated comparison.

OpenAI and xAI may charge for API usage. A local builder's output still goes to OpenAI synthesis; this is not an offline/private-only workflow. Do not submit secrets. Models propose code and instructions, never execute them or edit files. This is orchestration, not training a new model.

One run at a time; later stages continue with an unavailable-stage note after a failed stage. Earlier outputs are preserved, including all three original outputs if analysis fails. Partial results are not a successful complete run. Only the latest job is held in memory. Closing a tab does not cancel it; restarting clears outputs and usage. Existing saved-run JSON files are retained unchanged.

## Start and server-side keys

For a fresh checkout, use Linux with Python 3.11 or newer. The runtime uses only the Python standard library; Node.js is needed for UI tests, not to run the app. Install and run Ollama separately if local building is desired. Cloud providers require separate API credentials/billing. From the checkout directory run `python3 fusion.py`, then open http://localhost:8766/; the application is not hosted by GitHub Pages.

On the existing Pi deployment:

    cd /home/siegepi10/fusion-model-selector
    python3 fusion.py

Existing deployments use the user service fusion-model-selector.service. Check GET /api/job before any restart and do not restart while status is running. Never restart fusion.service for this fork.

OpenAI uses OPENAI_API_KEY first, then ~/.config/fusion/openai.key. Hidden key entry:

    python3 setup_key.py

Grok uses XAI_API_KEY first, then ~/.config/fusion/xai.key. Hidden key entry:

    python3 setup_xai_key.py

Never put keys in arguments, browser fields, chat, or model prompts. The helpers use atomic owner-only storage, refuse symlink credential paths, and fail closed if hidden input is unavailable. Saving a key does not prove authentication or available credits. File-based updates normally need only Refresh models; environment overrides take precedence. No agent dotenv files are imported. No credentials are exposed in browser output or logs.

## Builder models

Local options are sorted installed models from http://127.0.0.1:11434/api/tags, not downloads. qwen2.5-coder:0.5b is preferred if installed, otherwise the first installed model. Known embedding-only entries are omitted; unannotated models may still fail generation. Size labels describe disk size, not RAM requirements.

    ollama pull MODEL_NAME

Installing is an optional user action; the app never downloads models. Click Refresh afterward. Larger models require more storage/memory and can be slow on the Pi. Refresh preserves a valid selection; unavailable restored models require explicit reselection rather than silently switching. Run is disabled while loading, disconnected, missing a valid model, or already running.

Grok choices come from the authenticated https://api.x.ai/v1/models catalog. Only supported Grok text models are selectable; image, video, voice, audio, TTS, transcription and unsupported multi-agent IDs are excluded. Local builders remain usable if xAI fails; verified Grok choices remain usable if Ollama fails. Catalog verification proves membership, not generation entitlement, access to every model, or credits.

If xAI catalog access fails, these documentary fallbacks remain disabled and explicitly unverified/not ready: grok-code-fast-1, grok-4.3, grok-4.5, grok-4.6, grok-4.7, grok-4.20-reasoning, grok-4.20-non-reasoning. Source: https://docs.x.ai/developers/models. They are not installed models or evidence of account access.

## API and security

GET /api/models returns local models/default plus combined builders/default_builder, providers (ollama, xai and perplexity), and an OpenAI-only architects/default_architect catalog. Local status is available/unavailable; cloud status is available/unverified. Verified cloud entries have status=catalog, verified=true, selectable=true; fallback entries are disabled. default_builder prefers local, then verified Grok, then verified Perplexity, otherwise null.

Each catalog has a five-second socket timeout, maximum 1 MiB response, fixed destination, no inherited proxies, and no redirects. Provider failures are independent and sanitized; the endpoint remains HTTP 200 even if all upstreams fail. Query parameters cannot change destinations. Unexpected internal failures return generic HTTP 503. model_catalog() and fetch_model_tags() retain local-only contracts.

POST /api/run:

    {"prompt": "Build something", "openai_model": "gpt-5.5",
     "ollama_model": "xai:grok-code-fast-1"}

The legacy ollama_model field selects the builder. Plain names/tags stay local; ollama:<model-id> is explicit local routing; xai:<supported-grok-id> routes to fixed https://api.x.ai/v1/chat/completions. Removed cloud-provider selections are rejected, not sent to Ollama. An optional architect_model accepts a plain OpenAI ID or openai:<model-id>; omitting it uses openai_model. Synthesis always uses openai_model. No arbitrary endpoint or credential fields are accepted.

xAI payload uses system/user messages, stream=false, max_tokens=4000 and a 180-second timeout; content comes from choices[0].message.content. OpenAI uses the Responses API; Ollama uses the fixed loopback generate endpoint. Token-limit truncation is noted. Direct clients can request supported Grok IDs without catalog verification; authentication/generation failures remain sanitized.

POST returns HTTP 202 with an id. GET /api/job returns job=null or the latest job, including config, stage provider/model, status, output, errors, stage usage and aggregate usage. Host/origin restrictions apply. The app is loopback-only, not suitable for public hosting or untrusted local users. Credentials are redacted from successful provider output; catalog IDs echoing the active xAI key are removed. UI labels/errors/output use safe DOM text, never HTML interpolation.

## Reported token usage

Each panel shows provider-reported input/output/total tokens after its nonstreaming stage completes. Whole-run usage sums known counts only, with complete-stage and input/output/total coverage. Unknown is not zero; pending, failed, missing or malformed counts remain null, while a reported zero is valid. Poll/reload restores counts without accumulating them. New runs clear old usage. No streaming estimates, dollar estimates or persistent cumulative history are added; provider dashboards remain authoritative for billing.

OpenAI uses Responses input_tokens/output_tokens/total_tokens; xAI uses chat prompt_tokens/completion_tokens/total_tokens; Ollama uses prompt_eval_count/eval_count and their sum when both are known. Cached-input and reasoning subsets are retained separately, never added again. Counts must be nonnegative JSON integers, not booleans. OpenAI/xAI totals are not invented from other fields. Plain-string injected providers remain supported with unknown usage.

Stage usage fields: input_tokens, output_tokens, total_tokens, cached_input_tokens, reasoning_tokens. Whole-run usage also includes known_stages, complete_stages, stage_count and complete. New runs have four stages (architect, builder, synthesis, analysis); analysis is included in totals and coverage. Complete coverage requires all main counts for all stages; optional subset counts do not affect it.

## Offline tests and deployment limits

    cd /home/siegepi10/fusion-model-selector
    python3 -m unittest -v
    node test_models_ui.js
    node --check static/app.js
    node --check test_models_ui.js

Tests use synthetic credentials, temporary homes, ephemeral loopback servers and mocked upstream transports. The Node DOM harness covers installed selectors, cloud availability, OpenAI restoration, stage labels and usage lifecycle. Offline tests alone do not prove live provider access or real-browser rendering. See docs/RELEASE_READINESS.md for the latest automated, browser and live-provider smoke-test evidence. GitHub Actions repeats the offline checks without real provider credentials; it does not run paid generation.

## Perplexity Agent API Builder

Create/select a project and complete its project settings/billing prerequisite in the Perplexity API Console, then generate a key at https://console.perplexity.ai/project/keys. Perplexity consumer/Pro subscriptions and API billing are separate; model tokens and web search invocations have separate API charges.

    cd /home/siegepi10/fusion-model-selector
    python3 setup_perplexity_key.py

The hidden-input helper reuses setup_key.store_key's atomic 0600 file / 0700 directory storage. PERPLEXITY_API_KEY takes precedence over ~/.config/fusion/perplexity.key. Refresh reads the file dynamically; saving a key alone does not prove access. No keys were inspected during this implementation.

Official research: https://docs.perplexity.ai/llms.txt, https://docs.perplexity.ai/api-reference/models-get.md, https://docs.perplexity.ai/api-reference/agent-post.md, https://docs.perplexity.ai/docs/agent-api/models.md, https://docs.perplexity.ai/docs/agent-api/tools/web-search.md, and https://docs.perplexity.ai/docs/agent-api/migrate-from-sonar/overview.md. The migration docs recommend Agent API for new projects and say Sonar Chat Completions support ended September 27, 2026. Saved official reference snapshots and RED/GREEN evidence are under docs/perplexity/.

Authenticated catalog: GET https://api.perplexity.ai/v1/models with Authorization: Bearer <server-side-key>. Only documentary Perplexity's own perplexity/sonar model is selectable, and only if present in the catalog. Other provider models (including similarly prefixed third-party weights) are filtered out. This is a model, not a preset. No retired provider integration was added. Catalog failure/no key displays disabled, unverified fallback; Ollama and Grok remain independent.

Select ollama_model=perplexity:perplexity/sonar. Fixed POST https://api.perplexity.ai/v1/agent payload:

    {"model":"perplexity/sonar", "instructions":"<builder rules>",
     "input":"<request and architecture>",
     "tools":[{"type":"web_search", "max_results":5, "max_tokens":2000}],
     "max_steps":3, "max_output_tokens":4000, "store":false}

Important documentation discrepancy: the current official Agent API schema and define-the-run guide document max_steps, NOT max_tool_calls. This implementation uses the documented max_steps loop bound rather than inventing an unsupported field. A step may include multiple tool calls; this is not a verified strict per-invocation cap. The requested max_tool_calls cap cannot be claimed satisfied by current docs. No presets, model fallback, sandbox/code execution, MCP, URL-fetch tools, browser-selected endpoints, proxies or redirects are enabled. Timeout is 180 seconds; response limit 2 MB.

Only assistant message output_text is extracted, never reasoning or tool text. Sources from url_citation annotations and search_results are deduplicated and rendered as plain text, at most 10 URLs (2048 characters each) and 200-character titles; unsafe schemes, credentials, local/private address literals and active-key echoes are rejected/redacted. No source URLs are fetched locally. Both visible answer and sources go onward to OpenAI synthesis and analysis. Response model metadata is retained even if different from the requested model, while provider=perplexity identifies the billed API transport. Responses usage input/output/total is normalized; absent counts remain unknown and cached/reasoning subsets are not double-counted.

Verification: the authenticated live catalog now enables Perplexity Sonar, and a fresh browser-submitted four-stage run completed with OpenAI architecture, Perplexity building, OpenAI synthesis and OpenAI analysis. Every stage returned nonempty output and reported usage. This was a paid API smoke test, not just a catalog check. Detailed release evidence and limitations are recorded in docs/RELEASE_READINESS.md. Mobile/QR access remains deferred and its seven tests remain explicitly skipped; no real-phone test has been performed.

## Files

fusion.py: catalogs, fixed transports, validation, orchestration and usage.
static/: four-panel UI and local/Grok selector.
setup_key.py and setup_xai_key.py: hidden supported-provider entry.
test_fusion.py, test_models.py, test_xai.py, test_usage.py, test_architect.py: generic and supported-provider coverage.
test_provider_removal.py: removed integration regression checks.
test_analysis.py: fourth-stage routing, context, evidence instructions, failures, usage and markup contracts.
test_mobile.py: preserved pending separate mobile-access tests, explicitly skipped; no mobile feature is implemented here.
test_models_ui.js: dependency-free UI behavior harness.
docs/plans/implementation.md: inherited original implementation plan.
