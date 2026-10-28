// Full camera mid-recording (⌥⇧F): the bubble grows to fill the output frame and the
// screen fades, and back. Pure, so the engine's per-frame math is unit-tested
// (test/scene.test.js). The frame never changes size (MediaRecorder can't): the camera
// is cropped to the frame's aspect when full.

export const SCENE_MS = 400;
// The screen under a full camera: faded to this, never drawn on top of the camera.
export const SCENE_DIM = 1;

export const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

// { full, t0, from } → 0 (bubble) … 1 (full camera) at `now`, eased. `from` is where the
// last switch started, so a switch made mid-transition turns back smoothly.
export function sceneProgress(scene, now) {
  if (!scene) return 0;
  const t = Math.min(1, Math.max(0, (now - scene.t0) / SCENE_MS));
  const to = scene.full ? 1 : 0;
  return scene.from + (to - scene.from) * easeInOut(t);
}

// A switch at `now`: starts from wherever the current one is.
export function switchScene(scene, full, now) {
  return { full, t0: now, from: sceneProgress(scene, now) };
}

const lerp = (a, b, p) => a + (b - a) * p;

// The camera's box at progress p: the bubble (output px) → the whole frame. Its corner
// radius goes from the bubble's (a circle is a radius of half its side) to square
// corners. p = 0 returns null radius: draw the bubble's own shape.
export function sceneBox(bubble, frame, p, radius0) {
  if (p <= 0) return { ...bubble, radius: null };
  const x = lerp(bubble.x, 0, p);
  const y = lerp(bubble.y, 0, p);
  const w = lerp(bubble.w, frame.width, p);
  const h = lerp(bubble.h, frame.height, p);
  return { x, y, w, h, radius: Math.max(0, lerp(radius0, 0, p)) };
}
