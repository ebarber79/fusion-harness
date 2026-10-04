# Fusion Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Build a local, dependency-free three-panel architecture → build → synthesis app.

**Architecture:** A loopback-only Python HTTP server owns credentials and a single bounded in-memory job. A polling vanilla browser client displays stage outputs. Fixed OpenAI and Ollama endpoints are called sequentially; failed stages are marked and later stages receive explicit failure context.

**Tech Stack:** Python standard library, unittest, HTML/CSS/JavaScript.

Execution note: this worker is already a delegated subagent; no further delegation tool is available. Existing target checked and absent. Do not initialize git or modify unrelated files.

### Task 1: Core contract (test first)
Create `/home/siegepi10/fusion/test_fusion.py`. Test injected providers, context propagation, all partial failures, validation bounds, concurrency, bounded history and sanitized errors.
Run `python3 -m unittest -v` from `/home/siegepi10/fusion`; expect missing implementation failure. Create `fusion.py` with validation, fixed-endpoint provider and a locked single-job manager. Re-run until green.
Contract: `validate_request({"prompt":"hello"})` supplies default models; `Jobs(provider).start(request)` returns a job ID; `snapshot(id)` returns isolated stage state. Provider receives `(provider, model, instructions, input_text)`.

### Task 2: HTTP boundary (test first)
Extend tests with ephemeral loopback HTTP server: allow exact localhost/127.0.0.1 Host and same Origin only, JSON POST only, reject oversized bodies, malformed requests, unknown fields and routes. Serve only explicit static asset routes. Add HTTP handler in fusion.py and run unittest.

### Task 3: Credential and provider adapters (test first)
Add mocked transport tests for OpenAI Responses and Ollama generate payloads, fixed options, response bounds, redirect rejection, missing credentials and generic provider errors. Add temporary-directory credential tests. Implement `setup_key.py` using getpass, 0700 parent, 0600 atomic key file, no key output. Never read Codex credentials.

### Task 4: Browser interface (test first)
Add static contract tests. Create `static/index.html`, `static/app.js`, `static/style.css`. Prompt and model names editable, three desktop columns, stage states, safe textContent output, cloud disclosure, polling, busy/error handling and reconnect to current job on refresh.

### Task 5: Documentation and verification
Create README.md with start/key/test commands, privacy, memory lifetime, limits, provider prerequisites, partial-failure behavior and caveats. Run full unittest plus Python compilation and JS syntax if available. Tests use injected/mocked providers: no paid provider calls or Ollama installation. Stop all temporary test servers; do not start a permanent service.
