// macOS TCC checks. desktopCapturer.getSources hangs silently when Screen Recording
// is denied, so every caller checks screenStatus() first.
import { systemPreferences, shell } from 'electron';
import { execFile } from 'node:child_process';

const isMac = process.platform === 'darwin';

export function screenStatus() {
  return isMac ? systemPreferences.getMediaAccessStatus('screen') : 'granted';
}

export function cameraStatus() {
  return isMac || process.platform === 'win32' ? systemPreferences.getMediaAccessStatus('camera') : 'granted';
}

export async function requestCamera() {
  if (!isMac) return cameraStatus() !== 'denied';
  return systemPreferences.askForMediaAccess('camera');
}

// Microphone (optional, off by default): asked only when the user turns it on.
// TALLY_FAKE_MIC_STATUS (dev only) stands in for the TCC state, so a test instance
// never asks for, or reads, the real microphone permission.
let fakeMic = process.env.TALLY_FAKE_MIC_STATUS || null;

export function micStatus() {
  if (fakeMic) return fakeMic;
  return isMac || process.platform === 'win32' ? systemPreferences.getMediaAccessStatus('microphone') : 'granted';
}

// 'not-determined' → the system prompt; the answer is remembered by macOS.
export async function requestMic() {
  if (fakeMic) {
    if (fakeMic === 'not-determined') fakeMic = 'granted';
    return fakeMic === 'granted';
  }
  if (!isMac) return micStatus() !== 'denied';
  return systemPreferences.askForMediaAccess('microphone');
}

export function openMicSettings() {
  return shell.openExternal(isMac ? 'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone' : 'ms-settings:privacy-microphone');
}

export function openScreenSettings() {
  return shell.openExternal(isMac ? 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture' : 'ms-settings:privacy');
}

export function openCameraSettings() {
  return shell.openExternal(isMac ? 'x-apple.systempreferences:com.apple.preference.security?Privacy_Camera' : 'ms-settings:privacy-webcam');
}

// "Reset permission…" (spec §3.8): clears the stale TCC entry for this app.
export function resetScreenPermission(bundleId) {
  return new Promise((resolve) => execFile('tccutil', ['reset', 'ScreenCapture', bundleId], (err) => resolve(!err)));
}

// "Free up space…" after a disk-full stop.
export function openStorageSettings() {
  return shell.openExternal(isMac ? 'x-apple.systempreferences:com.apple.settings.Storage' : 'ms-settings:storagesense');
}
