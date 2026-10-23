# Capture spike (throwaway)

This spike proves the riskiest capture items on macOS. It is not the app. Delete it once `app/` exists.

Run on: MacBook Pro M3 Pro, macOS 27.0 (26A428), Electron 45.0.0 (Chromium 156), 2026-10-21.

## Setup

```sh
npm install            # Electron 45's install script needs Node >= 22.12. With Node 22.11:
npx -y -p node@22.20.0 node node_modules/electron/install.js
cd native && swiftc -O cover.swift -o cover && swiftc -O desktopshot.swift -o desktopshot
```

## Modes

`./run.sh <mode>` runs Electron with a timeout and prints only the `RESULT:` JSON lines. Outputs go to `out/`.

| Command | What it proves |
|---|---|
| `./run.sh list` | Lists screens and windows through `desktopCapturer.getSources`. |
| `./run.sh record screen 5` / `./run.sh record window:<id> 5` | Records with `getDisplayMedia` and `MediaRecorder` to H.264 MP4, with a 1 s pause/resume in the middle. |
| `./run.sh bubble 8` | Shows a transparent, frameless, always-on-top circle camera window. |
| `./run.sh bubblerec 3` | Records the full screen while the bubble window is up. |
| `./run.sh protect 3` (`PROTECT=0` for the control run) | Shows whether `setContentProtection(true)` keeps a window out of the recording. |
| `./run.sh composite window:<id> 5 none\|CPU\|GPU` | Composites a window capture with the camera bubble in a canvas and records it. Optional MediaPipe background blur. |
| `native/cover [hex]` | Clean-desktop cover window. Stays up until stdin closes. |
| `native/desktopshot out.png` | Verifier only. Uses ScreenCaptureKit to screenshot just the windows below the normal layer: wallpaper, icons, widgets, cover. |

See `../docs/ARCHITECTURE.md` §7 for the results.
