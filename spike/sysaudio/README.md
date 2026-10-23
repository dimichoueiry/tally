# sysaudio spike (throwaway)

**Question:** can Electron 45 on macOS 27 capture system audio through getDisplayMedia loopback, with no driver and no change to the output device?

## Run

```sh
./run.sh unpackaged 5 loopback                 # default constraints
RAW=1 TAG=raw ./run.sh unpackaged 5 loopback   # voice processing off, stereo
NOTONE=1 TAG=notone ./run.sh unpackaged 5 loopback   # negative control
./build-packaged.sh && RAW=1 ./run.sh packaged 5 loopback
```

`run.sh` does four things:
1. Plays `/System/Library/Sounds/Ping.aiff` in a loop.
2. Records about 5 s of the audio track only, as Opus WebM, into `out/`.
3. Prints the default output device before and after (`system_profiler SPAudioDataType`).
4. Runs `ffmpeg volumedetect`.

## API that worked

- **Main process:**
  `session.setDisplayMediaRequestHandler((req, cb) => cb({ video: screenSource, audio: 'loopback' }))`
- **Renderer:**
  `navigator.mediaDevices.getDisplayMedia({ video: true, audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 2 } })`
- The track comes back with label `System audio`, `deviceId: loopback`, 48 kHz.

## Results (2026-10-21, M3 Pro, macOS 27.0, Electron 45.0.0)

| Run | Track | volumedetect mean / max | Output device before → after |
|---|---|---|---|
| Unpackaged, `audio: true` | mono, AGC + echo cancellation + noise suppression **on** | −27.5 / **−0.0 dB** (AGC drove it to clipping) | MacBook Pro Speakers → same |
| Unpackaged, raw constraints | **stereo**, processing off | **−36.9 / −10.5 dB** | same → same |
| Unpackaged, no tone (control) | stereo | −91.0 / −91.0 dB (silence) | same → same |
| Packaged (`SysAudioSpike.app`, own bundle id, ad-hoc signed) | not reached | n/a | same → same |

Notes on the packaged run:
- `getMediaAccessStatus('screen') = denied` for the new identity.
- `desktopCapturer.getSources` then hangs without an error.
- Re-signing the ad-hoc bundle reset an earlier grant.
- **Pending:** the user needs to enable SysAudioSpike under Screen & System Audio Recording, then run it again.

## Notes

- Unpackaged runs attribute TCC to the launching terminal. The dev `Electron.app` Info.plist already ships `NSAudioCaptureUsageDescription`.
- The packaged bundle is built by hand, the way `@electron/packager` does it: copy Electron.app, put the app in `Resources/app`, set a new `CFBundleIdentifier` and our own `NSAudioCaptureUsageDescription`, then `codesign --deep -s -`. This avoids a network install.
