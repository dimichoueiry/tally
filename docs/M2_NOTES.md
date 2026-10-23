# Tally M2 — outcome (LC-7)

Date: 2026-10-21. Machine: M3 Pro, macOS 27.0, Electron 45.0.0. Scope: LC-7 ticket.

## What changed from the plan / spike

- **Blur runs on the GPU delegate** (ARCHITECTURE §5 said CPU; the LC-6 spike reversed that). One segmenter per window, kept for the window's life; switching None/Blur/Image changes a mode only. CPU delegate is the fallback (WebGL2 probe, warm-up > 8 s, or context loss); if the CPU path's rolling median passes 30 ms the bubble shows "Background paused" and the plain camera is drawn.
- **Segment the crop, not the frame.** The bubble's zoomed, face-centred crop (≤ 800 px) is drawn into a canvas and segmented, so all 256 model pixels land on what is shown.
- **Face detector shares the window's MediaPipe runtime** (one bundle, one WASM fileset) and runs at 10 Hz on a 320 px bitmap made asynchronously (`createImageBitmap`), outside the 30 fps frame tick. Moving it off the tick took the engine's tick p95 from ~10 ms to ~1.3 ms.
- **Preview draws once per camera frame** (`requestVideoFrameCallback`). With rAF on the 120 Hz panel it segmented each frame 4×; GPU process CPU went from 84 % to 47 % with blur.
- **System audio goes through an AudioContext** before MediaRecorder, so the recorder's audio track survives a dead loopback track (the recording keeps going, silent, and the bar warns).
- **Finalize no longer needs 2–3× the recording on disk.** Segments are joined in place (resumable after a crash), only the tail is read for repair, and the remux copy is skipped when the disk can't hold it (the fragmented MP4 is kept). Before, a disk-full stop of a large take would have failed with ENOSPC.
- **Stop drain 66 ms → 300 ms.** MediaRecorder dropped 0–2 frames still in the encoder at stop (3 of 7 runs short); 6 of 6 exact after.
- **Window names:** a trailing file extension in a window title is dropped (`notes.md` → `notes`).

## Known gaps

- Windows: no cover helper (row hidden), nothing run.
- The engine and the preview each run a segmenter and a face detector (two processes). Sharing one pass would halve that; not needed on this Mac.
- Clean desktop over Stage Manager, full-screen Spaces, multiple displays: untested.
- Camera unplug/replug and dead system-audio tracks were tested by dispatching the tracks' `ended` events (no external camera here); the reopen path uses a real `getUserMedia`.
