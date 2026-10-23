# Tally (M1 + M2)

Local-only screen + camera recorder. Electron 45, macOS first. Plan and decisions: `../docs/M1_PLAN.md`. UX source of truth: `../design/DESIGN_SPEC.md`.

## Run

```sh
npm install --ignore-scripts
npx -y -p node@22.20.0 node node_modules/electron/install.js   # Electron 45's installer needs Node >= 22.12
npm run vendor     # copies MediaPipe's bundle + SIMD WASM into resources/vendor (also runs on install)
npm run native     # builds native/bin/winbounds (window bounds) and native/bin/cover (clean desktop)
npm start          # menu-bar app; permissions are charged to the terminal you launch from
npm test           # unit tests (node:test, no Electron needed)
```

ffmpeg on PATH (or `TALLY_FFMPEG`) is used to finalise files: copy-remux, constant 30 fps timestamps, `+faststart`. Without it the fragmented MP4 is kept as-is.

## Scripted verification

`TALLY_DEV_CONTROL=1` turns on a stdin command channel (see `devControl` in `src/main/index.js`). `node scripts/drive.mjs scenario.txt` runs a scenario: `record display`, `record window <title>`, `act stop|pause|restart|cancel|keep|confirm|camera`, `shot <window> <png>`, `eval <window> <js>`, `key <window> <key>`, `crash`, `wait <ms>`.
`TALLY_NO_PROTECT=1` leaves overlays capturable (for desktop screenshots only).

M2 additions: `simulate camera-lost|camera-back|audio-lost|mic-lost|mic-back|window-closed`, `action switch|dismiss`, `perf` (engine/bubble ms per frame + CPU % since the recording started), `net` (blocked network attempts), `importimage background|cover <path>`, `settingswin`. Env: `TALLY_FAKE_FREE_MB` (pretend free space while recording, for the disk-full auto-stop) and `TALLY_DISK_POLL_MS`.

Setup v2: `setup [displayId]` / `closesetup` (open / close the toolbar), `trayclick` (a left-click on the menu-bar icon), `bar` (toolbar placement and setup state), `cover` (what the cover helper shows), `protected` (content protection per window), `fakewindows <json>|off` (stand-in list for the window picker), `mouse <window> move|drag|down|up|wheel|dbl <x> <y> [g]` (in-window events; `g` = screen coordinates).
Speaker notes: `notes` (panel state: visible, focusable, position, script length, ⌥⇧N registered, prefs), `notesscroll` (what ⌥⇧N does), `notesblocked` (screenshot aid: the Windows fail-closed notice). The script is `userData/notes.txt`.
Capture exclusion by pixel (ARCHITECTURE §6.3): `npx electron scripts/protect-pixel.cjs` shows a protected red and an unprotected green square for under a second and prints PASS when only the green one is in a capture of the main display.
Microphone without touching the real one: launch Electron with `--use-fake-device-for-media-stream --use-fake-ui-for-media-stream` and set `TALLY_FAKE_MIC_STATUS=granted|denied|not-determined` (stands in for the macOS permission; never prompts).
An isolated instance never opens the real recordings folder: it uses `TALLY_LIBRARY_DIR`, else `<userData>/library`, decided before crash recovery runs (`src/main/libraryDir.js`); recovery also skips any session whose owner pid (in `session.json`) is still alive. `TALLY_FAKE_FINALIZE=error|hang` (with `TALLY_DEV_CONTROL=1`) forces the "Couldn't finish the file" popup.
`TALLY_USER_DATA=<dir>` runs an isolated instance (own settings, logs and lock). Add `TALLY_DEV_SANDBOX=1` to test next to someone using the Mac: app name "Tally Dev", no menu-bar icon, no global shortcuts, every window invisible and click-through, never takes focus, the cover helper is not drawn, and the wallpaper is never read. `TALLY_DEV_WALLPAPER=1` lets a sandbox read it for the privacy-strip fill only (SETUP_V2 §16), so a test recording can check the strips against the wallpaper. capturePage and in-window events still work.

Local-only: every renderer has `connect-src 'self'`, and `src/main/netguard.js` cancels any non-`app://` request. MediaPipe's usage logger (odml.pa.googleapis.com) is refused by both.

## Packaging (M3)

`npm run dist:mac` builds fat (arm64 + x86_64) native helpers, runs the tests, and writes two unsigned, ad-hoc-signed DMGs to `dist/` (gitignored): `Tally-<version>-mac-arm64.dmg` and `-mac-x64.dmg`. electron-builder 26, config in `package.json` → `build`:
- `asar` with `native/bin/**` unpacked (executables can't run from inside the archive; `unpacked()` in `src/main/protocol.js`). MediaPipe and the models are read through `app://` from inside the asar. No `node_modules` are shipped (MediaPipe is vendored into `resources/`).
- Hardened runtime, `build/entitlements.mac.plist` (JIT, unsigned executable memory, library validation off for ad-hoc, camera, audio input for the optional microphone).
- Info.plist: `NSCameraUsageDescription`, `NSMicrophoneUsageDescription` (Tally's own wording), `NSAudioCaptureUsageDescription`, `LSUIElement`. `build/afterPack.cjs` removes Electron's stock Bluetooth usage strings. Screen Recording has no Info.plist key (it is a TCC grant).
- Node 22.11 needs `NODE_OPTIONS=--experimental-require-module` for electron-builder 26 (set in the scripts).
- Windows: `npm run dist:win` packages the app, but the NSIS step needs Rosetta 2 on Apple Silicon (electron-builder's macOS `makensis` is x86_64-only). See `../INSTALL.md`.
- App icon: `build/icon.png` (from `npm run icons`).

## Layout

- `src/main/` — lifecycle, IPC, tray, shortcuts, permissions, sources, `controller.js` (session orchestration)
- `src/main/session/` — `machine.js` (pure state machine), `segments.js` (segment files, finalize, crash recovery), `mp4.js` (box walk, repair, duration)
- `src/main/library/` — naming, rename, delete-with-undo, folder listing
- `src/shared/geometry.js` — bubble sizes, window-mode constraint, snapping, zoom crop, shapes (used by main, bubble and engine)
- `src/shared/toolbar.js` — setup toolbar / bar placement: home, snapping, bubble avoidance, window room
- `src/shared/notes.js` — speaker notes placement (dock under the lens, clear of toolbar / bubble / tray), wpm → px/s; `src/main/notesGuard.js` — Windows fail-closed check (S19)
- `src/renderer/` — one folder per window: bar (setup toolbar → countdown → recording bar), bubble, camtray (bubble tray), picker (window picker), notes (speaker notes), countdown, popup, library, permission, engine (hidden compositor/recorder)
- `native/winbounds.swift` — window frames via CGWindowList (no permission needed); `--list` for the window picker
- `native/cover.swift` — clean-desktop cover at desktop-icon level +20; exits on stdin EOF; `--fill` renders the cover's look for the privacy strips
- `src/shared/privacy.js` — privacy levels: menu-bar / Dock strips the engine paints over (recording only)
- `src/renderer/shared/bg/` — camera background: segmenter + WebGL2 compositor (`background.js`, `compositor.js`), bundled images (`images.js`)
- `src/main/mediaPolicy.js`, `src/shared/mic.js`, `test/mic.test.js` — the optional microphone (off by default): permission policy (audio only while the switch is on, only for the engine and the toolbar meter), device choice (id → label → system default), the WebAudio mix of mic + system audio into one track, and source / build-config scans
