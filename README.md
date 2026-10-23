# Tally

A free, local Loom-style screen + camera recorder. Recordings stay on your machine as MP4 files; nothing is uploaded.

- **Platforms:** macOS. Windows is untested.
- **Unsigned:** the app is not signed or notarized, so macOS will warn on first launch. [INSTALL.md](INSTALL.md) explains how to open it.

## Download

**[Download Tally for Mac →](https://github.com/dimichoueiry/tally/releases/latest)** (macOS 13 or later). Pick the file for your Mac:
- **`Tally-<version>-mac-arm64.dmg`**: Apple Silicon (M1 or later).
- **`Tally-<version>-mac-x64.dmg`**: Intel. Not yet tested on real Intel hardware.

Not sure? Apple menu › **About This Mac**: "Chip: Apple M…" is Apple Silicon; "Processor: … Intel …" is Intel. Windows is untested.

1. Open the DMG and drag **Tally** to **Applications**.
2. Tally is unsigned, so macOS blocks the first launch: open Tally, then **System Settings › Privacy & Security › Open Anyway**.
3. If macOS says the app "is damaged": `xattr -dr com.apple.quarantine /Applications/Tally.app`, then open it again.
4. Allow **Screen & System Audio Recording** and **Camera** (and **Microphone** if you turn it on), then quit and reopen Tally.
5. **Updating from 0.1.0:** remove Tally in *Privacy & Security › Screen & System Audio Recording* (**–**) and add it back by opening Tally, one last time. From 0.1.1 on, Tally is signed with a stable certificate, so updates keep the permission.

Each release lists the SHA-256 of both DMGs so you can check the download (`shasum -a 256 Tally-*.dmg`).

## Build from source

To build the DMGs yourself, use a Mac with macOS 13 or later, Node 22.12 or later, and the Xcode Command Line Tools (`xcode-select --install`, for `swiftc`):

```sh
git clone https://github.com/dimichoueiry/tally.git
cd tally/app
npm ci
npm run dist:mac   # builds the native helpers, runs the tests, writes dist/Tally-<version>-mac-arm64.dmg and -mac-x64.dmg
```

Open the DMG for your Mac (arm64 for Apple Silicon, x64 for Intel) and drag Tally to Applications. Optional: `brew install ffmpeg` for files that start playing instantly online.

Because the app is unsigned:
- **First launch:** macOS blocks it. Open **System Settings › Privacy & Security** and click **Open Anyway** (macOS 15+), or right-click Tally › **Open** (macOS 13–14).
- **Screen Recording:** allow Tally in *Privacy & Security › Screen & System Audio Recording*, then quit and reopen it.
- **After updating:** release builds from 0.1.1 keep the permission. A build you make yourself is signed ad-hoc unless your keychain has a trusted "Tally Local" code-signing identity, so macOS may not recognise the old permission: remove Tally from *Screen & System Audio Recording* (the **–** button), open Tally, and allow it again.

Full details: [INSTALL.md](INSTALL.md). To run from source without packaging, see [app/README.md](app/README.md).

## Where things are

- `app/`: the Electron app. Build, run and test notes: [app/README.md](app/README.md).
- [INSTALL.md](INSTALL.md): installing the DMG and permissions.
- `design/`, `docs/`: design spec, architecture and milestone notes.
- `spike/`: early prototypes.

## Licence

MIT. See [LICENSE](LICENSE). Bundled MediaPipe models and WASM are Apache-2.0; credits in [NOTICE](NOTICE).
