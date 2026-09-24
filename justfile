set dotenv-load := true

# ── fusion-harness ──────────────────────────────────────
# /fusion · /auto-validate · /opinion — fuse two frontier models (AND, not OR).
# The HOST runs on the BUILDER model: raw (non-slash) input IS the builder agent.
#
# Two launch recipes, two tiers — everything else is a flag:
#
#   just fh-workhorse    cheap pair (sonnet-5 plans · terra builds + hosts) — use for testing
#   just fh-sota         frontier pair (fable-5 plans · sol builds + hosts) — the on-camera run
#
# Configuration flags (all optional, appendable to either recipe):
#   --architect <provider/id>              plans/fuses/validates
#   --builder <provider/id>                builds
#   --architect-thinking <level>           EVERY architect-family execution
#   --builder-thinking <level>             EVERY builder execution
#                                          (levels: off|minimal|low|medium|high|xhigh|max)
#   --architect-system-prompt <text|path>  override architect worker/fusion system prompt
#   --builder-system-prompt <text|path>    override builder system prompt
#   --max-validations <n>                  /auto-validate halt cap            default 5
#   --escalate-to-validator-count <n>      validator triage from Nth failure  default 3
#   --child-timeout <seconds>              kill any child agent after N sec   default 28800 = 8h (max 86400)
#
# e.g. just fh-workhorse --architect-thinking high --builder-system-prompt ./persona.md
#      just fh-sota --architect-thinking max --builder-thinking max
#
# Default prompts live in extensions/fusion-harness/{SYSTEM,USER}_PROMPT_*.md — edit to tune.
# Sessions persist per project (/tmp/fusion-harness-sessions) — /fh-reset for fresh memories.
#
# ICM (Phases 1–3): every run writes ContextEnvelope v1 JSON next to its raw artifacts
# (brief/spec/build/validation/output + icm-manifest.json); FUSION and BUILDER correction rounds
# consume them as verified structured handoffs; and a gate-PASS /auto-validate output can be
# promoted — MANUALLY, by you — to a user-level context cache (never the repo):
#   /icm-promote [--assess] <run-dir> [--supersedes ctx_…] [--note text]
#   /icm-context list [validated|superseded|rejected] | show <ctx_id> | retract <ctx_id> <reason>
#   --icm-context-dir <dir>   (default $FUSION_ICM_CONTEXT_DIR or ~/.fusion/context)
# and (Phase 4) promoted VALIDATED context is read back — deterministically, re-verified, labelled
# with its commit's relation to this checkout — into the ARCHITECT/BUILDER/VALIDATOR prompts:
#   --icm-retrieve on|off      (default on)      --icm-retrieve-max N   (1-20, default 5)
# See ICM_IMPLEMENTATION_NOTES.md.
#   just icm-test                    contract tests (schema, fixtures, primitives, emitter, handoffs, promotion)
#   just icm-verify <run-dir>        validate one real run's envelopes, artifact hashes, gate claims
#   just icm-mock-e2e                zero-cost end-to-end proof: /fusion + /auto-validate + /icm-promote, then a second pair of runs that must receive the promoted context (scripted mock model)

# WORKHORSE tier — the cheap pair (sonnet-5 plans · terra builds + hosts). Use for testing.
WORKHORSE_ARCHITECT := "anthropic/claude-sonnet-5"
WORKHORSE_BUILDER := "openai/gpt-5.6-terra"

# STATE-OF-THE-ART tier — the frontier, on-camera pair (fable 5 plans · sol builds + hosts).
SOTA_ARCHITECT := "anthropic/claude-fable-5"
SOTA_BUILDER := "openai/gpt-5.6-sol"

default:
    @just --list

# WORKHORSE tier — cheap pair at medium thinking. Use this for testing.
fh-workhorse *ARGS:
    pi -e extensions/fusion-harness/fusion-harness.ts \
        --model {{WORKHORSE_BUILDER}} \
        --architect {{WORKHORSE_ARCHITECT}} --builder {{WORKHORSE_BUILDER}} \
        --architect-thinking medium --builder-thinking medium \
        {{ARGS}}

# STATE-OF-THE-ART tier — frontier pair at xhigh thinking. The on-camera run.
fh-sota *ARGS:
    pi -e extensions/fusion-harness/fusion-harness.ts \
        --model {{SOTA_BUILDER}} \
        --architect {{SOTA_ARCHITECT}} --builder {{SOTA_BUILDER}} \
        --architect-thinking xhigh --builder-thinking xhigh \
        {{ARGS}}

# ICM hybrid check — ONE real model in the seat that matters, everything else free. The VALIDATOR
# (architect seat) runs on the workhorse Anthropic model; the BUILDER is the scripted mock; retrieval
# reads CONTEXT_DIR. Prerequisites: `just icm-mock-e2e` once (it leaves /tmp/icm-e2e-XXXX with a
# promoted context dir, a scratch repo and a pi agent dir that knows the mock provider), and the mock
# server up: `node tests/icm/mock-model-server.mjs 18081 &`. Run from the scratch repo:
#   cd /tmp/icm-e2e-XXXX/proj && rm -f hello.txt && \
#   PI_CODING_AGENT_DIR=/tmp/icm-e2e-XXXX/pi-agent just --justfile ~/fusion-harness/justfile icm-hybrid /tmp/icm-e2e-XXXX/context
# Add `--icm-retrieve off` for the control. Costs a few cents per run (one validator call).
# NOTE: the harness reuses ONE persistent architect session per project dir, so a second run in the
# same scratch repo RESUMES the first run's session — a control run is only clean in a fresh scratch dir.

# ICM hybrid check: real workhorse VALIDATOR + mock BUILDER, retrieval from CONTEXT_DIR (see the note above; costs cents).
icm-hybrid CONTEXT_DIR *ARGS:
    FUSION_ICM_CONTEXT_DIR={{CONTEXT_DIR}} pi -e {{justfile_directory()}}/extensions/fusion-harness/fusion-harness.ts \
        --model mock/scripted \
        --architect {{WORKHORSE_ARCHITECT}} --builder mock/scripted \
        --architect-thinking low --builder-thinking off --child-timeout 240 \
        {{ARGS}} \
        -p "/auto-validate --max-validations 2 Create hello.txt in the project root containing exactly the text hello"

# ICM BENEFIT test — REAL SPEND on the workhorse pair (roughly one to a few dollars per arm).
# One arm = fresh scratch repo + context dir: stage 1 builds a `ledger` package whose gate enforces
# integer-cents amounts → commit → /icm-promote → role sessions reset → stage 2 asks for a dollars
# CSV export without restating the cents rule. Run each arm, then compare the two report.json files.
# The recipe loads ./.env itself (ANTHROPIC_API_KEY, OPENAI_API_KEY).
#   just icm-benefit on     just icm-benefit off
icm-benefit ARM *ARGS:
    set -a; [ -f .env ] && . ./.env; set +a; node tests/icm/benefit-test.mjs {{ARM}} {{ARGS}}

# ICM contract tests — no pi needed (Node ≥ 22.18 runs the .ts directly).
icm-test:
    node --test 'tests/icm/**/*.test.ts'

# Every contract test: ICM (tests/icm/**) plus the gate helpers (tests/gate.test.ts). No pi needed.
test:
    node --test 'tests/**/*.test.ts'

# Validate the ICM envelopes of one real run dir: schema, artifact hashes, cross-refs, expected kinds.
icm-verify RUN_DIR:
    node tests/icm/verify-run.ts {{RUN_DIR}}

# End-to-end ICM proof with ZERO API spend: a scripted OpenAI-compatible mock plays every role,
# a throwaway PI_CODING_AGENT_DIR keeps ~/.pi untouched, and the runs are verified with icm-verify.
icm-mock-e2e:
    node tests/icm/mock-e2e.mjs
