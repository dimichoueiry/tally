// Screen Recording permission: which app id to reset, and how to explain a stale grant.
// Pure, so it is unit-tested (test/permAdvice.test.js).

// The bundle id macOS knows the app by is electron-builder's appId (Info.plist
// CFBundleIdentifier). Never Electron's own dev id: resetting that leaves Tally's entry
// untouched (LC-19).
export function bundleIdFor(pkg) {
  const id = pkg?.build?.appId;
  if (!id || typeof id !== 'string') throw new Error('package.json has no build.appId');
  return id;
}

// macOS can list Tally as allowed while the grant belongs to an older build (ad-hoc
// signatures change with every build), so capture fails although the status reads
// 'granted'. The fix is to remove the entry and add the app again.
export const STALE_GRANT_TEXT =
  'Screen recording isn’t working, although macOS lists Tally as allowed. This can happen after an update. In System Settings › Privacy & Security › Screen & System Audio Recording, remove Tally with −, add it again with +, then reopen Tally.';

const CAPTURE_FAILURE = /NotAllowedError|NotReadableError|AbortError|Permission denied|Could not start (video|screen|audio) source|No display source|getDisplayMedia|screen capture|SCStream|TCC/i;

// True when a failure to start capturing happened with the permission reading 'granted'.
export function isStaleGrant(err, screenStatus) {
  if (screenStatus !== 'granted' || !err) return false;
  return CAPTURE_FAILURE.test(`${err.name || ''}: ${err.message || err}`);
}
