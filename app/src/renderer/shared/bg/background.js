// Camera background None / Blur / Image (DESIGN_SPEC §3.2), the method picked by the
// LC-6 spike (spike/blur/README.md): MediaPipe ImageSegmenter + selfie_segmenter on the
// GPU delegate, sharing one WebGL2 context with the compositor so the mask never leaves
// the GPU. CPU delegate as the fallback.
//
// Per frame: crop the camera to what the bubble shows (zoom + face centre) into a small
// canvas → segment that crop → EMA/feather the mask → composite blur or image → the GL
// canvas, which the caller draws into its bubble shape.
import { visionBundle, visionFileset, MODEL_URL } from '../vision.js';
import { cropRect } from '../../../shared/geometry.js';
import { Compositor } from './compositor.js';
import { loadBackgroundImage } from './images.js';

// Spike settings (LC-7 ticket): adaptive EMA α 0.45 gain 2, feather 1.0, joint-bilateral
// refine σ 0.012, edge smoothstep(0.5, 0.9), blur at ¼ res 2× 9-tap passes, step 1.6.
export const BG_SETTINGS = Object.freeze({ alpha: 0.45, gain: 2, feather: 1.0, lo: 0.5, hi: 0.9, sigma: 0.012, blurPasses: 2, blurStep: 1.6 });

const MAX_SIDE = 800; // XL bubble ≈ 800 px at 2×; the cost scales with output pixels
const WARM_LIMIT_MS = 8000; // a GPU warm-up longer than this → CPU
const SLOW_MS = 30; // CPU path: rolling median above this → "Background paused" (spec §3.2)
const SOFTWARE_GL = /swiftshader|llvmpipe|basic render|software/i;

// Delegate choice is made once per window and remembered (fallback ladder, spike README).
let preferred = null;

function probeDelegate() {
  if (globalThis.__bgForceCPU) return 'CPU'; // test hook (dev control eval)
  if (preferred) return preferred;
  const c = document.createElement('canvas');
  const gl = c.getContext('webgl2');
  let renderer = '';
  if (gl) {
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    renderer = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
  preferred = gl && !SOFTWARE_GL.test(renderer) ? 'GPU' : 'CPU';
  return preferred;
}

export class CameraBackground {
  // onStatus(status): 'loading' | 'ready' | 'paused' | 'failed'
  // maxSide: the largest side composited (Camera only passes its output size; the bubble
  // keeps MAX_SIDE).
  constructor({ onStatus = () => {}, log = () => {}, maxSide = MAX_SIDE } = {}) {
    this.maxSide = maxSide;
    this.onStatus = onStatus;
    this.log = log;
    this.mode = 'none';
    this.imageRef = null;
    this.status = 'idle';
    this.delegate = null;
    this.seg = null;
    this.comp = null;
    this.canvas = null;
    this.crop = document.createElement('canvas');
    this.cropCtx = this.crop.getContext('2d', { alpha: false });
    this.lastTs = 0;
    this.times = [];
    this.ready = null;
    this.closed = false;
  }

  // Load + warm up. Call when the user picks Blur/Image (or at countdown), never at Record:
  // the first GPU inference compiles shaders and blocks.
  init() {
    this.ready ??= this.#build(probeDelegate()).catch((e) => {
      this.log(`background unavailable: ${e.message}`);
      this.#setStatus('failed');
    });
    return this.ready;
  }

  async #build(delegate) {
    this.#setStatus('loading');
    const { ImageSegmenter } = await visionBundle();
    const fileset = await visionFileset();
    if (this.closed) return;
    this.#dispose();
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      if (this.closed || this.delegate !== 'GPU') return;
      this.log('WebGL context lost: rebuilding the background on the CPU');
      preferred = 'CPU';
      this.ready = this.#build('CPU');
    });
    const t0 = performance.now();
    let seg;
    try {
      seg = await ImageSegmenter.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: MODEL_URL.selfie, delegate },
        canvas: delegate === 'GPU' ? canvas : undefined,
        runningMode: 'VIDEO',
        outputConfidenceMasks: true,
        outputCategoryMask: false,
      });
    } catch (e) {
      if (delegate === 'GPU') {
        this.log(`GPU segmenter failed (${e.message}); using the CPU`);
        preferred = 'CPU';
        canvas.getContext('webgl2')?.getExtension('WEBGL_lose_context')?.loseContext();
        return this.#build('CPU');
      }
      throw e;
    }
    const gl = canvas.getContext('webgl2', { antialias: false, preserveDrawingBuffer: false });
    if (!gl) throw new Error('no WebGL2');
    Object.assign(this, { seg, canvas, gl, delegate, comp: new Compositor(gl, 256, 256) });
    if (this.image) this.comp.setImage(this.image);
    const loadMs = performance.now() - t0;
    // Warm-up on a dummy frame.
    this.crop.width = 256;
    this.crop.height = 256;
    this.cropCtx.fillStyle = '#556';
    this.cropCtx.fillRect(0, 0, 256, 256);
    const t1 = performance.now();
    this.#segment(this.crop);
    this.comp.render(this.crop, 'blur', BG_SETTINGS);
    this.comp.sync();
    const warmMs = performance.now() - t1;
    this.comp.resetMask();
    this.loadInfo = { delegate, loadMs: Math.round(loadMs), warmMs: Math.round(warmMs) };
    this.log(`background ready ${JSON.stringify(this.loadInfo)}`);
    if (delegate === 'GPU' && warmMs > WARM_LIMIT_MS) {
      preferred = 'CPU';
      return this.#build('CPU');
    }
    this.times = [];
    this.#setStatus('ready');
  }

  #setStatus(s) {
    if (s === this.status) return;
    this.status = s;
    this.onStatus(s);
  }

  async setMode(mode, imageRef) {
    this.mode = mode || 'none';
    if (this.mode === 'none') return;
    if (this.status === 'paused') this.#setStatus('ready');
    this.times = [];
    this.init();
    if (this.mode === 'image' && imageRef !== this.imageRef) {
      this.imageRef = imageRef;
      const img = await loadBackgroundImage(imageRef);
      if (this.imageRef !== imageRef) return;
      this.image = img;
      this.comp?.setImage(img);
    }
  }

  #segment(input) {
    // VIDEO mode needs strictly increasing timestamps (it throws otherwise).
    const ts = Math.max(performance.now(), this.lastTs + 1);
    this.lastTs = ts;
    this.seg.segmentForVideo(input, ts, (res) => {
      const m = res.confidenceMasks?.[0];
      if (!m) return;
      if (this.delegate === 'GPU') this.comp.pushMask({ texture: m.getAsWebGLTexture(), width: m.width, height: m.height }, BG_SETTINGS);
      else this.comp.pushMask({ data: m.getAsFloat32Array(), width: m.width, height: m.height }, BG_SETTINGS);
    });
  }

  // Returns a canvas with the processed crop (outW × outH, unmirrored), or null when the
  // caller should draw the plain camera (mode None, still loading, paused or failed).
  process(video, { width, height, zoom, centre }) {
    if (this.mode === 'none' || this.status !== 'ready' || !video.videoWidth) return null;
    const t0 = performance.now();
    const s = Math.min(1, this.maxSide / Math.max(width, height));
    const W = Math.max(2, Math.round(width * s));
    const H = Math.max(2, Math.round(height * s));
    if (this.crop.width !== W || this.crop.height !== H) {
      this.crop.width = W;
      this.crop.height = H;
    }
    if (this.canvas.width !== W || this.canvas.height !== H) {
      this.canvas.width = W;
      this.canvas.height = H;
    }
    this.comp.resize(W, H);
    // Segment only what the bubble shows: all 256 model pixels land on the visible crop.
    const c = cropRect(video.videoWidth, video.videoHeight, W / H, zoom, centre);
    this.cropCtx.drawImage(video, c.sx, c.sy, c.sw, c.sh, 0, 0, W, H);
    try {
      this.#segment(this.crop);
      this.comp.render(this.crop, this.mode, BG_SETTINGS);
      if (globalThis.__bgSync) this.comp.sync(); // measurement only: include the GPU's time
    } catch (e) {
      this.log(`background frame failed: ${e.message}`);
      return null;
    }
    if (globalThis.__bgSlowMs) while (performance.now() - t0 < globalThis.__bgSlowMs); // test hook: a slow CPU
    const ms = performance.now() - t0;
    this.times.push(ms);
    if (this.times.length > 60) this.times.shift();
    // The CPU path can't keep up → stop rather than drop frames; the preview says so.
    if (this.delegate === 'CPU' && this.times.length === 60 && median(this.times) > SLOW_MS) {
      this.log(`background too slow on the CPU (${median(this.times).toFixed(1)} ms): paused`);
      this.#setStatus('paused');
    }
    return this.canvas;
  }

  #dispose() {
    try {
      this.seg?.close();
    } catch {}
    this.canvas?.getContext('webgl2')?.getExtension('WEBGL_lose_context')?.loseContext();
    this.seg = null;
    this.comp = null;
  }

  // Frees the segmenter and the GL context (leaked contexts hung the spike's page).
  close() {
    this.closed = true;
    this.#dispose();
  }
}

function median(a) {
  const s = [...a].sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)];
}
