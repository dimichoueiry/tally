# LoomClone: Architecture & Capture Plan

Status: proposal, v1. Date: 2026-10-21. Spike evidence: `spike/` (see §7).

Every claim in this document carries one of three tags:

- **[V]** Verified. I ran it on this Mac (M3 Pro, macOS 27.0, Electron 45.0.0 / Chromium 156).
- **[D]** Documented. I read it in official docs, or in an issue, forum or blog post. The URL is given.
- **[A]** Assumption. Not verified. Treat it as a risk until tested.

---

## 1. Recommendation (TL;DR)

**Use Electron 45 + TypeScript, packaged with electron-builder: `.dmg` on Mac, NSIS `.exe` on Windows.**

- **Capture.** List sources with `desktopCapturer.getSources`, then open the chosen one with `getDisplayMedia` through `session.setDisplayMediaRequestHandler`.
- **Encoding.** One hidden **engine renderer** composites the frames on a canvas and records them with `MediaRecorder`. Chromium encodes **H.264 MP4 directly**, so we need no ffmpeg to record.
- **Camera bubble.** In **both** modes (full screen and single window), the camera is **composited into the recording**. The on-screen bubble is a live, draggable preview and is excluded from capture with `setContentProtection(true)`. This gives one code path, the same output on both OSes, and hover controls on the bubble never leak into the video.
- **Background blur.** MediaPipe `@mediapipe/tasks-vision` ImageSegmenter with the `selfie_segmenter` model on the **CPU delegate**. Measured cost: ~12 ms/frame **[V]**.
- **Clean desktop.** No system-setting changes. A small native **cover helper** process draws a solid or wallpaper window just above the desktop icons and below all app windows. It exits by itself when the app dies.
  - macOS version: Swift, verified **[V]**.
  - Windows version: C++/C#, same contract, **unverified [A]**.
- **Control bar.** A normal Electron window with `setContentProtection(true)`. Verified excluded from Electron's own capture on macOS **[V]**. On Windows the docs say WDA_EXCLUDEFROMCAPTURE removes it **[D]**.

Why: Electron gives us one Chromium engine on both OSes. That one engine covers source picking, MP4 encoding, getUserMedia, WebGL/WASM for MediaPipe, and transparent always-on-top windows. ~~Loom's own desktop app is Electron~~ **Correction (2026-10-21):** only Loom's *legacy* desktop app was Electron, with one OS window per UI piece (https://www.atlassian.com/blog/loom/behind-the-scenes-building-loom-for-desktop) **[D]**. Electron is still our choice for the reasons above. Everything risky on macOS was proven in a few hundred lines (§7). Windows is the main unproven half.

---

## 2. Alternatives considered

| | **Electron (recommended)** | **Tauri v2** | **Native (Swift + C#/WinUI)** |
|---|---|---|---|
| Pick screen vs window | `desktopCapturer.getSources` returns screens and windows with thumbnails. Took 340–550 ms for 23 sources **[V]**. | Nothing built in. WKWebView `getDisplayMedia` has failed in Tauri (https://github.com/tauri-apps/tauri/issues/2338) **[D]**. Would need Rust capture: `scap` is self-described WIP, 0.1.0-beta (https://github.com/helmerapp/scap) **[D]**. | ScreenCaptureKit `SCContentSharingPicker` / `SCShareableContent`. Windows.Graphics.Capture `GraphicsCapturePicker` **[D]**. Best control. |
| Quality / fps | Native Retina 3024×1964 at ~27 fps, and window 2998×1736 at ~29 fps, both with a 30 fps target **[V]**. | Depends on the Rust crate. | Best: full control of fps, HDR, cursor. |
| Output format | MP4/H.264 straight from MediaRecorder (`video/mp4;codecs=avc1.640033` supported) **[V]**. WebM VP8/VP9 also available **[V]**. | WebKit (Mac) and WebView2/Chromium (Win) differ, so two encoders to test. Native path needs VideoToolbox/Media Foundation or ffmpeg. | AVAssetWriter / Media Foundation. Two implementations. |
| Camera + blur | getUserMedia + MediaPipe WASM, same engine on both OSes **[V on Mac]**. | Works in webviews, but WebKit vs Chromium differences double the test matrix **[A]**. | Vision `VNGeneratePersonSegmentationRequest` on Mac, a separate solution on Windows. |
| Transparent bubble window | `transparent: true, frame: false` worked **[V]**. | Needs `macOSPrivateApi`. Reports of white windows in built DMGs (https://github.com/tauri-apps/tauri/issues/13415) **[D]**. | Trivial. |
| Exclude control bar from capture | `setContentProtection(true)` works in Electron's own capture on Mac **[V]**. | `set_content_protected` exists (https://docs.rs/tauri/latest/tauri/webview/struct.WebviewWindow.html) **[D]**. Whether our own capture honours it depends on the crate **[A]**. | SCContentFilter `excludingWindows` (exact) / WDA_EXCLUDEFROMCAPTURE. |
| Installer | electron-builder dmg + NSIS. ~258 MB unpacked runtime **[V: `du` of Electron.app]**. | Small (~10–20 MB) **[A]**. | Two projects, two pipelines. |
| Effort / risk | **Low.** Capture, encode, camera and blur already work in the spike. | **High.** The capture and encoding stack is what we would have to build. | **Highest.** Two codebases for one user. |

**Verdict.** The 250 MB size and the RAM use are the price of Electron. For a single-user tool that replaces a subscription, that is fine. Tauri saves disk but moves the hardest part (capture + encode) into immature crates and splits the engine across WebKit and Chromium. Native is the quality ceiling, but it is two apps.

---

## 3. Capture architecture

```
┌──────────── main process ────────────┐
│ sources (desktopCapturer)            │
│ setDisplayMediaRequestHandler ──────────┐ picks the source the user chose
│ session state machine                │  │
│ fileSink (stream chunks to disk)  ◄──────── IPC: Blob chunks every 1 s
│ cleanDesktop → spawns cover helper   │  │
│ library (list / rename / delete)     │  │
└──────────────────────────────────────┘  │
        ▲ IPC                             ▼
┌─ control bar ─┐  ┌─ bubble window ─┐  ┌──────── engine (hidden renderer) ────────┐
│ start/stop/   │  │ preview only    │  │ getDisplayMedia(screen|window)           │
│ pause/restart │  │ camera+blur     │  │ getUserMedia(camera) → segmenter → blur  │
│ contentProt.  │  │ contentProt.    │  │ canvas: screen frame + shaped bubble     │
└───────────────┘  │ drag → position │  │ canvas.captureStream(30) → MediaRecorder │
                   └────────┬────────┘  └──────────────────────────────────────────┘
                            └── bubble bounds/shape/size/zoom via main ──┘
```

### 3.1 Picking screens vs windows
- `desktopCapturer.getSources({types:['screen','window'], thumbnailSize})` returned 1 screen and 22 windows in ~350 ms, each with a thumbnail, for our own picker UI **[V]**.
- The engine then calls `getDisplayMedia()`. The main-process handler answers with the chosen source **[V]**. API: https://www.electronjs.org/docs/latest/api/desktop-capturer, https://www.electronjs.org/docs/latest/api/session **[D]**.
- Window capture records only that window, with no menu bar or Dock, at the window's own size (2998×1736) **[V]**.
- Electron on macOS 14.4+ captures through ScreenCaptureKit (https://github.com/electron/electron/pull/41397) **[D]**.
- Untested: minimized windows, windows on other Spaces, and a window resized mid-recording. The track size changes, so the compositor must adapt each frame **[A]**.
- `useSystemPicker` (macOS 15+) exists but is experimental, and it bypasses our handler **[D]**. Do not use it in v1.

### 3.2 Quality and frame rate
- Full screen: 3024×1964 (native Retina, `screenPixelRatio: 2`), H.264 High profile, 134 frames in 5.0 s (≈27 fps), ~6.6 Mbit/s at an 8 Mbit/s target **[V]**.
- Window: 2998×1736, 144 frames in 5.0 s (≈29 fps) **[V]**.
- Composited (window + bubble): 136–140 frames in 5 s (≈27–28 fps) driven by `setInterval`. Canvas compositing cost 0.24 ms/frame **[V]**.
- Plan: default 30 fps, and cap the long edge to 2560 px (setting: Native / 1440p / 1080p) to keep files sane **[A: sizing to be tuned]**.
- Frame pacing: drive the compositor from `requestVideoFrameCallback` on the screen video, or from `MediaStreamTrackProcessor` in a Worker with `OffscreenCanvas`. Use `setInterval` only as a fallback. `rAF` does not run in a hidden window **[A, well known; not measured here]**.
- 60 fps is untested **[A]**.

### 3.3 Output format: MP4, no ffmpeg needed to record
- `MediaRecorder.isTypeSupported` returned true for `video/mp4;codecs=avc1.640033`, `avc1`, `video/mp4`, `video/webm;codecs=vp9` and `vp8` **[V]**.
- Output is **fragmented MP4** (`ftyp moov moof mdat moof mdat …`) **[V]**.
  - ffprobe reports a 5.01 s duration. AVFoundation reports `duration=5.13s playable=true` **[V]**, so QuickTime and macOS play it.
  - Chrome's MP4 has no duration in `moov`, and some players (e.g. Windows Media Player) seek badly (https://blog.addpipe.com/duration-in-mp4-files-produced-by-chrome-safari/) **[D, 3rd-party]**.
- Finalize step: remux to regular MP4 with `+faststart`. `ffmpeg -c copy -movflags +faststart` took a negligible time and kept the size (4,108,107 → 4,108,583 bytes) **[V]**.
  - Prefer a pure-JS remuxer (e.g. mediabunny / mp4box.js) so we don't ship ffmpeg. That is **[A]** until tested. Fall back to bundling a static ffmpeg (~30–80 MB, GPL/LGPL build to choose) **[A]**.
  - The fragmented format is also a feature: if the app crashes mid-recording, the chunks already on disk still play **[A]**.
- **Pause** uses `MediaRecorder.pause()/resume()`. In the 1 s pause test, output timestamps had no gap (5.0 s of video from 6.0 s wall clock) **[V]**.
- **Restart** discards the temp file and starts again. **Stop** finalizes, then moves the file into the library folder.
- Chunks are streamed to disk every 1 s through IPC, never held in RAM. The spike buffered in RAM, which is fine for 5 s only.

### 3.4 Permissions (macOS TCC)
- In the spike, Screen Recording was **already granted**, inherited from Terminal, the responsible process **[V: `getMediaAccessStatus('screen') = granted`]**. The Camera prompt appeared on first `getUserMedia`; you clicked Allow, and the status went from `not-determined` to `granted` **[V]**.
- A **packaged app gets its own TCC entries**, so the first run will prompt again **[D/A]**.
  - Camera: `systemPreferences.askForMediaAccess('camera')` plus `NSCameraUsageDescription` in Info.plist (https://www.electronjs.org/docs/latest/api/system-preferences) **[D]**.
  - Hardened runtime needs `com.apple.security.device.camera` **[A, standard; not re-verified]**.
  - Screen: cannot be requested programmatically. Detect `getMediaAccessStatus('screen') !== 'granted'` and deep-link to `x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture`. The app usually needs a relaunch after the grant **[A]**.
  - macOS 15+ re-prompts screen recording about monthly (https://9to5mac.com/2024/08/14/macos-sequoia-screen-recording-prompt-monthly/) **[D, 3rd-party, 2024]**. Behaviour on macOS 27 is unknown **[A]**.
- **TCC grants are tied to the code signature.** Ad-hoc-signed rebuilds lose permissions (https://developer.apple.com/forums/thread/795739) **[D]**. In development, sign with one stable certificate, or you will re-grant after every build.

### 3.5 Code signing and notarization
- This Mac has **0 code-signing identities** (`security find-identity -v -p codesigning`) **[V]**.
- Option A ($99/yr Apple Developer Program): Developer ID + hardened runtime + `notarize: true` in electron-builder. Credentials go in `APPLE_API_KEY`/`APPLE_API_KEY_ID`/`APPLE_API_ISSUER` (https://www.electron.build/docs/notarization) **[D]**. You get a clean `.dmg` install, and permissions survive updates.
- Option B (free, personal use): ad-hoc signed. electron-builder does this automatically on Apple Silicon **[A]**.
  - Gatekeeper blocks first launch. Since macOS 15 there is no Control-click bypass; you must approve in System Settings › Privacy & Security (https://developer.apple.com/news/?id=saqachfa) **[D]**.
  - Each update may reset Camera/Screen grants **[D, see above]**. Workable for one user, but annoying.
- Windows: an unsigned NSIS installer triggers SmartScreen ("More info → Run anyway") **[A, standard]**. Optional: Azure Artifact Signing, ~$9.99/mo; individuals are eligible in the US and Canada only (https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/code-signing-options) **[D]**.

### 3.6 Windows support
Everything in this section is **[D]/[A]**. Nothing was run on Windows.
- `desktopCapturer`, `getDisplayMedia`, MediaRecorder, getUserMedia and MediaPipe are the same Chromium code paths **[A]**.
- Whether Chromium uses Windows.Graphics.Capture by default, and whether a yellow capture border shows, is **unknown**. Removing the WGC border needs a separate consent and capability (https://learn.microsoft.com/en-us/uwp/api/windows.graphics.capture.graphicscapturesession.isborderrequired) **[D]**.
- H.264 MP4 encoding on Windows (Media Foundation) is assumed but unverified **[A]**. Fallback: WebM/VP9, then remux.
- Permissions: Windows 11 has a camera privacy toggle but no screen-capture prompt for desktop apps **[A]**.

---

## 4. Camera bubble

**Recommendation: always composite, show the preview window, and exclude it from capture.**

- **Bubble window.** Frameless, transparent, `alwaysOnTop('screen-saver')`, `setVisibleOnAllWorkspaces(true, {visibleOnFullScreen:true})`, draggable. It renders the camera with the shape, size, zoom and blur, so you see exactly what gets recorded. It has `setContentProtection(true)`.
  - Spike: a circle-masked 240 pt window with transparent corners showing FaceTime HD at 640×640@30 **[V]**.
- **Engine** draws the same camera image into the output canvas, at the bubble's position mapped into capture coordinates:
  - Full screen: `(bubbleBounds − displayBounds) × scaleFactor`.
  - Window mode: the position relative to the target window, clamped inside it. Simpler v1: snap to the window's corners.
  - Spike: a window capture composited with the circle bubble and optional blur, saved to MP4 **[V]**.
- Shapes: circle, rounded square, rectangle/full. Sizes S/M/L/XL. Zoom = crop factor on the camera frame (spike used 1.15×). One `bubbleShapes.ts` serves both the preview (CSS mask) and the engine (canvas `clip()` path).
- "Rectangle/full" means camera-only full frame. That is a separate mode where the engine outputs the camera at the canvas size **[A: product definition to confirm]**.

**Why not "the real window gets captured, like Loom on full screen"?**
- That does work: in `bubblerec` the transparent circle appeared in the full-screen recording with clean corners **[V]**.
- But it fails in window mode, because only the target window is captured **[V]**.
- It would also capture any hover UI on the bubble.
- Compositing everywhere gives one code path and identical output.
- Cost: compositing ran at ~33% of one core, and ~57% with CPU blur (summed Electron process CPU time, 3K canvas) **[V]**.
- Fallback if content protection ever stops working: in full-screen mode, skip the engine's bubble and let the real window be captured.

**Duplicate camera work.** The preview window and the engine each open the camera and run the segmenter. The OS shares the device. Blur cost is paid twice (~+24% of one core each) **[V for one instance, A for two]**. That is acceptable for v1. Later, move preview rendering into the engine and stream frames to the bubble.

---

## 5. Background blur

- `@mediapipe/tasks-vision` 1.1.1 (Apache-2.0) `ImageSegmenter` + `selfie_segmenter.tflite`.
  - The model is **249,537 bytes** **[V: downloaded]**. The WASM is ~13.5 MB (`vision_wasm_internal.wasm`) **[V]**.
  - Both ship inside the app, no network at runtime.
  - Loading them needs `fetch`, which `file://` blocks. The spike served them over a 127.0.0.1 server **[V]**. The app should use a custom `app://` protocol registered with `protocol.handle` **[A]**.
- Pipeline: confidence mask (256×256) → alpha → `destination-in` on the sharp camera, layered over a `blur(10px)` copy. Visual result: background blurred, person sharp (`spike/out/bubble-blur-compare.png`) **[V]**.
- Measured on M3 Pro, 640×480 camera, model inside a 2998×1736 composite at 30 fps **[V]**:

| Delegate | Model load | Segment avg / p95 | Whole frame avg / p95 | Frames in 5 s |
|---|---|---|---|---|
| none (no blur) | n/a | n/a | 0.24 / 0.30 ms | 136 |
| **CPU** | 180 ms | **11.7 / 12.1 ms** | 12.1 / 12.8 ms | 140 |
| GPU | 143 ms | avg 308 ms (first-frame stall), p95 32.7 ms | 308 / 33 ms | **15** |

- **Use CPU.** The GPU delegate was worse because of a multi-second first-frame warm-up, plus a synchronous GPU→CPU readback in `getAsFloat32Array()`.
  - GPU could win if we keep the mask as a WebGL texture and composite in WebGL. That is untested **[A]**. Revisit only if a low-end Windows laptop can't hold 30 fps on CPU.
  - Run the segmenter at camera rate (≤30 fps), or every second frame if needed.
- Google's documented latency: ~33 ms on a Pixel 6 (https://developers.google.com/edge/mediapipe/solutions/vision/image_segmenter) **[D]**. Low-end Windows CPUs will be slower than our 12 ms **[A]**.

---

## 6. Clean desktop and control bar

### 6.1 Clean desktop: macOS (verified)
- **Chosen:** the cover helper (`spike/native/cover.swift`). It puts a borderless, click-through, all-Spaces `NSWindow` on each display at `kCGDesktopIconWindowLevel + 20`.
- Observed window layers **[V]**:

| Layer | What sits there |
|---|---|
| −2147483626 | display backstop |
| −2147483624 | wallpaper |
| −2147483603 | Finder desktop icons |
| −2147483601 | desktop widgets |
| **−2147483583** | **cover** |
| 0 | normal app windows |

- At icon level +1 the widgets still showed, which is why it is +20 **[V]**.
- Results **[V]**:
  - The ScreenCaptureKit shot of the below-normal layers went from icons + widgets + wallpaper to a solid colour (`out/desk-compare.png`, `out/desk-cover2-small.png`).
  - The full-screen recording with the cover up still shows the app windows, menu bar and Dock (`out/frame-cover-rec.png`).
- **Crash safety [V].**
  - The helper exits when stdin reaches EOF.
  - Closing the pipe killed it.
  - `kill -9` on the process holding the write end also killed it within 1 s.
  - No system setting is ever changed. `defaults read com.apple.finder CreateDesktop` is still unset afterwards.
  - Nothing to restore, even after a crash or power loss.
- Wallpaper variant: draw `NSWorkspace.shared.desktopImageURL(for:)` instead of a colour **[A]**.
- **Rejected:** `defaults write com.apple.finder CreateDesktop false && killall Finder`.
  - It is undocumented and persistent. A crash leaves the icons hidden until we restore it. It restarts Finder, closing Finder windows.
  - Not tested, deliberately.
- Edge cases to test **[A]**:
  - "Click wallpaper to reveal desktop" (Sonoma+): clicks pass through the cover to the desktop.
  - Stage Manager.
  - Multiple displays and hot-plugging.
  - Native full-screen Spaces.
  - Future macOS changing the widget level.
- Alternative, if we ever go native for capture: `SCContentFilter(display:excludingApplications:exceptingWindows:)` can drop Finder's desktop windows (https://developer.apple.com/documentation/screencapturekit/sccontentfilter) **[D]**. Electron does not expose it.

### 6.2 Clean desktop: Windows (unverified)
- **Plan [A]:** the same helper contract (`cover.exe`, exits on stdin EOF, also bound to a Job Object). It creates a borderless `WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE | WS_EX_TRANSPARENT` window per monitor. Z-order: directly above the desktop shell window (`Progman`/`WorkerW` hosting `SHELLDLL_DefView`), via `SetWindowPos` with the window just above it as `hWndInsertAfter`, and re-asserted on `WM_WINDOWPOSCHANGING`.
- Fallback: `ShowWindow(SysListView32, SW_HIDE)`. This is in-memory only and restored by `SW_SHOW` or an Explorer restart. Keep a crash marker so the next launch restores it.
- **Rejected:** the `HideIcons` registry value. It is persistent and needs an Explorer restart (https://www.elevenforum.com/t/hide-or-show-desktop-icons-in-windows-11.4824/) **[D, 3rd-party]**.
- Risks: Win+D "show desktop" and Explorer restarts reordering windows **[A]**.

### 6.3 Recorder control bar stays out of the recording
- **macOS [V].** A red window with `setContentProtection(true)` was **absent** from the full-screen recording: pixel (237,249,252), the content behind it, not black. The unprotected green window was present (0,254,0). Control run with red unprotected: (253,0,0).
  - This works because Electron removes protected windows from **its own** ScreenCaptureKit filter, for windows protected **before** the stream starts (https://github.com/electron/electron/pull/34362) **[D]**.
  - Other apps using ScreenCaptureKit **will** still see the window (https://www.electronjs.org/docs/latest/api/browser-window; https://developer.apple.com/forums/thread/760234) **[D]**. Irrelevant for us.
  - Rule: **set protection at window creation, before `getDisplayMedia`.**
  - ~~Loom says "hide controls in final video" is not supported on Mac~~ **Correction (2026-10-21):** that help page (https://support.atlassian.com/loom/docs/hide-the-recording-controls/) describes the legacy app. Tally keeps its own controls out of the final video through Electron's content protection.
- **Windows [D].** `SetWindowDisplayAffinity(WDA_EXCLUDEFROMCAPTURE)` on Win10 2004+ removes the window. Older builds show black (https://www.electronjs.org/docs/latest/api/browser-window). Unverified **[A]**.
- Fallback if it fails: put the control bar on a second display, or collapse it to a tray/menu-bar icon plus global shortcuts (`globalShortcut`).

---

## 7. Spike results (what actually ran)

Machine: M3 Pro, macOS 27.0 (26A428), Node 22.11.0, Electron 45.0.0, ffmpeg 8.0.1. Files are in `spike/out/`.

| # | Test | Result | Evidence |
|---|---|---|---|
| 1 | List screens + windows | ✅ | 1 screen + 22 windows, 342–547 ms over 3 runs, thumbnails non-empty (`out/list.txt`) |
| 2 | Record full screen 5 s | ✅ | `rec-screen_1_0-1792591543040.mp4`, 4,108,107 B, H.264 High, 3024×1964, 134 frames, 5.01 s. Real content (`frame-screen.png`) |
| 3 | Record single window 5 s | ✅ | `rec-window_3595_0-…567619.mp4`, 2,820,844 B, 2998×1736, 144 frames, 4.98 s, only the window (`frame-window.png`) |
| 4 | Pause/resume | ✅ | 6.0 s wall clock with a 1 s pause → 5.0 s video, no timestamp gap > 0.2 s |
| 5 | MP4 playable on macOS | ✅ | AVFoundation: `duration=5.13s videoTracks=1 playable=true`. `ffmpeg -c copy +faststart` remux OK |
| 6 | Circle camera bubble window | ✅ | FaceTime HD 640×640@30, transparent corners (`bubble-capture.png`). Needed your Camera click |
| 7 | Bubble captured in full-screen recording | ✅ | `frame-bubblerec.png` |
| 8 | Window + bubble composite | ✅ | `comp-window_*.mp4`, 136–140 frames / 5 s |
| 9 | MediaPipe blur | ✅ CPU, ⚠️ GPU | CPU 11.7 ms/frame. GPU stalled (15 frames in 5 s). `bubble-blur-compare.png` |
| 10 | CPU cost | ✅ | Composite ~33% of one core; with blur ~57% |
| 11 | Control bar excluded (`setContentProtection`) | ✅ macOS | Pixel test + control run (§6.3) |
| 12 | Clean-desktop cover | ✅ macOS | Icons, widgets and wallpaper hidden; apps still on top; dies with its parent; no settings changed |
| — | Anything on Windows | ❌ not run | No Windows machine available |

Hiccups during the spike, all resolved:
- Electron 45's postinstall needs Node ≥ 22.12, and this Mac has 22.11. Ran the installer with `npx -p node@22.20.0`. Upgrade Node for the real app.
- A missing `"main"` in package.json made Electron silently open its default app. Looked like a hang.
- Cover at icon level +1 left the desktop widgets visible. Fixed with +20.

---

## 8. Proposed layout

```
LoomClone/
  docs/ARCHITECTURE.md
  app/
    package.json  electron-builder.yml  electron.vite.config.ts  tsconfig.json
    build/                      entitlements.mac.plist, icons, Info.plist additions (NSCameraUsageDescription)
    resources/                  selfie_segmenter.tflite, tasks-vision wasm, cover helper binaries (extraResources)
    src/
      main/
        index.ts                lifecycle, single-instance lock, app:// protocol
        ipc.ts                  typed IPC channel definitions (shared with preload)
        windows/                controlBar.ts  bubble.ts  picker.ts  library.ts  engine.ts (hidden)
        capture/sources.ts      desktopCapturer listing + thumbnails, display ↔ source mapping
        capture/displayMedia.ts setDisplayMediaRequestHandler, selected-source handoff
        permissions/            mac.ts (TCC status, deep links, askForMediaAccess)  win.ts
        session/machine.ts      idle → countdown → recording ⇄ paused → finalizing → saved | discarded
        session/fileSink.ts     append chunks to temp .mp4, finalize (remux + faststart), move to library
        cleanDesktop/           index.ts (spawn/kill helper, stdin pipe)  mac.ts  win.ts
        library/store.ts        recordings folder, list, rename (file + sidecar .json), reveal in Finder/Explorer
        settings.ts             output folder, resolution cap, fps, bubble defaults, cover colour/wallpaper
      preload/index.ts          contextBridge API per window
      renderer/
        engine/                 compositor.ts  camera.ts  segmenter.ts  recorder.ts  (hidden window)
        bubble/                 preview UI, drag, shape/size/zoom controls (hover)
        control-bar/            start/stop/pause/restart, timer
        picker/                 screen vs window grid with thumbnails, camera on/off, clean-desktop toggle
        library/                list, rename, open folder
        shared/                 bubbleShapes.ts (CSS + canvas paths)  blur.ts (mask compositing)
  native/
    mac-cover/                  Swift helper (from spike), built and signed in CI
    win-cover/                  C++ or C# helper, same stdin-EOF contract + Job Object
```

---

## 9. Risks (ranked)

1. **Windows is entirely unverified.** Unknowns: capture backend and yellow border, H.264 encode, WDA_EXCLUDEFROMCAPTURE in Electron's capture, the cover z-order hack, and blur performance on weaker CPUs. *Mitigation:* a Windows spike before building UI. Same `run.sh` modes, as a `.ps1`.
2. **macOS distribution friction.** Without a $99 Developer ID, every install needs a Privacy & Security approval and may drop TCC grants. Screen-recording re-prompts (monthly on 15+). Relaunch after the grant.
3. **Frame pacing and long recordings.** 27–29 fps measured on short clips. Not yet tested: 30–60 min sessions (memory, thermal, chunk-to-disk), 60 fps, 4K/5K external displays, window resize mid-recording.
4. **Electron/Chromium upgrades changing capture behaviour.** The content-protection exclusion depends on an Electron-specific patch, and the MP4 muxer output format may change. *Mitigation:* pin the Electron major, and keep the spike's pixel and ffprobe checks as automated smoke tests.
5. **Clean-desktop edge cases.** Click-to-reveal-desktop, Stage Manager, multi-monitor, full-screen Spaces, widget-level changes in future macOS, Explorer quirks on Windows.

---

## 10. Open questions (your call)

1. **Apple Developer Program ($99/yr), or live with an ad-hoc-signed app?** This affects install and permission friction.
2. **Do you have a Windows machine (Win 10 2004+/11) for the Windows spike?**
3. **Default output:** native Retina (≈6–8 Mbit/s at 3K) or capped at 1440p/1080p? Is 30 fps enough, or do you want 60?
4. **Window-mode bubble placement:** free position (mapped onto the window) or snap to the window's corners?
5. **"Rectangle/full" bubble:** a large rectangle overlay, or camera-only full frame?
6. **Final file:** OK with a quick post-stop remux to standard MP4 (pure JS, or bundled ffmpeg ~30–80 MB)?
7. **Multi-monitor in v1:** record one display, or also support picking a display other than the primary?
