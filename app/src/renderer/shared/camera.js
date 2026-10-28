// Camera helpers shared by the bubble preview and the engine: opening the camera
// (video only, never audio), face-centred crop tracking, and drawing the shaped crop.
import { cropRect, traceShape } from '../../shared/geometry.js';
import { visionBundle, visionFileset, MODEL_URL } from './vision.js';

// hiRes (Camera only): the camera's best, up to 4K, so a 9:16 crop can reach 1080×1920.
export async function openCamera(deviceId, { hiRes = false } = {}) {
  const video = {
    width: { ideal: hiRes ? 3840 : 1920 },
    height: { ideal: hiRes ? 2160 : 1080 },
    frameRate: { ideal: 30 },
    ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
  };
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video, audio: false });
  } catch (e) {
    if (!deviceId || e.name !== 'OverconstrainedError') throw e;
    stream = await navigator.mediaDevices.getUserMedia({ video: { ...video, deviceId: undefined }, audio: false });
  }
  const el = document.createElement('video');
  el.muted = true;
  el.playsInline = true;
  el.srcObject = stream;
  await el.play();
  return { stream, video: el };
}

export function stopStream(stream) {
  stream?.getTracks().forEach((t) => t.stop());
}

// Face-centred crop (spec §3.2). MediaPipe's BlazeFace short-range detector runs on
// the CPU at ~10 fps; the centre eases toward the face (~450 ms) so head movement
// doesn't jitter the frame, and ignores moves under DEADBAND (detector noise, small
// head motion). No face → the centre drifts back to the frame centre. Only used when
// camera.follow is on; otherwise callers crop around CENTRE.
const DETECT_W = 320;
const DEADBAND = 0.04; // fraction of the frame
export const CENTRE = Object.freeze({ x: 0.5, y: 0.5 });

export class FaceTracker {
  constructor() {
    this.centre = { x: 0.5, y: 0.5 };
    this.target = { x: 0.5, y: 0.5 };
    this.detector = null;
    this.lastDetect = 0;
    this.lastStep = performance.now();
    this.lastFace = 0;
    this.failed = false;
    this.pending = null;
    this.lastTs = 0;
    this.times = []; // detection ms (perf numbers)
    this._load();
  }

  async _load() {
    try {
      // Shares the window's MediaPipe runtime with the background segmenter. CPU at
      // 10 Hz: the GPU is left to the segmenter, which runs every frame.
      const { FaceDetector } = await visionBundle();
      const fileset = await visionFileset();
      this.detector = await FaceDetector.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: MODEL_URL.face, delegate: 'CPU' },
        runningMode: 'VIDEO',
        minDetectionConfidence: 0.5,
      });
    } catch (e) {
      this.failed = true;
      console.warn('face detector unavailable, centring on the frame', e);
    }
  }

  update(video, now = performance.now()) {
    if (this.detector && video.videoWidth && now - this.lastDetect >= 100 && !this.pending) {
      this.lastDetect = now;
      // BlazeFace works at 128 px: hand it a 320 px bitmap, scaled off the main thread
      // (a synchronous drawImage + readback of the 1080p frame cost 3–6 ms here).
      const W = DETECT_W;
      const H = Math.round((W * video.videoHeight) / video.videoWidth);
      this.pending = createImageBitmap(video, { resizeWidth: W, resizeHeight: H, resizeQuality: 'low' })
        .then((bmp) => {
          const t0 = performance.now();
          try {
            const r = this.detector?.detectForVideo(bmp, Math.max(performance.now(), this.lastTs + 1));
            this.lastTs = performance.now();
            const best = r?.detections.sort((a, b) => b.boundingBox.width * b.boundingBox.height - a.boundingBox.width * a.boundingBox.height)[0];
            if (best) {
              const b = best.boundingBox;
              const t = { x: (b.originX + b.width / 2) / W, y: (b.originY + b.height / 2) / H };
              if (Math.hypot(t.x - this.target.x, t.y - this.target.y) > DEADBAND) this.target = t;
              this.lastFace = now;
            } else if (now - this.lastFace > 1500) this.target = { x: 0.5, y: 0.5 };
          } catch {}
          bmp.close();
          this.lastMs = performance.now() - t0;
          this.times.push(this.lastMs);
          if (this.times.length > 2000) this.times.shift();
        })
        .catch(() => {})
        .finally(() => (this.pending = null));
    }
    const dt = now - this.lastStep;
    this.lastStep = now;
    const k = 1 - Math.exp(-dt / 150); // ≈ 95 % of the way in 450 ms
    this.centre = { x: this.centre.x + (this.target.x - this.centre.x) * k, y: this.centre.y + (this.target.y - this.centre.y) * k };
    return this.centre;
  }

  close() {
    this.detector?.close();
    this.detector = null;
  }
}

// Draw the shaped, zoomed, face-centred camera crop into (x, y, w, h).
// Seam for M2 backgrounds: pass `source` = a processed canvas instead of the video.
export function drawBubble(ctx, source, { x, y, w, h, shape, zoom, centre, mirror = false, scale = 1, clip = true }) {
  const sw0 = source.videoWidth || source.width;
  const sh0 = source.videoHeight || source.height;
  if (!sw0 || !sh0) return;
  const c = cropRect(sw0, sh0, w / h, zoom, centre);
  ctx.save();
  if (clip) {
    traceShape(ctx, shape, x, y, w, h, scale);
    ctx.clip();
  }
  if (mirror) {
    ctx.translate(x * 2 + w, 0);
    ctx.scale(-1, 1);
  }
  ctx.drawImage(source, c.sx, c.sy, c.sw, c.sh, x, y, w, h);
  ctx.restore();
}
