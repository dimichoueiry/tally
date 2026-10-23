#!/bin/zsh
# Runs one spike mode with a hard timeout; prints only RESULT lines.
cd "$(dirname "$0")"; mkdir -p out
T=${T:-40}
(./node_modules/.bin/electron . "$@" 2>&1 & pid=$!; for i in $(seq 1 $T); do sleep 1; kill -0 $pid 2>/dev/null || break; done; kill $pid 2>/dev/null; echo "[wall ${i}s]") | grep -E "^RESULT|^\[wall"
