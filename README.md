# fusion-harness

> **Fuse frontier models instead of racing them. AND, not OR.**
> A standalone [Pi coding agent](https://github.com/badlogic/pi-mono) extension harness for two-model agentic engineering.

📺 Watch this video to get the full breakdown of this codebase: **[GPT-5.6 Sol vs Fable 5 Is the Wrong Question (Fusion) on YouTube](https://youtu.be/AQl5Q-0l7FQ)**

<p align="center">
  <img src="images/hero.png" alt="MODEL FUSION — two model energy streams fusing into one over an engineer's keyboard" width="850">
</p>

<p align="center">
  <img src="images/svg-01-fusion-hero-animated.svg" alt="ARCHITECT (claude-fable-5) and BUILDER (gpt-5.6-sol) streams fusing into one result — AND, not OR" width="850">
</p>

"Which model is best" is a benchmark question, not an engineering question. One model plans, another builds, and the results fuse: you combine compute instead of selecting it. Aider called the pattern [architect/editor](https://aider.chat/2024/09/26/architect.html) (the original fusion); [Devin calls it fusion](https://cognition.com/blog/devin-fusion); [OpenRouter calls it model fusion](https://openrouter.ai/blog/announcements/fusion-beats-frontier/). This repo makes the pattern a first-class, on-camera-clear workflow: two hard-labeled agents, a gate-first validation loop, and attributed fusion. **You don't have to pick a winner when you can hire both.**

---

## Install

### Agentic Install

```bash
claude "/install"   # runs the /install slash command in Claude Code (or Pi, or your favorite agentic coding tool)
```

The `/install` command lives at `.claude/commands/install.md` and handles toolchain checks, key checks, and project-specific setup.

### Manual Install

**Prereqs:** [`pi`](https://github.com/badlogic/pi-mono), [`just`](https://github.com/casey/just), [`jq`](https://jqlang.github.io/jq/), [`uv`](https://docs.astral.sh/uv/).

```bash
npm install -g @earendil-works/pi-coding-agent    # the Pi coding agent
brew install just jq uv                           # task runner, json inspection, gate runner
printf 'ANTHROPIC_API_KEY=sk-ant-...\nOPENAI_API_KEY=sk-...\n' >> .env   # architect + builder keys
just fh-workhorse                                 # launch on the cheap test pair
```

---

## Why this exists

<p align="center">
  <img src="images/video-frames/and-not-or.png" alt="Compute routed to Model A OR Model B (select) versus Compute routed to A + B (AND: combine compute)" width="780">
</p>

Every frontier release restarts the same argument: `GPT-5.6 Sol` or `Fable 5`? Benchmarks crown a winner, teams switch, and next quarter the crown moves. Meanwhile the two models are genuinely different animals: one plans and critiques with more depth, the other ships working diffs faster. Picking one means losing the other's edge on every single task.

<p align="center">
  <img src="images/video-frames/team-vs-lone-wolf.png" alt="Unchecked lone wolf drifting below the quality line versus an architect-builder team with validation checks" width="780">
</p>

The deeper problem is review, the second constraint of agentic engineering. A single unchecked agent drifts below the quality line and nobody catches it until you read the diff. A tight two-agent team validates its own work as it goes: the architect checks the builder, the gate checks them both.

The harness inverts the question. The ARCHITECT model plans, fuses, and validates; the BUILDER model builds; a fusion step merges their independent answers with explicit attribution, and an acceptance gate proves the result. **The wrong question is "which model." The right question is "which role."**

<table align="center">
  <tr>
    <td><img src="images/video-frames/fusion-core.png" alt="Fable 5 and GPT-5.6 Sol linked through a glowing fused-output core" width="390"></td>
    <td><img src="images/video-frames/combined-context-window.png" alt="Fable 5 and GPT-5.6 Sol context windows stacked into one fused context" width="390"></td>
  </tr>
</table>

Used properly, fusion combines the intelligence AND the context windows of your models: two independent thought chains, one merged result.

---

## The three commands

<p align="center">
  <img src="images/svg-03-three-commands.svg" alt="/opinion — side by side, /fusion — merged via a fusion agent, /auto-validate — validator gate + builder loop" width="780">
</p>

One extension file registers three slash commands. Every agent is a spawned `pi --mode json -p` subprocess with a fully qualified `provider/id` model, per-role thinking level, and artifacts under `/tmp/fusion-harness-*` (never inside this repo).

Children are deliberately **clean-room**: every spawn gets `--no-skills --no-extensions --no-context-files`. `--no-extensions` keeps a child from recursively loading this harness; `--no-skills` / `--no-context-files` keep spawns lean and deterministic — each worker's entire contract comes from the harness's prompt files, identical on any machine regardless of what skills are installed. Only the HOST (raw chat) loads your skills and context files; children never do, even the builder children that fork the host session (a fork copies conversation history, but each child rebuilds its own system prompt from its own flags).

| Command | Agents | What happens |
|---|---|---|
| `/opinion <prompt>` | 2 | Both models answer independently (every tool except write/edit). One panel compares them side by side — model, latency, tokens, cost — above both full answers. A pure A/B read. |
| `/fusion "<prompt>" "<fusion-prompt>"` | 3 | ARCHITECT and BUILDER answer in parallel, both with full tools — either can build/render what you asked for. A third FUSION agent (architect model, fresh session, full tools) merges the two per your fusion instruction — default is a critical merge with `[ARCHITECT]`/`[BUILDER]` attribution and a **Consensus & Divergence** close. |
| `/auto-validate <prompt>` | 2 + gate | The auto-validation loop: VALIDATOR designs an acceptance gate BEFORE any work happens, BUILDER builds, the gate runs, failures feed back verbatim until green or halt. Full breakdown below. |

### Same team, three outputs

<p align="center">
  <img src="images/video-frames/fusion-value-ladder-switchboard.png" alt="Value ladder: /opinion gives 2 answers, /fusion gives 1 merged plan, /auto-validate gives a verified build" width="780">
</p>

The three commands are a value ladder on the same two agents. `/opinion` is the scout: two takes, no merge, you choose. `/fusion` is the planning step: the architect merges both takes into one plan. `/auto-validate` is build and test in one: a gate proves the work. Chain them (opinion, then fusion, then auto-validate) and you are running a micro software-development lifecycle inside a single harness.

### /opinion — two perspectives, side by side

<p align="center">
  <img src="images/video-frames/opinion-flow.png" alt="/opinion fanning out to Fable 5 and GPT-5.6 Sol answer panels in parallel — 2 agents total" width="780">
</p>

Both models take your prompt in parallel and the panel lines them up: latency, tokens in/out, cost, and the full answers. You get two unique perspectives no single-model tool gives you, and a free side effect: a running head-to-head of how your models actually perform on your work. **Relativity is the best benchmark.**

### /fusion — merge with attribution

<p align="center">
  <img src="images/video-frames/fusion-command-flow.png" alt="/fusion flow: Fable 5 and GPT-5.6 Sol in parallel into a fresh-session Fusion Architect producing the fused answer — 3 agents total" width="780">
</p>

Both workers execute with full tools, then a third agent (the architect model on a fresh session) reads both raw answers from the run's artifacts dir and merges them per your fusion instruction.

<p align="center">
  <img src="images/video-frames/fusion-provenance-resolver.png" alt="Fable plan and GPT plan resolving into a fused plan with per-line provenance: MERGED, KEPT, KEPT, NEW — 0 dropped" width="780">
</p>

The fused result carries provenance: what both models agreed on (consensus), what only one saw (divergence, kept and attributed), and what got discarded. The divergences are the value: you hired two different engineers precisely so they would not say the same thing.

`/fh-reset` wipes the persistent per-project role sessions when you want fresh agent memories. Pi's built-in `/new` does this automatically on top of its normal fresh-session flow — a new conversation means new role brains too (plain restarts, `/resume`, and forks keep them).

**Press `escape` to stop any running command.** Pi's own escape only aborts *its* agent loop; every agent here is a spawned subprocess, so the harness taps the key itself and kills the whole run — children first, gate included. The panel says you stopped it rather than blaming the models.

`/thinking <architect> [builder]` retunes thinking mid-session — no restart. Omit the builder level to leave it unchanged; run it bare to print the current pair. Canonical or short forms both work (`high` or `hi`, `medium` or `med`, `off` or `none`), so you can type back exactly what the footer shows.

`/system-prompt` shows the system prompt each role runs with — ARCHITECT | BUILDER side by side, zero cost (nothing spawns). Each column is just the prompt text: the `--*-system-prompt` override (inline flag text, or the contents of the file it points to), or pi's actual default prompt when unset — rebuilt exactly as a spawned child gets it. No skills or project-context sections appear in either column because children are clean-room (see above); the host's own prompt, which does carry your skills, is not what this panel shows.

---

## Raw chat IS the builder

<p align="center">
  <img src="images/svg-04-host-as-builder.svg" alt="Host session on the builder model forks builder children; the architect session stays a separate brain" width="750">
</p>

The launch recipes set the Pi host itself to the BUILDER model. Type a plain message and you get the untouched native Pi experience, on the builder's session. Run a slash command and the builder child **forks the host session**, inheriting your raw chats and every prior panel. Chat and commands are the same agent; nothing about vanilla Pi changes.

The ARCHITECT deliberately stays a separate persistent brain (pinned per project **and per model** in `/tmp/fusion-harness-sessions/`). Two independent perspectives is the point of fusion: an architect that inherited the builder's every assumption would just be an echo. Swapping `--architect` or `--builder` mints a separate brain for the new model — a transcript built under one model is never replayed as another model's own history (replaying sonnet-built turns into fable-5 trips Anthropic's usage-policy classifier; see below).

---

## The auto-validation loop

<p align="center">
  <img src="images/svg-05-gate-first-loop-animated.svg" alt="Validator designs gate.py, baseline runs red, builder builds, gate runs — PASS exits, FAIL loops back, halt at cap" width="780">
</p>

Red to green, with the gate designed before the build:

1. **VALIDATOR designs the gate first.** It inspects the project read-only and writes a single Astral `uv` Python script (PEP 723) that exits 0 iff *what you asked for is what got built*. Every explicit requirement maps to a concrete check.
2. **Baseline run must fail RED.** A passing baseline means the gate is weak or the work is already done; either way you hear about it loudly.
3. **BUILDER builds** with full tools. The gate is visible but immutable.
4. **The gate runs.** FAIL lines (`expected X, found Y, at PATH`) feed back verbatim into the builder's session as correction instructions. PASS ends the loop.
5. **Escalation.** From the `--escalate-to-validator-count`-th failure (default 3), the VALIDATOR re-enters as a triage diagnostician; its brief travels with the next correction.
6. **Gate repair.** If triage diagnoses a `GATE DEFECT` — the gate itself is unsatisfiable or checks something never asked for — the VALIDATOR rewrites its own gate (once per run, via the same single-path `write` it authored it with). The old gate is preserved as `gate.py.r<N>`, the repair renders as its own loud panel, and the repaired gate re-runs **immediately without consuming a builder round** — if the build was right all along, the loop ends green right there. The repair contract forbids weakening any legitimate check.
7. **Halt.** After `--max-validations` failures (default 5), development stops with the last gate output rendered loudly. No silent infinite loops.

The builder never grades its own homework, and the grader never touches the code — even the gate repair only ever writes the one path the harness dictates.

---

## Two columns, everywhere

<p align="center">
  <img src="images/svg-06-two-column-dx.svg" alt="Architect column and builder column streaming side by side, full-width fusion row, aligned two-cell footer" width="750">
</p>

Output clarity is the product. The harness mirrors the vanilla Pi experience (tool lines, streaming text, footer) but splits it into two columns it completely controls: ARCHITECT-family left, BUILDER right, aligned across the live widget, the final panels, and the footer.

- Hard role + model labels with one consistent color per role: ARCHITECT ◆, BUILDER ▲, FUSION ⧉, VALIDATOR ✓.
- While children run, a live widget streams each agent's tool calls and text in its own column; the fusion stage renders as a full-width row.
- Final panels render full-height into scrollback, so results scroll like normal messages: no hidden lines behind a toggle.
- The footer is replaced with one aligned cell per model: `◆ ARCHITECT | model (med) | [██--------] 12%` (thinking level + context-window bar).
- Child output is buffered per agent, never interleaved, and failures name the exact role, model, and error.

Every default prompt lives next to the extension as `SYSTEM_PROMPT_*.md` / `USER_PROMPT_*.md` with `{{VARIABLE}}` interpolation. Tune the harness by editing files, not code.

---

## Build your own patterns

<p align="center">
  <img src="images/video-frames/fusion-patterns-gallery.png" alt="Shipped in this video: /opinion, /fusion, /auto-validate. Your turn: /debate, /parallel, /coordinate — your harness, your patterns" width="780">
</p>

The three shipped commands are a starting lineup, not the roster. The same spawn-and-render machinery supports any coordination pattern you can prompt: `/debate` (N rounds, two sides, one verdict), `/parallel` (same task, both models, no merge), `/coordinate` (agents plan together, then split the work). This is harness engineering: your tools directly limit what you believe is possible, and a harness you own is a harness you can extend the same afternoon you think of the idea.

---

## One node in your software factory

<p align="center">
  <img src="images/video-frames/harness-to-factory-zoom.png" alt="Zoom out: the fusion harness is one shipped node of an AI Developer Workflow inside a larger software factory" width="780">
</p>

Zoom out and the whole harness (two agents, three commands, gate loop and all) is a single agent node inside an AI Developer Workflow. Engineers, code, and agents are the three units of value creation; the fusion harness is how one agent slot in that pipeline stops being a lone model and becomes a validated team. Scale your compute to scale your impact.

---

## Folder structure

The extension directory holds ONLY what the harness loads at runtime — the code and the
prompts it reads. Docs live outside it.

```
fusion-harness/
├── README.md                        # this file — the whole harness, docs included
├── LICENSE                          # MIT
├── justfile                         # task runner — just <recipe>
├── .env                             # API keys (never commit this)
│
├── extensions/
│   └── fusion-harness/              # runtime only
│       ├── fusion-harness.ts        # the whole harness — 3 commands, widget, footer, renderer
│       ├── SYSTEM_PROMPT_*.md       # validator + triage contracts
│       ├── USER_PROMPT_*.md         # every default prompt, {{VAR}} interpolated
│       └── icm/                     # ICM ContextEnvelope v1: schema, emitter, verified handoffs, manual promotion, deterministic retrieval (Phases 1–4)
│
├── tests/icm/                       # ICM contract tests, fixtures, run verifier, mock-model e2e (just icm-test / icm-verify / icm-mock-e2e)
├── FUSION_ICM_PLAN.md               # ICM design: envelope contract, lifecycle, phases
├── ICM_IMPLEMENTATION_NOTES.md      # what each ICM phase actually emits/consumes, where, and how it was verified
├── AGENTS.md                        # execution contract for an agent implementing the ICM plan
│
├── live_final_generation/           # artifacts from the on-camera SOTA run (fused bench, gate rounds, manifest)
│
├── images/                          # README visuals
│   ├── svg-*.svg                    # hand-built diagrams (2 animated, 4 still)
│   └── video-frames/                # stills + clean remakes of the video's motion graphics
└── .claude/
    └── commands/
        └── prime.md                 # /prime — orient an agent in this repo
```

---

## Recipes

<p align="center">
  <img src="images/video-frames/model-slot-rack.png" alt="Fusion harness slot rack: Fable 5 in the ARCHITECT slot, GPT-5.6 Sol in the BUILDER slot, Gemini 3.5 Pro day-one in the OPEN slot — role ≠ model" width="780">
</p>

Role ≠ model. Models change quarterly; the harness compounds. Two model tiers are wired in the justfile: **WORKHORSE** (`WORKHORSE_ARCHITECT`/`WORKHORSE_BUILDER`, use for all testing) and **STATE-OF-THE-ART** (`SOTA_ARCHITECT`/`SOTA_BUILDER`, the on-camera pair). The day a new frontier model drops, it slots into either role with one flag.

| Tier | Architect | Builder | Recipe |
|---|---|---|---|
| **WORKHORSE** | `anthropic/claude-sonnet-5` | `openai/gpt-5.6-terra` | `just fh-workhorse` |
| **STATE-OF-THE-ART** | `anthropic/claude-fable-5` | `openai/gpt-5.6-sol` | `just fh-sota` |

Two ways to run it — everything else is a flag.

```
just fh-workhorse       # WORKHORSE tier (use this for testing)
just fh-sota            # STATE-OF-THE-ART tier (fable plans · sol builds + hosts)
```

All flags append to either recipe, e.g. `just fh-workhorse --architect-thinking high --builder-system-prompt ./persona.md`, or `just fh-sota --architect-thinking max --builder-thinking max` to push both roles to max thinking.

<p align="center">
  <img src="images/video-frames/sota-max-artifact-pipeline.png" alt="A full SOTA-tier run: spec → /opinion perspectives → /fusion fused plan → /auto-validate guard iterations → shipped, 6/6 artifacts" width="780">
</p>

That is what a full SOTA run produces end to end: spec in, two perspectives, one fused plan, gated iterations, shipped MVP with evidence. The artifacts from the on-camera run (the fused SQLite benchmark, every gate round, the manifest) live in [`live_final_generation/`](live_final_generation/).

---

## Flags

| Flag | Default | Meaning |
|---|---|---|
| `--architect <provider/id>` | `anthropic/claude-fable-5` | plans / fuses / validates |
| `--builder <provider/id>` | `openai/gpt-5.6-sol` | builds |
| `--architect-thinking <level>` | `medium` | thinking for EVERY architect-family execution (worker/fusion/validator/triage) — `off\|minimal\|low\|medium\|high\|xhigh\|max` |
| `--builder-thinking <level>` | `medium` | thinking for EVERY builder execution — same levels |
| `--architect-system-prompt <text\|path>` | pi default | system prompt for architect worker/fusion agents (VALIDATOR/TRIAGE keep their `SYSTEM_PROMPT_*.md` contracts) |
| `--builder-system-prompt <text\|path>` | pi default | system prompt for all builder agents |
| `--max-validations <n>` | `5` | `/auto-validate`: gate validations before halting (also inline per command) |
| `--escalate-to-validator-count <n>` | `3` | `/auto-validate`: on the Nth failure, VALIDATOR triages the builder's work (also inline) |
| `--child-timeout <seconds>` | `28800` (8h) | timeout for EVERY spawned child (the auto-validate builder never drops below the 8h floor; clamp 10–86400) |

`/fusion` takes its two arguments quoted — `/fusion "prompt" "fusion instruction"` — or separated: `/fusion prompt :: fusion instruction`. With no fusion instruction, the built-in critical merge is used.

---

## Prompts live in files

Every default prompt sits next to the extension with `{{VARIABLE}}` interpolation — tune the harness by editing files, not code.

| File | Used by |
|---|---|
| `SYSTEM_PROMPT_VALIDATOR.md` | gate design (auto-validate step 1) |
| `SYSTEM_PROMPT_TRIAGE.md` | escalation diagnosis |
| `USER_PROMPT_FUSION_WORKER.md` | /fusion ARCHITECT + BUILDER workers |
| `USER_PROMPT_FUSION_MERGE.md` | /fusion FUSION agent (the envelope: both answers + output contract) |
| `USER_PROMPT_FUSION_DEFAULT_INSTRUCTION.md` | fills the merge envelope's `{{FUSION_INSTRUCTION}}` when you don't pass one |
| `USER_PROMPT_OPINION.md` | /opinion both agents |
| `USER_PROMPT_BUILDER.md` · `USER_PROMPT_CORRECTION.md` | auto-validate build + correction rounds |
| `USER_PROMPT_VALIDATOR.md` · `USER_PROMPT_TRIAGE.md` | gate design + triage requests |

## Artifacts

Every run makes `/tmp/fusion-harness-XXXXXX/` with `prompt.md`, one `<role>.md` per agent, `fused.md` / `gate.py` + `gate-output.txt` as applicable, `summary.json`, and each child's throwaway session dir. Nothing is ever written into the repo.

Downstream agents are grounded in this dir instead of hunting the filesystem: the FUSION agent's prompt names the run dir and both raw answer files (`architect.md` / `builder.md` — complete even when the inline handoff was truncated), and the VALIDATOR/TRIAGE prompts name the run dir with its per-round builder reports and gate outputs.

**ICM envelopes (Phases 1–4).** Alongside those raw files every run also writes structured, schema-valid `ContextEnvelope v1` JSON — `brief.json`, `spec.json`, `build*.json`, `validation*.json`, `output.json`, indexed by `icm-manifest.json`. Each envelope records the producing role and model, the repo/branch/commit, a short excerpt, and SHA-256 references to the raw reports it summarizes. Two boundaries consume them as **structured handoffs** (Phase 2): the FUSION agent receives the architect's `spec.json` and the builder's `build.json` before the raw answers, and a `/auto-validate` correction round receives the gate's `PASS:`/`FAIL:` lines as claims from the previous `validation-round-N.json`. Every handoff is re-validated, matched to the run's scope, and hash-checked against its raw artifacts before it is rendered — a stale or tampered envelope is dropped and reported, and the prompt falls back to its Phase 1 shape. The handoff blocks state that envelopes are evidence, not instructions; the raw reports and gate output remain the source of truth, and every envelope is still `status: draft` (promotion is Phase 3). Each panel's footer lists the run's envelopes (`icm: ✓ brief · ✓ spec …`) and what was consumed. **Promotion (Phase 3) is manual and evidence-gated:** `/icm-promote <run-dir>` copies a gate-PASS `/auto-validate` output into a user-level context cache (`~/.fusion/context`, or `--icm-context-dir` / `$FUSION_ICM_CONTEXT_DIR` — never the repository) as `status: validated`, after re-verifying the chain output → validation envelope → gate output (`exit 0`), re-hashing every cited artifact, and refusing anything that still matches a secret pattern. `/fusion` and `/opinion` outputs are never promotable (no independent evidence). `/icm-promote --assess <run-dir>` only reports eligibility; `/icm-context list|show|retract` browses the cache, and nothing is ever deleted — retract and supersede only change status. **Retrieval (Phase 4) is deterministic and labelled:** at the start of every `/fusion` and `/auto-validate` run the harness reads the context index and picks only `validated` entries for the same repository and branch, newest first (`--icm-retrieve-max`, default 5), re-verifies each on disk (schema, index agreement, promotion record not retracted or superseded, every stored artifact's SHA-256), labels each with how its commit relates to the current checkout (`same-commit` · `earlier-commit` · `other-commit` = stale · `unknown-commit`), and renders a role-specific evidence block — `# ICM PRIOR VALIDATED CONTEXT` — into the ARCHITECT/BUILDER worker prompts, the VALIDATOR prompt and the round-1 BUILDER prompt. The block says it is evidence, not instruction. What was retrieved, excluded or withheld (and why) is recorded on the run's `brief.json` and shown in the first result panel's footer. `--icm-retrieve off` disables it; an empty context dir leaves every prompt unchanged. Contract tests: `just icm-test`; validate a real run: `just icm-verify /tmp/fusion-harness-XXXXXX`; zero-cost end-to-end proof on a scripted mock model — two runs, a promotion, then two more runs that must *receive* it: `just icm-mock-e2e`. Design: [`FUSION_ICM_PLAN.md`](FUSION_ICM_PLAN.md); what is actually emitted and consumed: [`ICM_IMPLEMENTATION_NOTES.md`](ICM_IMPLEMENTATION_NOTES.md).

---

## Where it can still fail

<p align="center">
  <img src="images/video-frames/blind-spot-coverage-matrix.png" alt="Blind-spot coverage matrix: Fable 5 covers 4/6 concerns, GPT-5.6 Sol 3/6, the fusion harness 5/6 — more coverage ≠ perfect" width="780">
</p>

Two models cover more blind spots than one, and the matrix is honest about the rest: fusion raises coverage, it does not reach perfection, and a shared unknown stays unknown. The concrete failure modes:

- **`uv` missing or a gate timeout**: gate execution errors halt `/auto-validate` immediately with an attributed error; they never burn correction rounds. Install `uv` before relying on gates.
- **A weak gate**: if the baseline run passes before any work happens, the harness warns loudly and proceeds with suspicion. Treat a first-round pass as a gate defect until proven otherwise.
- **`.env` vs exported shell vars**: `just`'s dotenv-load does NOT override variables already exported in your shell. A stale exported key silently wins over the repo `.env`.
- **Parallel writers share one cwd**: `/fusion`'s two workers run concurrently with full tools, so their prompt requires an identity-in-filename (`-ARCHITECT-<model>`) on everything they create. Two agents told to write the same bare path would race and clobber each other — if you ask for one exactly-named file, let the FUSION merge produce it. (`/opinion` children stay read-only/bash-only: it's an A/B read, not a build.)
- **Stale role memories**: the ARCHITECT session persists per project + model across restarts. If it starts reasoning from an old context, `/fh-reset` gives both roles a clean brain.
- **Anthropic usage-policy blocks on fable-5**: Fable ships stricter safety classifiers, and a long accumulated agent transcript can false-positive — observed when a sonnet-built session (turns saying "you are claude-sonnet-5" + script execution) was replayed into fable-5: every request blocked at the API, even `/opinion hello`, while the same prompt on a fresh session passed. The per-model session keying prevents the cross-model case; if a block ever recurs on a long same-model session, `/fh-reset` (or `/new`) clears it.
- **Headless hosts can't fork**: with `--no-session` (headless runs), builder children fall back to a manifest-pinned persistent session instead of forking the host.

---

## License

MIT — see [`LICENSE`](LICENSE).

---

## Master Agentic Coding

Prepare for the future of software engineering.

Learn tactical agentic coding patterns with [Tactical Agentic Coding](https://agenticengineer.com/tactical-agentic-coding?y=fuhar).

Follow the [IndyDevDan YouTube channel](https://www.youtube.com/@indydevdan) to improve your agentic coding advantage.

---

Stay Focused and Keep Building

- IndyDevDan
