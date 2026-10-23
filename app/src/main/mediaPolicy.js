// What the renderers may capture. Pure, so it is unit-tested (test/mic.test.js).
// Camera: video requests. Microphone: only while the Microphone switch is on, and only
// for the windows that use it (the engine records it, the toolbar shows its level);
// the caller says so with `micAllowed`. System audio comes only from getDisplayMedia
// loopback (the Mac's output), and only when the user turned it on; that path is
// answered by displayMediaStreams(), not by this handler.

export function allowPermissionRequest(permission, details = {}, { micAllowed = false } = {}) {
  if (permission === 'media') {
    const types = details.mediaTypes || [];
    return types.length > 0 && (!types.includes('audio') || micAllowed);
  }
  return permission === 'display-capture';
}

export function allowPermissionCheck(permission, details = {}, { micAllowed = false } = {}) {
  if (permission === 'media') return details.mediaType !== 'audio' || micAllowed;
  return permission === 'display-capture';
}

// Answer for setDisplayMediaRequestHandler. Loopback = what the computer plays,
// never an input device.
export function displayMediaStreams(source, { audioRequested, systemAudio }) {
  if (!source) return {};
  return audioRequested && systemAudio ? { video: source, audio: 'loopback' } : { video: source };
}

export { SYSTEM_AUDIO as SYSTEM_AUDIO_CONSTRAINTS } from '../shared/media.js';
