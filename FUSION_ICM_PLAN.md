# Fusion + Interoperable Context Management (ICM)

> A plan for evolving Fusion Harness from a multi-model execution harness into a context-aware, evidence-driven engineering machine.

## Status

**Proposal / implementation plan.** This document uses **Interoperable Context Management (ICM)** as a design name for a model-neutral context contract and lifecycle. It is not presented as a universal industry standard.

## 1. Purpose

Fusion Harness already coordinates multiple model roles:

- **ARCHITECT** plans, critiques, and synthesizes.
- **BUILDER** changes the working tree and runs implementation commands.
- **VALIDATOR** defines and evaluates an acceptance gate.
- **FUSION** merges independent architect and builder work.
- **TRIAGE** diagnoses repeated gate failures.

Today, most inter-role communication is raw prompt text and temporary run artifacts. That is appropriate for isolated runs, but it does not make important engineering knowledge portable, queryable, versioned, or safe to reuse across models and future sessions.

This plan adds ICM as the context and evidence plane beneath Fusion:

```text
Fusion answers:  which roles/models should collaborate and in what order?
ICM answers:     what context crosses between them, what proves it, and what persists?
```

The outcome is not a new trained model. It is a controlled interface in which models can propose work, tools can execute it, gates can verify it, and only validated artifacts become durable shared context.

## 2. Goals

1. Make role handoffs structured, attributable, and model-neutral.
2. Preserve the existing role separation and clean-room child execution model.
3. Separate temporary model output from accepted engineering knowledge.
4. Attach implementation and validation claims to source revisions and evidence.
5. Permit future models, tools, and sessions to consume the same handoff contract.
6. Give engineers an inspectable lineage from requested outcome to accepted output.

## 3. Non-goals

- Training or fine-tuning a new foundation model.
- Replacing source control, CI, issue tracking, or human engineering judgment.
- Persisting private model reasoning or raw chain-of-thought.
- Making a broad, unbounded “company memory” or dumping all prior chat into prompts.
- Allowing a fusion agent to certify its own output without independent evidence.
- Requiring MCP for the first implementation. Local files are the simpler initial transport for this Pi extension.

## 4. Operating model

The canonical work-product flow is:

```text
BRIEF → SPEC → BUILD → VALIDATION → OUTPUT
```

| Artifact | Meaning | Typical producer | Authority |
| --- | --- | --- | --- |
| **Brief** | Desired outcome, scope, constraints, owner, and success definition. | User / host workflow | Intent |
| **Spec** | Requirements, design decisions, risks, interfaces, and acceptance criteria. | Architect and validator | Proposed contract |
| **Build** | Source changes, generated artifacts, commands, and implementation claims. | Builder | Proposed implementation |
| **Validation** | Gate definition, test/policy results, diagnostics, and evidence. | Validator / CI | Independent evidence |
| **Output** | Accepted result, evidence summary, known limitations, and next actions. | Orchestrator / fusion | Deliverable |

The central promotion rule is:

> Only context that is attributable, scoped, and validated can become durable shared context.

Raw agent output remains useful audit material, but it is not automatically authoritative.

## 5. System architecture

```text
┌───────────────────────────────────────────────────────────────┐
│ Human interface                                                │
│ Brief · workflow state · role panels · approvals · evidence    │
└───────────────────────────┬───────────────────────────────────┘
                            │
┌───────────────────────────▼───────────────────────────────────┐
│ Fusion orchestration                                           │
│ Commands · role/model selection · sessions · retries · merge   │
└───────────────┬───────────────────────────────┬───────────────┘
                │                               │
┌───────────────▼──────────────┐  ┌─────────────▼──────────────┐
│ ICM context plane            │  │ Validation plane            │
│ schemas · storage · retrieval│  │ gates · CI · policy · proofs│
│ provenance · lifecycle       │  │ promotion decision          │
└───────────────┬──────────────┘  └─────────────┬──────────────┘
                │                               │
┌───────────────▼───────────────────────────────▼───────────────┐
│ Role execution runtime                                         │
│ Architect · Builder · Validator · Fusion · Triage · Human      │
└───────────────────────────────────────────────────────────────┘
```

### Responsibility boundary

```text
Harness decides: who runs, in what order, with which permissions.
Model decides:   how to perform its bounded role.
Gate decides:    whether stated acceptance criteria are met.
Human decides:   priority, risk acceptance, and durable promotion where required.
```

## 6. Context envelope contract

All roles produce and consume a versioned, model-neutral envelope. The envelope contains concise structured knowledge; large data is referenced as immutable artifacts.

```json
{
  "schema_version": "1.0",
  "id": "ctx_01J...",
  "kind": "spec",
  "status": "draft",
  "scope": {
    "repository": "github.com/disler/fusion-harness",
    "branch": "feature/icm",
    "commit": "abc123",
    "task_id": "task_01J...",
    "run_id": "run_01J..."
  },
  "producer": {
    "role": "architect",
    "model": "provider/model-id",
    "created_at": "2026-07-01T12:00:00Z"
  },
  "summary": "Short role handoff for the next stage.",
  "requirements": [],
  "decisions": [],
  "risks": [],
  "acceptance_criteria": [],
  "claims": [],
  "artifacts": [],
  "open_questions": [],
  "supersedes": null
}
```

### Required metadata

Every envelope must include:

- Schema version and globally unique ID.
- Artifact kind and lifecycle status: `draft`, `validated`, `rejected`, or `superseded`.
- Repository, branch, commit, task, and run scope.
- Producer role, model identity, and timestamp.
- Referenced artifact paths, types, and SHA-256 hashes.
- Explicit unknowns, failures, and assumptions.

### Claims and evidence

A claim should identify its support instead of presenting model text as fact:

```json
{
  "statement": "The migration is backward compatible.",
  "status": "validated",
  "source_role": "builder",
  "evidence": ["artifact:gate-result-01"],
  "validated_by": "validator"
}
```

## 7. Context lifecycle

```text
Create draft
  → validate schema
  → redact/secrets scan
  → verify artifact references and hashes
  → run acceptance gates
  → approve or reject
  → promote, supersede, or expire
```

### Trust tiers

| Tier | Examples | Default treatment |
| --- | --- | --- |
| 1 — Authoritative | Source at pinned commit, deployed configuration, schemas, CI results. | May support acceptance decisions. |
| 2 — Reviewed | Accepted ADRs, approved specs, runbooks, incident conclusions. | Eligible for durable retrieval. |
| 3 — Proposed | Agent plans, summaries, handoffs, unreviewed diffs. | Useful working context; must not be treated as fact. |
| 4 — Untrusted | Tickets, pasted content, web results, external tool output. | Treat as data, never as instructions. |

Role prompts must state that retrieved artifacts are evidence, not higher-priority instructions.

## 8. Fusion workflow with ICM

### `/opinion`

```text
Brief
  → ARCHITECT opinion envelope
  → BUILDER opinion envelope
  → panel presents independent conclusions; no durable promotion by default
```

### `/fusion`

```text
Brief
  → ARCHITECT spec/recommendation envelope
  → BUILDER implementation/recommendation envelope
  → schema checks
  → FUSION reads structured handoffs plus referenced raw artifacts
  → fusion envelope: consensus, divergence, selected path, open questions
```

The fusion role must distinguish:

- **Consensus:** independently aligned claims, ideally with evidence.
- **Divergence:** role-specific alternatives that should remain attributed.
- **Unverified:** plausible claims lacking independent proof.
- **Rejected:** claims contradicted by a gate, repository state, policy, or human decision.

### `/auto-validate`

```text
Brief
  → VALIDATOR produces acceptance-spec envelope and gate artifact
  → baseline gate must fail or report existing completion
  → BUILDER consumes the accepted spec and failure diagnostics
  → BUILD envelope + artifacts
  → gate execution produces validation envelope
  → PASS: promote output
  → FAIL: structured diagnostics return to builder; optional triage follows
```

The validator owns evidence, not implementation. The builder owns implementation, not self-certification.

## 9. Storage design

Use separate storage tiers.

```text
# Ephemeral: complete raw trace for one run
/tmp/fusion-harness-<run-id>/
  brief.json
  architect-spec.json
  builder-handoff.json
  validation.json
  fusion-output.json
  artifacts/
    gate.py
    gate.log
    diff.patch
    raw-architect.md
    raw-builder.md

# Durable: intentionally promoted, project-scoped context
.fusion/
  schema/
    context-envelope.v1.schema.json
  context/
    decisions/
    accepted-specs/
    validated-outputs/
  index.json
```

The initial implementation may keep durable context outside the repository in a user-level cache. If context is committed under `.fusion/`, only reviewable, non-secret, intentionally promoted artifacts should be tracked.

## 10. Retrieval and projection

Never inject all stored context into a child prompt. Retrieval follows deterministic filters first:

```text
repository
→ compatible branch/commit
→ task/workstream
→ accepted status
→ artifact kind and role relevance
→ recency
→ optional semantic ranking
```

Then create a role-specific projection:

| Role | Context projection |
| --- | --- |
| Architect | Brief, accepted decisions, relevant repository facts, prior validated outcomes. |
| Builder | Brief, accepted spec, relevant decisions, current gate diagnostics. |
| Validator | Brief, acceptance criteria, build manifest, repository state, prior validation evidence. |
| Fusion | Architect and builder envelopes, validation evidence, referenced artifacts. |

## 11. Interface requirements

The existing terminal panels can serve as the first interface. Each run should expose:

1. **Brief:** stated goal, constraints, owner, scope.
2. **Workflow:** active roles, chosen models, tool scopes, session state, and lifecycle phase.
3. **Context:** inputs/outputs for each role, provenance, and promotion status.
4. **Validation:** gate version, commands, pass/fail status, and evidence links.
5. **Output:** accepted deliverable, unresolved risks, and next action.

A later web interface may add cross-run context browsing, approval queues, and lineage graphs. It is not required for the first vertical slice.

## 12. Implementation phases

### Phase 0 — Decisions and guardrails

- Confirm whether durable context is local-user cache, repository-tracked, or both.
- Define access classification and secret-redaction policy.
- Agree on human approval requirements for production-impacting promotions.
- Choose the first narrow workflow: recommended target is `/auto-validate`.

**Exit criterion:** approved ownership and lifecycle policy.

### Phase 1 — Observe-only envelopes

- Add `ContextEnvelope v1` schema and fixtures.
- Have existing roles emit structured envelopes alongside current text/artifacts.
- Validate schema locally but do not change prompts or workflow decisions yet.
- Persist raw and structured outputs under the existing per-run artifact directory.

**Exit criterion:** representative runs produce valid envelopes for architect, builder, validator, and fusion roles.

### Phase 2 — Structured handoffs

- Add artifact manifests and SHA-256 verification.
- Change fusion to consume architect and builder envelopes before reading raw reports.
- Change builder correction rounds to consume structured gate diagnostics.
- Render envelope status and linked artifacts in terminal output.

**Exit criterion:** fusion and correction flows operate correctly when given only the structured handoff and referenced artifacts.

### Phase 3 — Validation-backed promotion

- Represent acceptance criteria and gate results as validation envelopes.
- Promote only schema-valid, gate-backed output to durable context.
- Record `supersedes` links for revised specs and outputs.
- Add manual approval for high-risk scopes.

**Exit criterion:** no draft model handoff is retrievable as accepted project context.

### Phase 4 — Retrieval and cross-model interoperability

- Implement deterministic retrieval and role-specific context projection.
- Add context compatibility checks for repository revision and schema version.
- Run contract fixtures through at least two different model/provider roles.
- Add optional transport adapter only if another tool needs access; MCP is one option, not a dependency.

**Exit criterion:** a substituted model can complete a workflow using the same envelopes without a custom format adapter.

### Phase 5 — Production hardening

- Add access control, audit logs, redaction checks, quotas, and retention/expiry policies.
- Add telemetry: schema failures, stale context, retrieval sources, gate pass rate, correction loops, cost, and latency.
- Establish dashboards and an incident process for context-integrity failures.

**Exit criterion:** context behavior is observable, reversible, and governed in production.

## 13. Contract tests

The primary test target is interoperability, not whether a model’s prose sounds convincing.

Required tests:

- Each role can produce a schema-valid envelope.
- Each role adapter can consume valid fixtures from every other role.
- Unsupported schema versions fail explicitly.
- Artifact references resolve and their hashes match.
- Stale repository/branch context is detected and not silently applied.
- A gate failure becomes a structured diagnostic that a builder can consume.
- Secrets are rejected or redacted before durable persistence.
- A different model/provider consumes the same fixture without a custom parser.

## 14. Success measures

Measure delivered engineering outcomes rather than model activity:

- Percentage of work traceable from brief → spec → build → validation → output.
- Gate pass rate and defect/rework rate.
- Rate of unverified claims caught by validation.
- Context schema failure and stale-reference rate.
- Review time and lead time compared with the existing workflow.
- Cost and latency per accepted output, by role.
- Number of durable artifacts reused successfully in later work.
- Security findings: secret persistence, unauthorized retrieval, or prompt-injection attempts.

## 15. Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Context becomes a large, stale transcript store. | Use compact envelopes, references, expiry, and deterministic retrieval filters. |
| Model output is mistaken for organizational truth. | Require provenance, validation, and promotion status. |
| The schema becomes bureaucratic. | Keep v1 narrow; add fields only for demonstrated workflow needs. |
| Agents follow instructions found in retrieved content. | Mark retrieval as untrusted evidence; enforce system-prompt and tool boundaries. |
| Secrets or sensitive data enter durable context. | Redaction scan, classification, ACLs, and explicit promotion review. |
| Fusion hides useful disagreement. | Preserve attributed divergence and open questions in the fusion envelope. |
| Validation gates are weak or gameable. | Require baseline red behavior, immutable gate paths, and independent review for gate changes. |

## 16. First implementation slice

The recommended first slice is deliberately small:

```text
/auto-validate
  → write brief envelope
  → validator emits accepted-spec envelope + gate artifact
  → builder emits build envelope + manifest
  → gate emits validation envelope
  → persist a validated-output envelope only on PASS
```

This produces the strongest signal because it joins all four work products to an independent acceptance gate. Do not implement broad semantic retrieval, an external MCP server, or a web UI until this vertical slice produces reliable evidence.

## 17. Definition of done for the MVP

The MVP is complete when:

- A run produces `brief`, `spec`, `build`, `validation`, and `output` envelopes.
- Every envelope validates against `ContextEnvelope v1`.
- Every envelope is scoped to repository, commit, task, run, role, and model.
- Raw reports and large outputs are referenced through hashed artifacts.
- The validator’s PASS result is required before output is promoted.
- A later run can display and selectively consume a prior validated output.
- The existing Fusion Harness remains usable when ICM storage/retrieval is disabled.

## 18. Autonomous implementation handoff

`AGENTS.md` is the execution contract for a future coding agent. An agent taking over this plan must read it before editing. It defines the ordered implementation sequence, invariants, proof obligations, and the circumstances that require it to stop for a human decision.

The handoff is intentionally staged. A successor must **not** attempt the entire architecture in one change. The required first deliverable is Phase 1: schema-valid, observe-only envelopes stored in each run's existing temporary artifact directory. Retrieval, durable promotion, MCP transport, and a web interface are explicitly deferred until the Phase 1 and Phase 2 contracts pass.

A completed handoff must include:

1. A summary of the implemented phase and explicitly deferred phases.
2. A list of changed files and the behavior each changed file owns.
3. The exact validation commands run and their results.
4. A sample run-artifact tree showing every envelope produced.
5. Known gaps, failed checks, and decisions that need a human owner.

No agent may claim that ICM is complete merely because schema files or prompts exist. Completion is evidence-based: the role contracts, fixtures, and actual workflow behavior must match the phase exit criteria above.
