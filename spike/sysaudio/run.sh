#!/bin/zsh
# Usage: sysaudio/run.sh unpackaged|packaged [seconds] [loopback|loopbackWithMute]
# Plays Ping.aiff in a loop while capturing, checks default output before/after, runs volumedetect.
cd "$(dirname "$0")"; mkdir -p out
KIND=${1:-unpackaged}; S=${2:-5}; MODE=${3:-loopback}
defout() { system_profiler SPAudioDataType 2>/dev/null | awk '/^        [^ ].*:$/{d=$0} /Default Output Device: Yes/{gsub(/^ +|:$/,"",d); print d}'; }
echo "default output before: $(defout)"
setopt null_glob; before=$(ls out/*.webm 2>/dev/null | wc -l)

if [[ -z $NOTONE ]]; then (while true; do afplay /System/Library/Sounds/Ping.aiff; done) & tone=$!; fi
if [[ $KIND == packaged ]]; then
  # `open` makes the packaged app its own responsible process for TCC.
  open -W -n SysAudioSpike.app --args "$S" "$MODE" ${RAW:+raw} &
  runner=$!
else
  ../node_modules/.bin/electron . "$S" "$MODE" 2>&1 | grep '^RESULT' &
  runner=$!
fi
for i in $(seq 1 $((S + 60))); do sleep 1; kill -0 $runner 2>/dev/null || break; done
kill $runner 2>/dev/null; kill $tone 2>/dev/null; pkill -f 'afplay /System/Library/Sounds/Ping.aiff'
echo "[wall ${i}s]"
echo "default output after:  $(defout)"

f=$(ls -t out/*.webm 2>/dev/null | head -1)
if [[ $(ls out/*.webm 2>/dev/null | wc -l) -le $before ]]; then echo "NO NEW FILE"; tail -5 out/results.log; exit 1; fi
tail -4 out/results.log | cut -c1-400
echo "file: $f"
ffprobe -v error -show_entries stream=codec_type,codec_name,sample_rate,channels -of compact "$f"
ffmpeg -hide_banner -nostats -i "$f" -af volumedetect -f null - 2>&1 | grep -E 'mean_volume|max_volume'
