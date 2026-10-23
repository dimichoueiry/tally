# Installing Tally

Tally is a local-only screen and camera recorder. It lives in the menu bar (no Dock icon). Nothing is uploaded: recordings stay in `~/Movies/Tally`.

## Mac

**Which file**
- Apple Silicon (M1 or later): `Tally-<version>-mac-arm64.dmg`
- Intel: `Tally-<version>-mac-x64.dmg`. Built and checked, but **not run by us** (we have no Intel Mac).

Needs macOS 13 or later.

**Install**
1. Open the DMG and drag **Tally** onto **Applications**.
2. Eject the DMG.

**First launch: the app isn't from an identified developer**

Tally isn't signed with an Apple Developer ID or notarized, so macOS blocks the first launch. Do one of these, once:

- **macOS 15 and later:** open Tally. When macOS says it can't verify it, click **Done**. Then open **System Settings › Privacy & Security**, scroll down to "Tally was blocked…", click **Open Anyway**, and confirm with your password. (Right-click › Open no longer bypasses this on macOS 15.)
- **macOS 13 and 14:** in Applications, right-click **Tally › Open**, then click **Open**.
- **Or, in Terminal** (any version): `xattr -dr com.apple.quarantine /Applications/Tally.app`, then open Tally normally.

If macOS says the app is "damaged", use the Terminal command above. That message is about the missing signature, not the file.

**Permissions**

Tally asks for these when it first needs them:

| Permission | When | What to do |
|---|---|---|
| **Screen & System Audio Recording** | First time you open setup or record | Tally shows a window with **Open System Settings**. Turn on **Tally** in *Privacy & Security › Screen & System Audio Recording*, then **quit and reopen Tally** (macOS needs the restart). |
| **Camera** | First time the camera bubble shows | Click **Allow**. You can record without it (turn the camera off in the toolbar). |
| **System audio** (optional) | Only if you turn on *System audio* | Allow it. It records the sound your Mac plays. It's off by default. |
| **Microphone** (optional) | Only when you turn on *Microphone* in the toolbar | Click **OK**. Tally records your voice only while it's on; it's off by default. If you said no, the toolbar shows **Open Settings** (*Privacy & Security › Microphone*); turn on Tally there. |

**After updating**

Each Tally build has a new ad-hoc signature, and macOS ties permissions to the signature. After an update macOS may ask again. If Tally is listed as allowed but recording still fails, remove Tally from *Screen & System Audio Recording* (the **–** button), open Tally, and allow it again. macOS also re-asks for screen recording roughly monthly.

**Optional: ffmpeg.** With ffmpeg installed (`brew install ffmpeg`), Tally rewrites each file as a standard MP4 that starts playing instantly online. Without it, Tally keeps the file as recorded; it still plays in QuickTime and browsers.

**Uninstall:** quit Tally from its menu-bar icon (right-click › Quit Tally) and delete it from Applications. Settings and speaker notes are in `~/Library/Application Support/Tally`. Your recordings in `~/Movies/Tally` are yours to keep or delete.

## Windows

**There is no Windows installer yet, and Tally has not been tested on Windows at all.** The code has Windows paths, but nobody has run them.

Why there's no installer: the NSIS installer is cross-built on a Mac with electron-builder. Its bundled `makensis` is an Intel-only binary, and the build Mac (Apple Silicon) has no Rosetta 2. Setting the `.exe` icon and version info from a Mac would also need wine.

To build it:
- **On a Windows PC (recommended):** `cd app && npm ci && npm run dist:win` (`dist/Tally-<version>-win-x64-setup.exe`). There you can also set `signAndEditExecutable: true` in `package.json` to get the Tally icon on the `.exe`.
- **On this Mac:** install Rosetta 2 (`softwareupdate --install-rosetta --agree-to-license`), then `npm run dist:win`.

When an installer exists, it will be unsigned: Windows SmartScreen will show "Windows protected your PC". Click **More info › Run anyway**. Expect rough edges: capture, the clean-desktop cover, and keeping the toolbar and notes out of the recording are all unverified on Windows. Speaker notes hide themselves at Record on any PC where Tally can't confirm they stay out of the video.
