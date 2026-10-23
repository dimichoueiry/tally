// One MediaPipe runtime per window, shared by the face detector (zoom centring) and
// the background segmenter: the bundle and the 13.5 MB WASM fileset are loaded once.
// Everything comes from app:// (resources/vendor); the network is blocked in main.
let bundle = null;
let fileset = null;

export function visionBundle() {
  bundle ??= import('app://tally/mediapipe/vision_bundle.mjs');
  return bundle;
}

export async function visionFileset() {
  const { FilesetResolver } = await visionBundle();
  fileset ??= FilesetResolver.forVisionTasks('app://tally/mediapipe/wasm');
  return fileset;
}

export const MODEL_URL = {
  face: 'app://tally/models/blaze_face_short_range.tflite',
  selfie: 'app://tally/models/selfie_segmenter.tflite',
};
