#!/usr/bin/env bash
# Repeatable throughput benchmark for the local Ollama builder model.
# Usage: bench.sh "<label>" [think:true|false]
set -uo pipefail
LABEL="${1:-run}"
THINK="${2:-false}"
MODEL="qwen3:1.7b"
HOST="http://localhost:11434"
# Representative "builder" prompt: produce a small, concrete code artifact.
PROMPT="Write a Python function add(a,b) that returns a+b. Output only the code."

# Warm (no reload) so we measure steady-state, not load.
curl -fsS "$HOST/api/generate" -d "{\"model\":\"$MODEL\",\"prompt\":\"hi\",\"stream\":false,\"keep_alive\":\"30m\",\"options\":{\"num_predict\":1}}" >/dev/null 2>&1

START=$(date +%s.%N)
RESP=$(curl -fsS "$HOST/api/generate" -d "{\"model\":\"$MODEL\",\"prompt\":\"$PROMPT\",\"stream\":false,\"think\":$THINK,\"keep_alive\":\"30m\"}" 2>/dev/null)
END=$(date +%s.%N)

echo "$RESP" | python3 -c "
import sys,json,os
d=json.load(sys.stdin)
ec=d.get('eval_count',0); ed=d.get('eval_duration',1)/1e9
pc=d.get('prompt_eval_count',0); pd=d.get('prompt_eval_duration',1)/1e9
think_chars=len(d.get('thinking') or '')
wall=float('${END}')-float('${START}')
print(f'[{os.environ.get(\"L\",\"\")}] think=${THINK}')
print(f'  wall:   {wall:.1f}s')
print(f'  gen:    {ec} tok / {ed:.1f}s = {ec/max(ed,1e-9):.2f} tok/s')
print(f'  prompt: {pc} tok / {pd:.2f}s = {pc/max(pd,1e-9):.1f} tok/s')
print(f'  thinking chars: {think_chars}   response chars: {len(d.get(\"response\",\"\"))}')
" L="$LABEL"
echo "  free RAM: $(free -m | awk '/Mem:/{print $7" MB avail"}'), swap used: $(free -m | awk '/Swap:/{print $3" MB"}')"
