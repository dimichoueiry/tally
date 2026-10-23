# Tally M1 — build plan (LC-5)

Date: 2026-10-21. Scope: the core recording loop on macOS. Sources of truth: `design/DESIGN_SPEC.md` (UX), `docs/ARCHITECTURE.md` (capture).

## 1. What I understood

- A menu-bar app. The tray icon opens a **launcher popover** (Display | Window source picker with thumbnails, Camera / Quality options, Record).
- **Record** (or ⌥⇧R) → **3 s countdown** on the target (frame + tag, Space = start now, Esc = cancel) → recording.
- While recording: a **camera bubble** window (preview, draggable, hover HUD), a **control bar** (Stop, Pause/Resume, Restart, Cancel, Camera) and a red tray icon with elapsed time.
- Restart / Cancel show an inline confirm in the bar and **pause the recording** while shown (D3). Keep going resumes, or returns to paused if it was already paused.
- Stop → the file is finalised into `~/Movies/Tally/YYYY-MM-DD HH.MM <Source>.mp4` → **after-stop popup** (rename inline, Show in Finder, Open, Delete with Undo). It stays until ×/Esc or the next countdown (D7).
- A **Recordings** window lists the folder grouped by day, with rename / open / reveal / delete and an empty state.
- No microphone anywhere. `getUserMedia({ video, audio: false })` only.

## 2. Approach

### Capture and the bubble (ARCHITECTURE §3–4)
- A hidden **engine** renderer calls `getDisplayMedia`. Main answers through `setDisplayMediaRequestHandler` with the chosen `desktopCapturer` source, `audio` omitted.
- The camera is **composited into the output canvas in both modes**. The on-screen bubble is a live preview window with `setContentProtection(true)`, so its hover HUD never reaches the video.
  - Note on the ticket wording ("the bubble is a real window that appears in the capture"): the spec says "the bubble is composited", and ARCHITECTURE §4 picks compositing because a real window is not captured in Window mode. I follow the spec + ARCHITECTURE. The result is the same for the viewer: the bubble is in the video, the controls are not.
- Every Tally window (popover, bubble, countdown, bar, popup) is content-protected **at creation, before `getDisplayMedia`** (ARCHITECTURE §6.3).
- The bubble's screen position is sent to the engine. It is mapped into capture pixels:
  - Display: `(bubble − display.bounds) × (videoWidth / display.width)`.
  - Window: `(bubble − window.bounds) × (videoWidth / window.width)`.
- Window bounds of other apps: Electron has no API. A tiny Swift helper (`native/winbounds`) prints `CGWindowListCopyWindowInfo` bounds for a window id, as JSON lines, polled every 250 ms. No permission needed for bounds. On other OSes the provider returns `null` and the bubble falls back to the capture's bottom-left inset (seam for Windows).
- Window-mode constraint (D4): a pure function clamps the bubble inside the window with the 24 pt inset and steps XL → L → M → S, or hides it if S doesn't fit.

### Fixed 30 fps clock
- The compositor draws into a canvas whose stream is `canvas.captureStream(0)`. Each tick calls `track.requestFrame()`, so **exactly one frame per tick**.
- The tick comes from a Worker timer (Workers are not throttled) and is drift-corrected: frame *n* is due at `t0 + n·33.33 ms`. If a tick is late, the next one is scheduled from the target, not from now.
- A still screen still produces a frame each tick (the `<video>` keeps its last frame), so the output is constant 30 fps.
- Output size: 1080p by default (height ≤ 1080, even dimensions), or Native.

### Segment writing and repair
- MediaRecorder (`video/mp4;codecs=avc1.640033`, H.264, fragmented MP4) emits a chunk every 1 s. Chunks go over IPC to main and are **appended to segment files** `seg-00001.part`, rotated every 5 s:
  `~/Movies/Tally/.tally/sessions/<id>/seg-00001.part … + session.json`.
- Concatenating segments in order reproduces the recorder's byte stream exactly, so segment boundaries do not need to match MP4 box boundaries.
- **Stop:** concat → `fragmented.mp4` → remux (`ffmpeg -c copy -movflags +faststart` if ffmpeg is on PATH; otherwise keep the fragmented file, which QuickTime plays, ARCHITECTURE §3.3) → move to the final name → delete the session dir.
- **Repair on next launch:** any session dir without `done` is recovered:
  1. Concat segments.
  2. Walk top-level MP4 boxes in JS. Keep `ftyp` + `moov` and every complete `moof`+`mdat` pair; cut the tail at the first incomplete box or orphan `moof`.
  3. Remux as above and save as `<date> <source> (recovered).mp4`.
  4. If there is no `moov` (crash in the first second), the session is discarded.
- **Restart / Cancel:** delete the session dir. Restart starts a new session and re-runs the countdown.

### State machine (main/session/machine.js, pure)
`idle → countdown → recording ⇄ paused`, `recording|paused → confirm(restart|cancel, resumeTo) → recording|paused` (Keep going) or `→ countdown` (restart) / `→ idle` (discard), `recording|paused → finalizing → idle`. Elapsed time = sum of recording intervals.

### Shortcuts (spec §4, D2)
- ⌥⇧R registered at launch, never unregistered until quit: start in idle, stop when recording/paused/confirm.
- ⌥⇧P/Z/X/C registered when the first frame is recorded, unregistered on stop / discard / error. They stay registered across a Restart's countdown.
- Failure → a one-time banner in the popover.
- Registration logic lives in a small class with an injected `globalShortcut`, so it is unit-tested.

### Permissions
- `systemPreferences.getMediaAccessStatus('screen')` is checked before **every** `desktopCapturer.getSources` call (popover open, ⌥⇧R, start). If not `granted`, show the Screen Recording window from `07b` and do not call `getSources` (it hangs).
- Camera: `askForMediaAccess('camera')` only when the Camera switch is first turned on. Denied → "Camera is blocked" and "Record screen only".

### Library and naming
- Default name `YYYY-MM-DD HH.MM <Source>`; source = display label ("Built-in") or the window's app/title.
- Rename: strip `/ : \ * ? " < > |` and control chars; conflict → suggest "<name> 2", "<name> 3"….
- Delete with undo: the file is moved to `.tally/pending-delete/` (same volume, instant), and is trashed with `shell.trashItem` when the popup is dismissed. Undo moves it back to the same path. Pending items left by a crash are trashed on next launch. (Electron's `trashItem` does not return the Trash path, and reading `~/.Trash` needs Full Disk Access, so a direct trash can't be undone reliably.)
- Metadata (duration, quality, camera on, thumbnail) is kept in `.tally/meta.json` keyed by **inode**, so Finder renames keep it. Duration for other files is read from the MP4 `mvhd`.

## 3. File layout

```
app/
  package.json              electron 45.0.0 (dev), geist fonts copied in; no other runtime deps
  native/winbounds.swift    window bounds helper (built by npm run native)
  scripts/                  make-icons.js, run-dev.sh
  src/main/                 index.js, windows.js, ipc.js, tray.js, settings.js, shortcuts.js,
                            permissions.js, sources.js, protocol.js, winbounds.js
  src/main/session/         machine.js, controller.js, segments.js, mp4.js (box walk + repair), finalize.js
  src/main/library/         names.js, store.js, pendingDelete.js
  src/preload/index.js      contextBridge API (one per window, keyed by window role)
  src/renderer/             app:// served. shared/ (tokens.css copied verbatim, base.css, icons.js,
                            bubbleShapes.js, bubbleGeometry.js), launcher/, bubble/, countdown/,
                            bar/, popup/, library/, permission/, engine/
  test/                     node:test unit tests
```

- **Plain JavaScript (ESM in renderers, CommonJS in main)** instead of the TypeScript + electron-vite in ARCHITECTURE §8. Reason: zero build step and no bundler to debug in M1. Seam: files are small, so moving to TS later is mechanical.
- Renderers load through a custom `app://` protocol (`protocol.handle`), which gives ES modules and `fetch` for M2's MediaPipe assets.
- Fonts: Geist + Geist Mono woff2 from the `geist` npm package, bundled. No network at runtime.

## 4. Dependencies

- `electron@45.0.0` (pinned, as in the spike). Install needs Node ≥ 22.12; this Mac has 22.11, so the install script runs under `npx -p node@22.20.0`.
- `geist` (fonts only, copied at build).
- ffmpeg is **optional** at runtime (remux to faststart). Packaging a remuxer is M2.

## 5. Risks

1. **Composited-bubble position vs. the preview** can be off by a frame while dragging. Acceptable.
2. **Face-centred zoom** needs a face detector. With no background segmentation in M1, I try Chromium's Shape Detection `FaceDetector` (Vision-backed on macOS). If it is unavailable, the crop centres on the frame (the spec's fallback).
3. **Window moved/resized mid-recording:** the track size changes. The compositor reads the size every frame and letterboxes into the fixed canvas.
4. **Two camera opens** (preview + engine). The OS shares the device (ARCHITECTURE §4).
5. **Timing jitter** in MediaRecorder: frames carry capture timestamps; verified by ffprobe frame count / duration.
6. Untested here: multiple displays, Windows.

## 6. Outcome (2026-10-21)

What changed from the plan while building:
- **Fixed clock implementation.** `canvas.captureStream(0)` + `requestFrame()` lost ~3.5 % of ticks (frames coalesce when the engine thread stalls). The compositor now writes one `VideoFrame` per tick into a `MediaStreamTrackGenerator`, catching up with repeated frames after a stall, and finalize stamps frame N at N/30 s (`ffmpeg -bsf:v setts`, copy only; safe because Chromium's H.264 has no B-frames). Result: constant 30 fps, frame count = ticks within 1–2 frames.
- **Pause/resume** waits for MediaRecorder's `pause`/`resume` events and drains pending frame writes; without that ~4 frames were lost per resume.
- **Keyframe interval 1 s** (`videoKeyFrameIntervalDuration`): Chromium only emits a fragment per GOP (~3 s by default). Now a chunk/fragment per second, so a crash loses ≤ ~1 s.
- **Repair salvages a cut fragment**: the last, truncated `moof`+`mdat` is rebuilt with its `trun` trimmed to the samples on disk.
- **Face-centred zoom** uses MediaPipe's BlazeFace short-range detector (Chromium's Shape Detection `FaceDetector` is not exposed in Electron 45).
- **Overlays are non-activating panels** (`type: 'panel'`): the countdown, bar and popup take key focus without deactivating the app being demoed.

Left for M2 (spec items not built in M1): Background None/Blur/Image (seam: `drawBubble` takes any source), clean-desktop cover, system audio, 60 fps, "Switch to display" after a window closes (M1 offers Resume / Stop & save), disk-low banner with minutes left and auto-stop when full, camera-unplugged toast, Settings window, multi-display testing, light theme, Windows.
