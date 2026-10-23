#!/bin/zsh
# Hand-packages the spike the way @electron/packager does: copy Electron.app, drop app/ into Resources,
# give it its own bundle id + NSAudioCaptureUsageDescription, ad-hoc sign. Output: SysAudioSpike.app
cd "$(dirname "$0")"
rm -rf SysAudioSpike.app
cp -R ../node_modules/electron/dist/Electron.app SysAudioSpike.app
mkdir -p SysAudioSpike.app/Contents/Resources/app
cp main.js preload.js index.html package.json SysAudioSpike.app/Contents/Resources/app/
P=SysAudioSpike.app/Contents/Info.plist
plutil -replace CFBundleIdentifier -string com.loomclone.sysaudiospike $P
plutil -replace CFBundleName -string SysAudioSpike $P
plutil -replace CFBundleDisplayName -string SysAudioSpike $P
plutil -replace NSAudioCaptureUsageDescription -string "SysAudioSpike records system audio to test loopback capture." $P
codesign --force --deep --sign - SysAudioSpike.app
codesign -dv SysAudioSpike.app 2>&1 | grep -E 'Identifier|Signature'
plutil -p $P | grep -E 'CFBundleIdentifier|NSAudioCapture'
