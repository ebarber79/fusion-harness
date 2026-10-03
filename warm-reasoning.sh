#!/usr/bin/env bash
# Warm the local reasoning model so the first /fusion or /opinion turn is fast.
# The ARCHITECT role defaults to ollama/qwen3.6:latest (a 23GB model); loading it
# on the first request can otherwise take >60s.
set -euo pipefail
MODEL="${1:-qwen3:1.7b}"
HOST="${OLLAMA_HOST:-http://localhost:11434}"
echo "Warming ${MODEL} on ${HOST} ..."
curl -fsS "${HOST}/api/generate" \
  -d "{\"model\":\"${MODEL}\",\"prompt\":\"ok\",\"stream\":false,\"keep_alive\":\"30m\"}" \
  >/dev/null
echo "Warm. (${MODEL} will stay resident ~30m via keep_alive.)"
