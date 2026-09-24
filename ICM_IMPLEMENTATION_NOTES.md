# ICM Phases 1–3 — implementation notes

> What the harness actually emits, where, and how it was verified. Companion to
> [`FUSION_ICM_PLAN.md`](FUSION_ICM_PLAN.md) (design) and [`AGENTS.md`](AGENTS.md) (execution contract).

**Status: Phase 1 (observe-only envelopes), Phase 2 (structured, verified handoffs) and Phase 3 (manual, validation-backed promotion) implemented. Phases 4–5 deliberately not started.**

## What Phase 3 adds (2026-09-24)

A single, manual path from a run's `/tmp` envelopes to **durable context**, in `icm/promote.ts` and two commands:

| Command | Does |
|---|---|
| `/icm-promote [--assess] <run-dir> [--supersedes ctx_…] [--note text]` | Assesses the run; if eligible, copies its output envelope (status → `validated`), its other envelopes verbatim under `lineage/` (still `draft`), and every artifact the evidence chain cites under `artifacts/` (hash re-checked after copy), writes `promotion.json` (who/when/from where/evidence chain), and appends **one** index entry. `--assess` only reports. |
| `/icm-context list [status] · show <id> · retract <id> <reason>` | Browses the index; `retract` marks an entry `rejected` (reason recorded), `--supersedes` marks the older entry `superseded`. **Nothing is ever deleted.** |
| `--icm-context-dir <dir>` flag | Where the cache lives. Default `$FUSION_ICM_CONTEXT_DIR`, else `~/.fusion/context`. |

**Eligibility is decided by evidence, not by anyone's say-so.** A run is promotable iff: it is an `/auto-validate` run; no envelope in it was rejected; its `output.json` re-verifies (schema, run scope, artifact hashes); that output carries a claim `validated_by: "gate"` whose evidence cites a `validation` envelope from the same run; that envelope re-verifies, records "The acceptance gate passed." as validated, and cites a gate-output artifact whose first line is `exit 0`; every cited artifact has a plain run-relative path; and nothing to be copied (artifacts or envelopes) still matches a secret pattern. `/fusion` and `/opinion` outputs are refused outright: a fusion agent must not certify its own output (plan §3), and their claims are `proposed`.

Layout of a promotion: `<contextDir>/<repo-slug>/<task_id>/{output.json, promotion.json, lineage/*.json, artifacts/*}` and `<contextDir>/index.json`. Only promoted outputs are indexed; lineage drafts are stored for audit but are **not** retrievable as accepted context. Retrieval (Phase 4) must read the index and filter `status === "validated"`.

After a gate PASS, the `/auto-validate` panel footer now prints `icm promotable (manual, gate-backed): /icm-promote <run-dir>`, and the output envelope's decisions say the same. Nothing promotes on its own.

### Phase 0 decisions — CONFIRMED by the owner on 2026-09-24

`AGENTS.md` lists these as human-decision stops. They were first taken provisionally (smallest reversible choice each) during Phase 3; on 2026-09-24 the owner confirmed all four as the basis for Phase 4. Every one remains a flag, env var, or function argument away from changing:

| Decision | Taken | Reversal |
|---|---|---|
| Where durable context lives | **User-level cache** `~/.fusion/context` (plan §9 names this as the acceptable initial location). Never the repository, never shared infrastructure. | `--icm-context-dir` / `$FUSION_ICM_CONTEXT_DIR`; a repo-tracked `.fusion/` would need a decision on what is reviewable + `.gitignore` changes. |
| Human approval | **Always manual** — every promotion is the user running `/icm-promote`. No automatic promotion for any scope, so no "high-risk scope" classifier was invented. | Auto-promotion on PASS would be one call site in `/auto-validate`; deliberately not wired. |
| Classification / secrets | Envelope text is redacted at emit; anything to be copied is **rejected** (not redacted) if a secret pattern still matches. No data classification beyond that. | `assessRun` secret check. |
| Retention / deletion | **Nothing is deleted** by the harness. `retract` → `rejected`, `--supersedes` → `superseded`, files stay. Deletion is the user's, by hand. | A `/icm-context purge` would be new code; not written on purpose. |
| Which ICM implementation is canonical | Unchanged: this repo's schema is used; `/mnt/e/Kimi_X_OAI_ Fusion Project` still shares the `/tmp/fusion-harness-*` prefix. | Owner's call. |

## What Phase 2 adds (2026-09-23)

Two existing role boundaries now **read** envelopes, after verifying them:

| Consumer | Consumes | Where it lands in the prompt | Falls back to |
|---|---|---|---|
| FUSION agent (`/fusion`) | `spec.json` (architect) + `build.json` (builder) | `# ICM STRUCTURED HANDOFFS` block after the original request, **before** the two raw answers (`{{ICM_HANDOFF}}` in `USER_PROMPT_FUSION_MERGE.md`) | the Phase 1 prompt (raw answers only) |
| BUILDER correction round N≥2 (`/auto-validate`) | previous `validation-round-(N-1).json` (or `validation-repair-round-*.json` after a gate repair) | `# STRUCTURED GATE DIAGNOSTICS` block **before** the raw gate output (`{{ICM_DIAGNOSTICS_BLOCK}}` in `USER_PROMPT_CORRECTION.md`) | the Phase 1 correction prompt (raw gate output only) |

Every consumption goes through `readEnvelope` (`icm/handoff.ts`): parse → schema re-validation → run/repository/commit scope match → SHA-256 re-check of every referenced artifact. A read that fails is **not rendered**; the reason is recorded as a `risk` on the consumer's own envelope (`output.json` for fusion, `build-round-N.json` for the builder) and the prompt keeps its Phase 1 shape. A successful consumption is recorded as a `decision` on that envelope and shown in the panel footer.

Gate output is now structured: each `PASS:`/`FAIL:` line becomes a claim on the round's `validation` envelope (`rejected`/`validated`, `validated_by: "gate"`, evidence = the gate-output artifact + the build envelope it judged). FAIL claims come first; the cap is 100 claims, with a truncation note in `open_questions`. The raw gate output remains the source of truth and still follows the structured block verbatim.

Terminal rendering: every panel that belongs to a run now ends with an `icm:` line listing that run's envelopes (`✓` valid / `✗ (REJECTED)`), their lifecycle status, and `icm-manifest.json`; the fused panel and correction-round validation panels add `icm handoff consumed: …`.

Still true after Phase 2: every envelope is `status: draft`; nothing is promoted, retrieved across runs, or transported anywhere. The handoff blocks state that envelopes are evidence, not instructions. Tool grants, session isolation, and the gate verdict are untouched. ICM being unavailable (no envelope, unwritable dir) leaves the commands working exactly as before.

## What Phase 1 does

Every `/opinion`, `/fusion`, and `/auto-validate` run writes schema-valid `ContextEnvelope v1` JSON
files into its existing `/tmp/fusion-harness-XXXXXX/` artifacts directory, next to the raw reports
it already wrote. The envelopes:

- excerpt and **SHA-256-reference** the raw reports (`architect.md`, `builder.md`, `gate.py`, …); they never replace them;
- are all `status: "draft"`; no promotion, retrieval, durable storage, MCP, or UI exists;
- (Phase 1 alone) are never read back by the harness. Phase 2 changed exactly two prompt slots and
  the panel footer (above); tool grants, session isolation, and gate execution are still byte-for-byte
  what they were. A failed or malformed envelope cannot interrupt a command.

## Files and what each owns

| File | Owns |
|---|---|
| `extensions/fusion-harness/icm/context-envelope.v1.schema.json` | The v1 contract (draft-07 JSON Schema, `additionalProperties: false` everywhere). Source of truth. |
| `extensions/fusion-harness/icm/envelope.ts` | Types mirroring the schema; the runtime validation boundary (`validateEnvelope`, a small draft-07 subset checker driven by the schema file); primitives (`ulid`, ids, `nowIso`, `sha256File`, `captureGitScope`, `redactSecrets`, `excerpt`); and `createIcmRun(...).emit(name, input)`, which fills id/scope/timestamp, hashes artifacts, redacts, validates, writes `<name>.json` or `<name>.rejected.json`, and updates `icm-manifest.json`. No pi dependency. |
| `extensions/fusion-harness/icm/promote.ts` | **Phase 3.** `defaultContextDir`, `assessRun` (the evidence-gated eligibility decision; pure read), `promoteRun` (stage, verify, copy, index; refuses duplicates/overwrites), `loadIndex` / `listContext` / `showContext`, `retractContext`. The only code that writes outside a run dir, and it writes only under the context dir. No pi dependency. |
| `tests/icm/promote.test.ts` | **Phase 3** contract tests: eligibility (PASS run accepted; `/fusion`, failed gate, tampered artifact, secret, rejected envelope, missing manifest refused), promotion layout and index, duplicate refusal, supersedes, retract, env override. |
| `extensions/fusion-harness/icm/handoff.ts` | **Phase 2.** `parseGateDiagnostics` / `diagnosticsToClaims` (gate lines → claims); `readEnvelope` (the verified-consumption boundary: schema, scope, artifact hashes); `renderHandoff` / `renderEnvelope` (the fuser's block); `renderDiagnostics` (the builder's block). Pure; no pi dependency. |
| `extensions/fusion-harness/USER_PROMPT_FUSION_MERGE.md`, `USER_PROMPT_CORRECTION.md` | **Phase 2.** Gain the `{{ICM_HANDOFF}}` / `{{ICM_DIAGNOSTICS_BLOCK}}` slots. Empty slot ⇒ content-identical to the Phase 1 prompt. |
| `tests/icm/handoff.test.ts` | **Phase 2** contract tests: diagnostics parsing and claim shape, verified read (tampered / missing artifact, stale run/repo/commit, malformed, unsupported version), rendering, template slots. |
| `tests/icm/mock-model-server.mjs`, `tests/icm/mock-e2e.mjs` | A scripted OpenAI-compatible mock that plays every role, and the zero-spend end-to-end proof (`just icm-mock-e2e`): throwaway `PI_CODING_AGENT_DIR`, scratch git repo, `/fusion` + `/auto-validate` with a deliberately wrong first build, `icm-verify` on both runs, and assertions on what each consumer's prompt actually contained. |
| `extensions/fusion-harness/fusion-harness.ts` | Section 8.15 (**Phase 3**): `/icm-promote`, `/icm-context`, the `--icm-context-dir` flag, the `icm` panel kind, and the `icmPromotable` footer hint on gate-PASS panels. Section 8.7c (**Phase 2**): `icmConsume` (verified read scoped to the run) and `gateClaims`; `/fusion` consumes spec+build before the fuser spawns; `/auto-validate` puts gate claims on every validation envelope and consumes the latest one in each correction round; `panel()` attaches the run's envelope roster (`FhDetails.icm`, `icmConsumed`) and the renderer prints it. Section 8.7b: `icmStart`/`icmBrief`/`icmRole`/`icmOutput` helpers, plus emit calls at each role boundary of the three commands. `stoppedPanel` and `/auto-validate`'s `fail` became `async` so their closing envelope is written before the command returns (they are `await`ed at every call site). Nothing else in the workflow changed. |
| `tests/icm/envelope.test.ts` | Contract tests (`node --test`): schema, every fixture, validator behaviour on garbage, primitives, emitter success/failure paths, and a full brief→spec→build→validation→output chain. |
| `tests/icm/fixtures/valid/*.json`, `tests/icm/fixtures/invalid/*.json` | Six valid envelopes (one per kind plus a superseding spec); twelve invalid ones, each the valid brief with exactly one defect. |
| `tests/icm/verify-run.ts` | Verifies a **real** run dir: manifest, every envelope validates, artifact hashes still match, `envelope:` evidence and `supersedes` resolve within the run, expected kinds for the command are present, no rejected files, and (**Phase 2**) every validation envelope carries its gate output's PASS/FAIL lines as gate-validated claims. |
| `justfile` | `just icm-test`, `just icm-verify <run-dir>`, `just icm-mock-e2e` (now also promotes and checks the index). |
| `README.md` | Folder-structure and Artifacts sections mention the envelopes. |
| `.gitignore` | Unchanged by this work; `.fusion/` was already ignored. |

## Envelope names per command

All paths are relative to the run's `/tmp/fusion-harness-XXXXXX/`.

| Command | Envelopes (in emission order) | Producer role → model |
|---|---|---|
| `/opinion` | `brief.json`, `spec.json`, `build.json`, `output.json` | user→human, architect, builder, harness |
| `/fusion` | `brief.json`, `spec.json`, `build.json`, `output.json` | user→human, architect, builder, **fusion** (or harness when fusion was skipped) |
| `/auto-validate` | `brief.json`, `spec.json`, then per round `build-round-N.json`, `validation-round-N.json`; on escalation `triage-round-N.json`; on gate repair `spec-repair-round-N.json` + `validation-repair-round-N.json`; finally `output.json` | user→human, validator, builder, validator, triage, triage, validator, harness |

Plus `icm-manifest.json` in every run: `{command, task_id, run_id, scope, envelopes:[{file,id,kind,status,producer_role,ok,errors?}]}`.

If any envelope fails validation it is written as `<name>.rejected.json` containing `{errors, envelope}` and the manifest entry has `ok: false`. The command output is unaffected.

## Semantics chosen (smallest reversible decisions — AGENTS.md)

- **Kind-based file names** (`spec.json`, not `architect-spec.json`). The plan's §9 listing used role-based names; kind-based names follow the `brief → spec → build → validation → output` flow named in AGENTS.md and stay stable across commands where the *same kind* has different producers (the spec is the architect's in `/fusion` but the validator's in `/auto-validate`). Not a schema change.
- **`kind` enum is exactly the five canonical kinds.** Triage output is a `validation` envelope from `producer.role: "triage"`; a gate repair is a `spec` from `triage` that `supersedes` the original spec. The role, not a new kind, carries that distinction.
- **`producer.role` enum**: `user | harness | architect | builder | validator | fusion | triage`. The brief is `user`/`human`; orchestrator-derived envelopes (outputs of `/opinion` and `/auto-validate`, stop/failure outputs) are `harness`/`harness/fusion-harness`.
- **Envelope `status` is always `draft`.** The gate is independent evidence, so *claim-level* status may be `validated` or `rejected` with `validated_by: "gate"` and the gate output as hashed evidence. Envelope-level promotion is Phase 3.
- **`task_id` and `run_id`** are both ULIDs minted per command invocation (one command = one task = one run today). The manifest ties them to the directory.
- **`scope.repository`** is the normalized `origin` URL (`github.com/owner/repo`) or `null`; `branch` is `null` on a detached HEAD; `commit` is the 40-hex HEAD or `null`. Captured with `git` in the host's cwd at command start; nothing is written to the repo.
- **Secret redaction** runs on every text field before writing (well-known key formats, `KEY=`/`TOKEN:`-style pairs, PEM blocks). Raw artifacts are left as they were — they already live only in the temp run dir.
- **Cross-references**: `validation-round-N` cites `envelope:<build-round-N id>` and `supersedes` the previous round's validation; `output` cites the final validation. `/fusion`'s output cites both worker envelopes.

## Verification commands and results (2026-09-23)

```text
$ just icm-test                       # node --test 'tests/icm/**/*.test.ts'
# tests 36  pass 36  fail 0

$ bun build extensions/fusion-harness/fusion-harness.ts --target=node --external '*'
Bundled 1 module                      # parse/transpile check of the patched extension

$ npx -p typescript@5.9 tsc -p <scratch tsconfig against pi's installed types>
2 errors, both PRE-EXISTING in the untouched original (same two at shifted lines):
  TS2322 stoppedPanel `command: string` vs FhDetails union; TS7022 `gateBefore` implicit any.
No new type errors from this change.
```

Live runs (local Ollama `llama3.1:latest` in every role via a throw-away `PI_CODING_AGENT_DIR`;
zero API spend; cwd = a scratch git repo, so nothing touched this repo or the user's `~/.pi`):

```text
$ just icm-verify /tmp/fusion-harness-gGqWCz     # /opinion "Reply with exactly one word: pong"
PASS ×17 … all checks passed

$ just icm-verify /tmp/fusion-harness-xw8B1N     # /fusion, builder child timed out at 300s
… output.json: "Fusion skipped: both agents must succeed to fuse." risks: [BUILDER … failed: timed out]
all checks passed                                 # failure path emits a valid, honest envelope
```

### Phase 3 verification (2026-09-24)

```text
$ just icm-test        # tests 66  pass 66  fail 0   (36 Phase 1 + 16 Phase 2 + 14 Phase 3)
$ bun build extensions/fusion-harness/fusion-harness.ts --target=node --external '*'   → Bundled 1 module
$ npx -p typescript@5.9 tsc -p <scratch ESM tsconfig>   → the same 2 pre-existing errors only
$ just icm-mock-e2e    # see the block appended below by the run
```

Run of `just icm-mock-e2e` (scripted mock, throwaway `PI_CODING_AGENT_DIR`, scratch repo, scratch context dir):

```text
PASS: icm-verify /tmp/fusion-harness-epCi2y: all checks passed (22 checks)        ← /fusion
PASS: icm-verify /tmp/fusion-harness-5Xm2fJ: all checks passed (45 checks)        ← /auto-validate (2 rounds)
PASS: auto-validate needed a correction round (round-2 build + validation envelopes exist)
PASS: gate passed at round 2 after the structured correction
PASS: build-round-2 envelope records that it consumed validation-round-1.json
PASS: fusion output envelope records the consumed handoffs
PASS: /icm-promote indexed exactly one validated output for run run_01M390S2Y84J688XDNPBRTWXJ8
PASS: promoted output is validated with promotion record and hashed artifacts at <scratch>/context/no-repository/task_01M390S2Y7VCYT4V0CYHC1E7GH
PASS: the run's own output.json stays draft
PASS: a second /icm-promote of the same run is refused (index unchanged)
PASS: /icm-promote refuses the /fusion run (no independent evidence) — index unchanged
PASS: fuser prompt carried the ICM handoff block: FUSION handoff=true files=spec.json,build.json
PASS: builder round 1 carried no diagnostics (nothing to consume yet)
PASS: builder correction prompt carried STRUCTURED GATE DIAGNOSTICS with 2 numbered FAIL item(s)
all checks passed
```

The promoted tree (the scratch repo has no `origin`, hence `no-repository`):

```text
<scratch>/context/index.json
<scratch>/context/no-repository/task_01M390S2Y7VCYT4V0CYHC1E7GH/artifacts/builder-round-2.md
<scratch>/context/no-repository/task_01M390S2Y7VCYT4V0CYHC1E7GH/artifacts/gate-round-2.txt
<scratch>/context/no-repository/task_01M390S2Y7VCYT4V0CYHC1E7GH/artifacts/gate.py
<scratch>/context/no-repository/task_01M390S2Y7VCYT4V0CYHC1E7GH/lineage/brief.json
<scratch>/context/no-repository/task_01M390S2Y7VCYT4V0CYHC1E7GH/lineage/build-round-1.json
<scratch>/context/no-repository/task_01M390S2Y7VCYT4V0CYHC1E7GH/lineage/build-round-2.json
<scratch>/context/no-repository/task_01M390S2Y7VCYT4V0CYHC1E7GH/lineage/spec.json
<scratch>/context/no-repository/task_01M390S2Y7VCYT4V0CYHC1E7GH/lineage/validation-round-1.json
<scratch>/context/no-repository/task_01M390S2Y7VCYT4V0CYHC1E7GH/lineage/validation-round-2.json
<scratch>/context/no-repository/task_01M390S2Y7VCYT4V0CYHC1E7GH/output.json
<scratch>/context/no-repository/task_01M390S2Y7VCYT4V0CYHC1E7GH/promotion.json
```

`promotion.json` of that entry:

```json
{
  "id": "ctx_01M390S5043CFXWEWR4RA662CY",
  "task_id": "task_01M390S2Y7VCYT4V0CYHC1E7GH",
  "run_id": "run_01M390S2Y84J688XDNPBRTWXJ8",
  "source_run_dir": "/tmp/fusion-harness-5Xm2fJ",
  "promoted_at": "2026-09-24T06:13:55.393Z",
  "approved_by": "user",
  "note": null,
  "supersedes": null,
  "artifacts": [
    {
      "path": "gate-round-2.txt",
      "type": "gate-output",
      "sha256": "87e39e96112fe63891d50022e2470f8c25a6182c8e9dee682f8039dc6c80057a"
    },
    {
      "path": "builder-round-2.md",
      "type": "raw-report",
      "sha256": "16c3d546cbe78d197cdee3644c2a2b015e3926288a1cb857ddceb93da8fdaa8d"
    },
    {
      "path": "gate.py",
      "type": "gate-script",
      "sha256": "835376aaa17fa5b53e03fc9937aa0cb4c234d930830fd80a5afc20ee9fdddc34"
    }
  ],
  "lineage": [
    "brief.json",
    "spec.json",
    "build-round-1.json",
    "validation-round-1.json",
    "build-round-2.json",
    "validation-round-2.json"
  ],
  "evidence_chain": [
    "envelope:ctx_01M390S5043CFXWEWR4RA662CY",
    "envelope:ctx_01M390S501ZCYTFX9SSQ76XYH0",
    "artifact:gate-round-2.txt"
  ],
  "retracted": null,
  "superseded_by": null
}
```


### Phase 2 verification (2026-09-23)

```text
$ just icm-test                       # node --test 'tests/icm/**/*.test.ts'
# tests 52  pass 52  fail 0           (36 Phase 1 + 16 Phase 2)

$ bun build extensions/fusion-harness/fusion-harness.ts --target=node --external '*'
Bundled 1 module

$ npx -p typescript@5.9 tsc -p <scratch tsconfig, ESM, against pi's installed types>
2 errors — the same two PRE-EXISTING ones (TS2322 stoppedPanel `command`, TS7022 `gateBefore`),
confirmed identical on the pre-patch tree via git stash. No new type errors.

$ just icm-mock-e2e                   # scripted mock model, throwaway PI_CODING_AGENT_DIR, scratch repo
```

Manual run behind that recipe (same mock, `MOCK_BUILDER_WRONG_FIRST=1`, `PI_CODING_AGENT_DIR` = scratch):

```text
/fusion "Should we write unit tests?"                       → /tmp/fusion-harness-V0jsVE
  mock log:  FUSION handoff=true files=spec.json,build.json
  output.json decisions: "fusion consumed ICM handoffs before the raw answers: spec.json, build.json (verified)"
  the fuser's session file contains the rendered "# ICM STRUCTURED HANDOFFS" block with both envelopes,
  their ids, files, claims, and the sha256 of architect.md / builder.md
  just icm-verify … → all checks passed

/auto-validate --max-validations 3 "Create hello.txt … exactly the text hello"   → /tmp/fusion-harness-Ben2K3
  round 1: builder writes "hi" (scripted wrong) → gate FAIL (exit 1)
    validation-round-1.json claims: [rejected] "The acceptance gate passed." + [rejected] "FAIL: expected hello.txt containing 'hello', found 'hi', …"
    decisions: "1 FAIL / 0 PASS line(s) parsed into claims"
  round 2: mock log  BUILDER correction attempt=2 diagnostics=true failItems=2
    build-round-2.json decisions: "consumed structured gate diagnostics from validation-round-1.json (verified)"
    gate PASS → output.json validated claim citing validation-round-2.json
  just icm-verify … → all checks passed, incl. "validation-round-N.json — 1 PASS/FAIL line(s) carried as gate-validated claims"
```

Phase 2 exit criterion ("fusion and correction flows operate correctly when given only the structured handoff and referenced artifacts"): the mock fuser and mock builder only *received* the handoff — the mock does not read it. What is demonstrated is that the structured handoff is emitted, verified, delivered first in the prompt, and recorded; that a real model performs *better* with it is a model-quality question the mock cannot answer (see risks).


## Deferred (explicitly out of Phase 1 scope)

- Phase 2 leftovers: the TRIAGE prompt still receives raw gate history only (it could take the same diagnostics block); `/opinion` consumes nothing (by design — it is an A/B read).
- Phase 3 leftovers: no expiry/TTL (only supersede/retract); no repo-tracked `.fusion/` option; promotion applies to `/auto-validate` only by design.
- Phase 4: retrieval from the context index into role projections, compatibility checks, cross-provider fixture runs, any transport (MCP or otherwise). Nothing promoted is read back into any prompt yet.
- Phase 5: access control, audit, telemetry, retention.
- Parsing model prose (requirements, decisions, consensus/divergence) into structured fields. Phases 1–2 only excerpt and hash it; the only structured *content* is what the harness derives from the gate's own PASS/FAIL contract.

## Open risks and decisions needing a human owner

1. **A second ICM implementation exists outside this repo** at `/mnt/e/Kimi_X_OAI_ Fusion Project` (Python, FastAPI, OpenAI×Ollama). Its tests write to `/tmp/fusion-harness-run_*`, the same prefix family this harness uses (`/tmp/fusion-harness-*`). Decide which is canonical; if both live on, one should change its run-dir prefix. This repo's schema deliberately differs from that project's (narrower `kind`, different role/artifact enums), so envelopes are **not** interchangeable today.
2. ~~Phase 0 decisions were taken provisionally~~ — **confirmed by the owner 2026-09-24** (table above). Phase 4 may build retrieval on them.
3. **Pre-existing type errors** in `fusion-harness.ts` (see above) — trivial to fix but outside this change's scope.
4. Local Ollama runs are slow (minutes per child, 8B model on CPU) and the small model ignores tool instructions; the scripted mock (`just icm-mock-e2e`) is now the fast, deterministic plumbing proof. Neither says anything about whether a frontier fuser/builder *uses* the structured handoff well. A `just fh-workhorse` run against the real pair would be the natural next proof and costs real money — not run without approval.
5. **Prompt growth.** The handoff block adds roughly 0.5–2 KB per envelope to the fuser prompt and one line per FAIL to the correction prompt; lists are capped (20 bullets per section, 100 gate claims). Not measured on a real, long gate output yet.
6. **`AGENTS.md` still says "The current objective is Phase 1 only."** Left untouched because it is the user's execution contract; it should now be advanced to Phase 4 (or frozen) by its owner.
7. **The context cache is unlocked and single-user.** Two concurrent `/icm-promote` runs could race on `index.json`. Fine for a local cache; a shared store (Phase 5) would need locking.
