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

# WORKHORSE tier — the cheap pair (sonnet-5 plans · terra builds + hosts). Use for testing.
WORKHORSE_ARCHITECT := "anthropic/claude-sonnet-5"
WORKHORSE_BUILDER := "openai/gpt-5.6-terra"

# STATE-OF-THE-ART tier — the frontier, on-camera pair (fable 5 plans · sol builds + hosts).
SOTA_ARCHITECT := "anthropic/claude-fable-5"
SOTA_BUILDER := "openai/gpt-5.6-sol"

# GROK tier — max-efficiency pair that runs on the keys you actually have
# (haiku plans + fuses · grok-4.6 builds + hosts). No OpenAI key needed.
GROK_ARCHITECT := "anthropic/claude-haiku-4-5"
GROK_BUILDER := "xai/grok-4.6"

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

# GROK tier — max-efficiency pair at low thinking. Runs on anthropic + xai keys.
fh-grok *ARGS:
    pi -e extensions/fusion-harness/fusion-harness.ts \
        --model {{GROK_BUILDER}} \
        --architect {{GROK_ARCHITECT}} --builder {{GROK_BUILDER}} \
        --architect-thinking low --builder-thinking low \
        {{ARGS}}
