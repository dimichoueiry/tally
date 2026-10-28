// Hidden engine: capture → composite (screen + camera bubble) → H.264 MP4. Camera only
// (kind 'camera'): no screen at all, the frame is the camera's crop at the chosen aspect.
// The compositor runs on a fixed 30 fps clock and emits exactly one VideoFrame per
// tick into a MediaStreamTrackGenerator, so a still screen still yields 30 fps and
// a stalled thread catches up with repeated frames instead of losing time. The
// finalize step stamps frame N at N/30 s (segments.js), which makes the file CFR.
import { openCamera, stopStream, FaceTracker, drawBubble, CENTRE } from '../shared/camera.js';
import { CameraBackground } from '../shared/bg/background.js';
import { clampZoom, cameraOutputSize, aspectOf } from '../../shared/geometry.js';
import { SYSTEM_AUDIO, VIDEO_BPS, AUDIO_BPS } from '../../shared/media.js';
import { warmEncoder, settleWarmup } from './warmup.js';
import { pickMic, micConstraints, buildMixGraph, connectInput, disconnectInput, peakOf } from '../../shared/mic.js';

const FPS = 30;
const STOP_DRAIN_MS = 300;
const VIDEO_MIME = 'video/mp4;codecs=avc1.640033';
// With system audio and/or the mic: AAC in MP4 where the platform encoder exists (macOS), Opus otherwise.
const AV_MIMES = ['video/mp4;codecs=avc1.640033,mp4a.40.2', 'video/mp4;codecs=avc1.640033,opus'];
const tally = window.tally;
const emit = (type, extra = {}) => tally.send('engine:event', { type, ...extra });
const log = (text) => emit('log', { text });

// Worker timer: not throttled like window timers, and drift-corrected (frame n is
// due at t0 + n·period; a late tick never pushes later ticks back).
const CLOCK_SRC = `
  let t0 = 0, n = 0, timer = null, period = 1000 / ${FPS};
  function schedule() {
    const now = performance.now();
    const next = t0 + (n + 1) * period;
    timer = setTimeout(() => { n++; postMessage(n); schedule(); }, Math.max(0, next - now));
  }
  onmessage = (e) => {
    clearTimeout(timer);
    if (e.data === 'start') { t0 = performance.now(); n = 0; schedule(); }
  };
`;

let S = null; // current session

function newClock(onTick) {
  const w = new Worker(URL.createObjectURL(new Blob([CLOCK_SRC], { type: 'text/javascript' })));
  w.onmessage = onTick;
  return { start: () => w.postMessage('start'), stop: () => w.postMessage('stop'), dispose: () => w.terminate() };
}

async function playVideo(stream) {
  const v = document.createElement('video');
  v.muted = true;
  v.srcObject = stream;
  await v.play();
  if (!v.videoWidth) await new Promise((r) => v.addEventListener('loadedmetadata', r, { once: true }));
  return v;
}

function outputSize(w, h, quality) {
  let s = 1;
  if (quality === '1080p' && h > 1080) s = 1080 / h;
  const even = (n) => Math.max(2, Math.round(n / 2) * 2);
  return { width: even(w * s), height: even(h * s) };
}

const pct = (a, p) => {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  return +s[Math.min(s.length - 1, Math.floor((s.length - 1) * p))].toFixed(2);
};

// ───────── capture ─────────

async function openScreen(wantAudio) {
  // System audio = loopback of what the computer plays (main answers audio: 'loopback'
  // only when the user turned it on). Never a microphone.
  const stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: FPS }, audio: wantAudio ? SYSTEM_AUDIO : false });
  const track = stream.getVideoTracks()[0];
  const video = await playVideo(stream);
  return { stream, track, video };
}

function watchScreen(screen) {
  screen.track.addEventListener('ended', () => {
    if (S?.screen === screen) emit('source-ended');
  });
}

// The recorder gets one stable audio track from an AudioContext destination; system
// audio and the mic (each optional) are mixed into it (shared/mic.js buildMixGraph). If
// an input dies, the recording keeps the (now quieter or silent) track and carries on,
// and the bar warns. A mic that comes back is reconnected into the same graph.
async function openAudioMixer({ system, mic }) {
  const ac = new AudioContext({ sampleRate: 48000, latencyHint: 'playback' });
  if (ac.state !== 'running') await ac.resume().catch(() => {});
  const graph = buildMixGraph(ac, { system: system?.track, mic: mic?.track });
  const mix = { ac, graph, out: graph.dest.stream.getAudioTracks()[0], peak: { system: 0, mic: 0 }, lost: { system: null, mic: null }, info: { system: system?.info || null, mic: mic?.info || null } };
  const buf = new Float32Array(2048);
  mix.meter = setInterval(() => {
    for (const [name, i] of Object.entries(graph.inputs)) mix.peak[name] = Math.max(mix.peak[name], peakOf(i.analyser, buf));
  }, 250);
  for (const name of Object.keys(graph.inputs)) watchInput(mix, name);
  ac.addEventListener('statechange', () => {
    if (ac.state === 'running' || ac.state === 'closed') return;
    for (const name of Object.keys(graph.inputs)) inputLost(mix, name, `context ${ac.state}`);
  });
  return mix;
}

const LOST_EVENT = { system: 'audio-lost', mic: 'mic-lost' };
const BACK_EVENT = { system: 'audio-back', mic: 'mic-back' };

function inputLost(mix, name, reason) {
  if (mix.lost[name] || S?.audio !== mix) return;
  mix.lost[name] = reason;
  log(`${name === 'mic' ? 'microphone' : 'system audio'} ${reason}`);
  emit(LOST_EVENT[name], { reason, label: mix.info[name]?.label });
}

function watchInput(mix, name) {
  const { track } = mix.graph.inputs[name];
  track.addEventListener('ended', () => mix.graph.inputs[name]?.track === track && inputLost(mix, name, 'ended'));
  // A muted track delivers no samples; a short mute can be a device switch, so wait.
  track.addEventListener('mute', () => setTimeout(() => track.muted && mix.graph.inputs[name]?.track === track && inputLost(mix, name, 'muted'), 2000));
  track.addEventListener('unmute', () => {
    if (mix.lost[name] !== 'muted') return;
    mix.lost[name] = null;
    emit(BACK_EVENT[name]);
  });
}

function closeAudio(mix) {
  if (!mix) return;
  clearInterval(mix.meter);
  for (const name of Object.keys(mix.graph.inputs)) {
    mix.graph.inputs[name].track.stop();
    disconnectInput(mix.graph, name);
  }
  mix.ac.close().catch(() => {});
}

// ───────── microphone (optional, off by default) ─────────

// Opens the saved device: same id, else the same label, else the system default.
async function openMic(saved) {
  const devices = await navigator.mediaDevices.enumerateDevices().catch(() => []);
  const pick = pickMic(devices, saved);
  // Before the first grant, device ids are hidden: ask with the saved id (or none).
  const id = pick?.deviceId || saved.deviceId || null;
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia(micConstraints(id));
  } catch (e) {
    if (!id || e.name !== 'OverconstrainedError') throw e;
    stream = await navigator.mediaDevices.getUserMedia(micConstraints(null));
  }
  const track = stream.getAudioTracks()[0];
  const s = track.getSettings();
  return { track, info: { deviceId: s.deviceId || id, label: track.label, by: pick?.by || 'default', settings: s } };
}

// The lost mic came back (re-plugged): reopen it into the running mix.
async function reopenMic(sess) {
  const mix = sess.audio;
  if (!mix?.lost.mic || sess.micReopening || !sess.micWanted) return;
  const devices = await navigator.mediaDevices.enumerateDevices().catch(() => []);
  const want = mix.info.mic || sess.micWanted;
  if (mix.lost.mic === 'muted') return; // comes back by itself (unmute)
  const back = pickMic(devices, { deviceId: want.deviceId, deviceLabel: want.label });
  if (!back || (back.by === 'default' && (want.deviceId || want.label))) return; // the same microphone, never a stand-in
  sess.micReopening = true;
  try {
    const m = await openMic({ deviceId: back.deviceId, deviceLabel: back.label });
    if (sess !== S) return m.track.stop();
    mix.graph.inputs.mic?.track.stop();
    connectInput(mix.ac, mix.graph, 'mic', m.track);
    mix.info.mic = m.info;
    mix.lost.mic = null;
    watchInput(mix, 'mic');
    log(`microphone back: ${m.info.label}`);
    emit('mic-back', { label: m.info.label });
  } catch (e) {
    log(`microphone reopen failed: ${e.name} ${e.message}`);
  }
  sess.micReopening = false;
}

// ───────── camera ─────────

// Camera only asks for the camera's best (the bubble preview asks the same, so the two
// never fight over the device's format).
async function attachCamera(sess, deviceId) {
  return wireCamera(sess, await openCamera(deviceId, { hiRes: sess.kind === 'camera' }), deviceId);
}

function wireCamera(sess, cam, deviceId) {
  const track = cam.stream.getVideoTracks()[0];
  cam.deviceId = track.getSettings().deviceId || deviceId;
  cam.label = track.label;
  track.addEventListener('ended', () => {
    if (sess.cam !== cam) return;
    // Camera unplugged: the screen keeps recording; the video loses the bubble from now.
    // Camera only keeps its clock running on a dark frame until the camera is back.
    sess.cam = null;
    sess.camLost = { deviceId: cam.deviceId, label: cam.label };
    stopStream(cam.stream);
    log(`camera lost: ${cam.label}`);
    emit('camera-lost', { label: cam.label });
  });
  sess.cam = cam;
  return cam;
}

// The same device came back (spec §3.8): reopen it and put the bubble back.
async function onDeviceChange() {
  const sess = S;
  if (!sess?.camLost || sess.reopening) return;
  const devices = await navigator.mediaDevices.enumerateDevices().catch(() => []);
  const back = devices.find((d) => d.kind === 'videoinput' && (d.deviceId === sess.camLost.deviceId || d.label === sess.camLost.label));
  if (!back) return;
  sess.reopening = true;
  try {
    await attachCamera(sess, back.deviceId);
    sess.camLost = null;
    emit('camera-back', { label: sess.cam.label });
  } catch (e) {
    log(`camera reopen failed: ${e.message}`);
  }
  sess.reopening = false;
}
navigator.mediaDevices.addEventListener('devicechange', onDeviceChange);
navigator.mediaDevices.addEventListener('devicechange', () => S && reopenMic(S));

// ───────── compositing ─────────

// One output frame: the canvas as it is now.
function emitFrame() {
  // Continues after the warm-up frames: the track's timestamps never go back.
  const ts = Math.round(S.tsBase + (S.frames * 1e6) / FPS);
  if (S.writer) {
    const vf = new VideoFrame(S.canvas, { timestamp: ts, duration: Math.round(1e6 / FPS) });
    S.lastWrite = S.writer.write(vf).catch(() => {}).finally(() => vf.close());
  } else S.track.requestFrame();
  S.frames++;
}

// Camera only: the whole frame is the camera, cropped to the output's aspect exactly like
// the setup preview (same cropRect), with zoom, face follow, mirror and background.
function composeCamera() {
  const { ctx, canvas, cam, bubble, face } = S;
  const v = cam?.video;
  if (!v?.videoWidth) {
    ctx.fillStyle = '#0b0e0d';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    return;
  }
  const centre = bubble?.follow ? face.update(v) : CENTRE;
  const zoom = clampZoom(bubble?.zoom ?? 1, v.videoWidth, v.videoHeight);
  const tb = performance.now();
  const processed = S.bg?.process(v, { width: canvas.width, height: canvas.height, zoom, centre });
  if (processed) S.perf.bg.push(performance.now() - tb);
  drawBubble(ctx, processed || v, {
    x: 0, y: 0, w: canvas.width, h: canvas.height,
    shape: 'frame', zoom: processed ? 1 : zoom, centre: processed ? CENTRE : centre, mirror: bubble?.mirror !== false, clip: false,
  });
  S.cameraUsed = true;
}

function compose() {
  if (S.kind === 'camera') return composeCamera();
  const { ctx, canvas, screen, cam, bubble, face } = S;
  const sv = screen.video;
  const fw = sv.videoWidth;
  const fh = sv.videoHeight;
  if (!fw || !fh) return;
  // Letterbox if the source changes size mid-recording (window resized, or switched to a display).
  const s = Math.min(canvas.width / fw, canvas.height / fh);
  const dw = fw * s;
  const dh = fh * s;
  const dx = (canvas.width - dw) / 2;
  const dy = (canvas.height - dh) / 2;
  if (dw !== canvas.width || dh !== canvas.height) {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  ctx.drawImage(sv, dx, dy, dw, dh);
  if (S.kind === 'display' && S.mask) paintMask(S.mask, dx, dy, dw, dh);

  if (cam && bubble && !bubble.hidden && bubble.rect) {
    // pt → output px: the capture area (display or window, in screen pt) maps onto (dx, dy, dw, dh).
    let k;
    let bx;
    let by;
    if (bubble.capture) {
      k = dw / bubble.capture.width;
      bx = dx + (bubble.rect.x - bubble.capture.x) * k;
      by = dy + (bubble.rect.y - bubble.capture.y) * k;
    } else {
      // Window bounds unknown (no native helper): bottom-left inset of the capture.
      k = (dw / fw) * (S.captureScale || 2);
      bx = dx + 24 * k;
      by = dy + dh - (24 + bubble.rect.height) * k;
    }
    const v = cam.video;
    const centre = bubble.follow ? face.update(v) : CENTRE;
    const zoom = clampZoom(bubble.zoom, v.videoWidth, v.videoHeight);
    const w = bubble.rect.width * k;
    const h = bubble.rect.height * k;
    const tb = performance.now();
    const processed = S.bg?.process(v, { width: w, height: h, zoom, centre });
    if (processed) S.perf.bg.push(performance.now() - tb);
    drawBubble(ctx, processed || v, {
      x: bx, y: by, w, h,
      shape: bubble.shape, zoom: processed ? 1 : zoom, centre: processed ? CENTRE : centre, mirror: bubble.mirror !== false, scale: k,
    });
    S.cameraUsed = true;
  }
}

// Privacy levels: paint the cover's look (or the wallpaper) over the menu-bar / Dock
// strips. Rects are display pt; the fill image covers the whole display. Pixel edges are
// rounded outward so no sliver of the real bar shows.
function paintMask(mask, dx, dy, dw, dh) {
  const k = dw / mask.size.width;
  const fx = mask.bitmap.width / mask.size.width;
  const fy = mask.bitmap.height / mask.size.height;
  for (const r of mask.rects) {
    const x0 = Math.floor(dx + r.x * k);
    const y0 = Math.floor(dy + r.y * k);
    const x1 = Math.min(Math.ceil(dx + (r.x + r.width) * k), dx + dw);
    const y1 = Math.min(Math.ceil(dy + (r.y + r.height) * k), dy + dh);
    const sx = (x0 - dx) / k;
    const sy = (y0 - dy) / k;
    S.ctx.drawImage(mask.bitmap, sx * fx, sy * fy, ((x1 - x0) / k) * fx, ((y1 - y0) / k) * fy, x0, y0, x1 - x0, y1 - y0);
  }
}

async function loadMask(mask) {
  if (!mask?.fill || !mask.rects?.length) return null;
  const img = new Image();
  img.src = mask.fill;
  await img.decode();
  return { rects: mask.rects, size: mask.size, bitmap: await createImageBitmap(img) };
}

function setBackground(b) {
  const mode = b?.background || 'none';
  if (!S?.cam && !S?.camLost) return;
  // Camera only composites at the output's size (up to 2160 on a side), not bubble size.
  if (mode !== 'none' && !S.bg) S.bg = new CameraBackground({ log, onStatus: (st) => emit('bg-status', { status: st }), maxSide: S.kind === 'camera' ? 2160 : undefined });
  S.bg?.setMode(mode, b?.bgImage);
}

// The recorder for a session (the take, and the throwaway warm-up one).
function makeRecorder(sess) {
  const mimeType = sess.audio ? AV_MIMES.find((m) => MediaRecorder.isTypeSupported(m)) : VIDEO_MIME;
  if (!mimeType) throw new Error('No MP4 audio encoder');
  // 1 s keyframe interval → a fragment (and an IPC chunk) per second, so a crash
  // loses at most ~1 s. Chromium-specific option; ignored where unsupported.
  return new MediaRecorder(sess.out, {
    mimeType,
    videoBitsPerSecond: VIDEO_BPS[sess.quality === 'native' ? 'native' : '1080p'],
    ...(sess.audio ? { audioBitsPerSecond: AUDIO_BPS } : {}),
    videoKeyFrameIntervalDuration: 1000,
  });
}

// ~0.5 s of frames into a throwaway recorder during the countdown (warmup.js). Its
// frames take timestamps 0…0.5 s; the take's frames continue after them.
async function warmUp(sess) {
  const per = 1e6 / FPS;
  const r = await warmEncoder({
    makeRecorder: () => makeRecorder(sess),
    emit: (i) => {
      if (S !== sess) return;
      compose();
      if (sess.writer) {
        const vf = new VideoFrame(sess.canvas, { timestamp: Math.round(i * per), duration: Math.round(per) });
        sess.writer.write(vf).catch(() => {}).finally(() => vf.close());
      } else sess.track.requestFrame();
      sess.tsBase = Math.round((i + 1) * per);
    },
    signal: sess.warmCtl.signal,
  }).catch((e) => ({ ok: false, reason: e.message }));
  log(r.ok ? `encoder warmed: ${r.frames} frames in ${r.ms} ms` : `encoder warm-up skipped (${r.reason}); cold start`);
  if (S === sess) compose(); // the take's first frame shows the screen as it is now
  return r;
}

const api = {
  async prepare({ kind, quality, camera, bubble, captureScale, systemAudio, mic, mask, aspect }) {
    await api.abort();
    // Camera only never calls getDisplayMedia: no screen, no screen permission, no system audio.
    const camOnly = kind === 'camera';
    let camFirst = null;
    if (camOnly) {
      // The output size comes from the camera, so it opens first. No camera: prepare fails.
      camFirst = await openCamera(camera.deviceId, { hiRes: true });
      if (!camFirst.video.videoWidth) await new Promise((r) => camFirst.video.addEventListener('loadedmetadata', r, { once: true }));
    }
    const screen = camOnly ? null : await openScreen(!!systemAudio);
    const sysTrack = screen?.stream.getAudioTracks()[0] || null;
    const { width, height } = camOnly
      ? cameraOutputSize(camFirst.video.videoWidth, camFirst.video.videoHeight, aspect, quality)
      : outputSize(screen.video.videoWidth, screen.video.videoHeight, quality);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
    // Preferred: a generator track fed explicit VideoFrames. Fallback: captureStream(0).
    let writer = null;
    let track;
    if (typeof MediaStreamTrackGenerator === 'function') {
      track = new MediaStreamTrackGenerator({ kind: 'video' });
      writer = track.writable.getWriter();
    } else track = canvas.captureStream(0).getVideoTracks()[0];
    S = {
      kind, quality, captureScale, screen, cam: null, camLost: null, bubble, canvas, ctx, writer, track, audio: null, bg: null, aspect: camOnly ? aspectOf(aspect) : null,
      face: new FaceTracker(), frames: 0, ticks: 0, lateTicks: 0, recorder: null, chain: Promise.resolve(),
      discard: false, cameraUsed: false, thumb: null, activeMs: 0, runningSince: null, owed: 0,
      perf: { tick: [], bg: [] }, micWanted: mic?.on ? { deviceId: mic.deviceId, label: mic.deviceLabel } : null,
    };
    S.mask = await loadMask(mask).catch((e) => (log(`privacy mask unavailable: ${e.message}`), null));
    if (!sysTrack && systemAudio) emit('audio-lost', { reason: 'unavailable' });
    let micIn = null;
    if (mic?.on) {
      try {
        micIn = await openMic(mic);
      } catch (e) {
        // Recording goes on without the voice; the bar says so (non-blocking).
        log(`microphone unavailable: ${e.name} ${e.message}`);
        emit('mic-lost', { reason: e.name === 'NotAllowedError' ? 'denied' : 'unavailable', label: mic.deviceLabel });
      }
    }
    // With the mic switched on there is always an audio track, even if the mic failed to
    // open, so a re-plugged mic can join the take (reopenMic).
    if (sysTrack || mic?.on) S.audio = await openAudioMixer({ system: sysTrack && { track: sysTrack, info: { label: sysTrack.label, settings: sysTrack.getSettings() } }, mic: micIn });
    if (S.audio && mic?.on && !micIn) S.audio.lost.mic = 'unavailable';
    S.out = new MediaStream([track, ...(S.audio ? [S.audio.out] : [])]);
    if (screen) watchScreen(screen);
    if (camFirst) wireCamera(S, camFirst, camera.deviceId);
    else if (camera.on) {
      try {
        await attachCamera(S, camera.deviceId);
      } catch (e) {
        log(`camera unavailable: ${e.name} ${e.message}`);
      }
    }
    // Warm the segmenter now (countdown), never on the first recorded frame.
    setBackground(bubble);
    if (S.bg) await S.bg.ready;
    S.clock = newClock((e) => {
      if (!S || S.paused || S.recorder?.state !== 'recording') return;
      // e.data = ticks due since (re)start. Draw once, then emit one frame per due
      // tick; after a stall that repeats the latest image rather than dropping time.
      const due = S.tickBase + e.data;
      const late = due - S.ticks - 1 - S.owed;
      if (late > 0) S.lateTicks += late;
      S.owed = 0;
      const t0 = performance.now();
      compose();
      while (S.ticks < due) {
        emitFrame();
        S.ticks++;
      }
      S.perf.tick.push(performance.now() - t0);
      if (S.perf.tick.length > 20000) S.perf.tick.shift();
      if (!S.thumb && S.frames >= FPS) S.thumb = thumbnail();
    });
    compose(); // first frame ready before start
    // Warm the encoder while the countdown runs (not awaited: prepare isn't longer).
    S.tsBase = 0;
    S.warmCtl = new AbortController();
    S.warm = warmUp(S);
    return {
      width, height, source: screen ? [screen.video.videoWidth, screen.video.videoHeight] : [S.cam?.video.videoWidth, S.cam?.video.videoHeight], camera: !!S.cam,
      settings: screen ? screen.track.getSettings() : S.cam?.stream.getVideoTracks()[0].getSettings(),
      audio: S.audio ? { system: S.audio.info.system, mic: S.audio.info.mic, context: S.audio.ac.state } : null,
      background: S.bg?.loadInfo || null,
      mask: S.mask ? S.mask.rects : null,
    };
  },

  async start() {
    const sess = S;
    // The warm-up finished during the countdown; a countdown cut short waits ≤ 1 s.
    const warm = await settleWarmup(sess.warm, 1000);
    if (sess !== S) throw new Error('session ended');
    sess.warmResult = warm || { ok: false, reason: 'still warming at start' };
    const rec = makeRecorder(sess);
    sess.recorder = rec;
    rec.ondataavailable = (e) => {
      if (!e.data.size || sess.discard) return;
      // Serialise: chunks must reach main in order, and stop() waits for the last one.
      sess.chain = sess.chain.then(async () => {
        if (sess.discard) return;
        tally.send('engine:chunk', new Uint8Array(await e.data.arrayBuffer()));
        sess.chunks = (sess.chunks || 0) + 1;
      });
    };
    // The clock starts with the recorder, not after its 'start' event: Chromium only
    // fires that once media flows, so waiting for it held the frames back (~0.5 s) while
    // the audio was already recording (audio ahead of video). The warm-up is what makes
    // the first frames reach a running encoder; the event's delay is only logged.
    const t0 = performance.now();
    rec.addEventListener('start', () => (sess.startEventMs = Math.round(performance.now() - t0)), { once: true });
    rec.start(1000);
    S.runningSince = performance.now();
    S.tickBase = 0;
    S.clock.start();
    return { mimeType: rec.mimeType, warmup: sess.warmResult };
  },

  // Pause/resume settle asynchronously inside MediaRecorder. Frames written while
  // it is switching are dropped, so: stop the clock, let the last frames reach the
  // encoder, then pause; on resume, wait for the recorder before emitting again.
  // Audio keeps recording through that drain (~2 frames), so with audio the video owes
  // those frames: the first tick after resume repeats the image to pay them back, and
  // the voice stays in sync across any number of pauses.
  async pause() {
    if (S?.recorder?.state !== 'recording') return;
    const sess = S;
    sess.clock.stop();
    const stoppedAt = performance.now();
    sess.activeMs += stoppedAt - sess.runningSince;
    sess.runningSince = null;
    sess.paused = true;
    await sess.lastWrite;
    await new Promise((r) => setTimeout(r, 2 * (1000 / FPS)));
    const done = new Promise((r) => sess.recorder.addEventListener('pause', r, { once: true }));
    if (sess.audio) {
      const owe = Math.round((performance.now() - stoppedAt) / (1000 / FPS));
      sess.owed += owe;
      sess.activeMs += (owe * 1000) / FPS;
    }
    sess.recorder.pause();
    await done;
  },

  async resume() {
    if (S?.recorder?.state !== 'paused') return;
    const sess = S;
    const done = new Promise((r) => sess.recorder.addEventListener('resume', r, { once: true }));
    sess.recorder.resume();
    await done;
    sess.paused = false;
    sess.runningSince = performance.now();
    sess.tickBase = sess.ticks + sess.owed; // the worker counts from 0 again; owed frames go out on its first tick
    sess.clock.start();
  },

  // The recorded window closed (or its display went away): continue on a display.
  // Video only: the audio mixer keeps its tracks, and MediaRecorder can't
  // change resolution, so the display is letterboxed into the existing frame.
  async switchSource({ captureScale, mask }) {
    if (!S) throw new Error('no session');
    if (S.kind === 'camera') throw new Error('camera only has no screen to switch');
    const next = await openScreen(false);
    S.mask?.bitmap.close();
    S.mask = await loadMask(mask).catch(() => null);
    const old = S.screen;
    S.screen = next;
    S.kind = 'display';
    S.captureScale = captureScale;
    watchScreen(next);
    old.stream.getVideoTracks().forEach((t) => t.stop());
    compose();
    return { source: [next.video.videoWidth, next.video.videoHeight] };
  },

  bubble(b) {
    if (!S) return;
    const prev = S.bubble;
    S.bubble = b;
    if (prev?.background !== b.background || prev?.bgImage !== b.bgImage) setBackground(b);
  },

  // Test hook (dev control): behave as if the camera was unplugged / came back.
  simulate({ what }) {
    if (what === 'camera-lost' && S?.cam) S.cam.stream.getVideoTracks()[0].dispatchEvent(new Event('ended'));
    if (what === 'camera-back') return onDeviceChange();
    if (what === 'audio-lost' && S?.audio?.graph.inputs.system) S.audio.graph.inputs.system.track.dispatchEvent(new Event('ended'));
    // mic-lost: the device was unplugged (the track really stops); mic-back: it is there again.
    if (what === 'mic-lost' && S?.audio?.graph.inputs.mic) {
      const t = S.audio.graph.inputs.mic.track;
      t.stop();
      t.dispatchEvent(new Event('ended'));
    }
    if (what === 'mic-back' && S) return reopenMic(S).then(() => ({ micLost: S?.audio?.lost.mic ?? null }));
    return { cam: !!S?.cam, camLost: S?.camLost || null, audioLost: S?.audio?.lost || null };
  },

  perf() {
    return S ? summary(S) : null;
  },

  async stop() {
    const sess = S;
    if (!sess?.recorder) throw new Error('not recording');
    sess.clock.stop();
    // Recorded time ends now, not after the drain below (that wait used to be
    // counted, so duration looked 2 frames longer than the frames written).
    if (sess.runningSince != null) sess.activeMs += performance.now() - sess.runningSince;
    sess.runningSince = null;
    await sess.lastWrite;
    // Let the last frames get through the encoder before stopping it: MediaRecorder
    // drops frames still in flight at stop(). 2 frame periods lost 0–2 frames in
    // M1/M2 runs (hardware encoder latency varies); STOP_DRAIN_MS is the measured fix.
    await new Promise((r) => setTimeout(r, STOP_DRAIN_MS));
    const stopped = new Promise((r) => (sess.recorder.onstop = r));
    sess.recorder.stop();
    await stopped;
    await sess.chain;
    const stats = {
      frames: sess.frames,
      lateTicks: sess.lateTicks,
      chunks: sess.chunks || 0,
      generator: !!sess.writer,
      durationMs: Math.round(sess.activeMs),
      width: sess.canvas.width,
      height: sess.canvas.height,
      cameraUsed: sess.cameraUsed,
      mimeType: sess.recorder.mimeType,
      warmup: sess.warmResult || null,
      startEventMs: sess.startEventMs ?? null,
      audio: sess.audio
        ? {
            peak: { system: +sess.audio.peak.system.toFixed(4), mic: +sess.audio.peak.mic.toFixed(4) },
            lost: sess.audio.lost,
            system: sess.audio.info.system && { label: sess.audio.info.system.label },
            mic: sess.audio.info.mic && { label: sess.audio.info.mic.label, by: sess.audio.info.mic.by, settings: sess.audio.info.mic.settings },
          }
        : null,
      perf: summary(sess),
      thumb: sess.thumb || thumbnail(),
    };
    teardown();
    return stats;
  },

  async abort() {
    if (!S) return;
    S.discard = true;
    S.warmCtl?.abort(); // cancel or restart during the countdown: the warm-up stops too
    try {
      S.clock?.stop();
      if (S.recorder && S.recorder.state !== 'inactive') S.recorder.stop();
    } catch {}
    teardown();
  },
};

function summary(sess) {
  const p = sess.perf;
  return {
    tick: { n: p.tick.length, med: pct(p.tick, 0.5), p95: pct(p.tick, 0.95) },
    bg: { n: p.bg.length, med: pct(p.bg, 0.5), p95: pct(p.bg, 0.95), delegate: sess.bg?.delegate || null, status: sess.bg?.status || null, mode: sess.bg?.mode || 'none' },
    // Face detection runs at 10 Hz, off the frame path (async bitmap → detect).
    face: { n: sess.face.times.length, med: pct(sess.face.times, 0.5), p95: pct(sess.face.times, 0.95) },
  };
}

function thumbnail() {
  const c = document.createElement('canvas');
  c.width = 320;
  c.height = Math.round((320 * S.canvas.height) / S.canvas.width);
  c.getContext('2d').drawImage(S.canvas, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.8);
}

function teardown() {
  if (!S) return;
  S.warmCtl?.abort();
  S.clock?.dispose();
  stopStream(S.screen?.stream);
  stopStream(S.cam?.stream);
  closeAudio(S.audio);
  S.face?.close();
  S.bg?.close(); // frees the segmenter and its WebGL context
  S.mask?.bitmap.close();
  S = null;
}

tally.on('engine:call', async ({ id, method, args }) => {
  try {
    const result = await api[method](args);
    tally.send('engine:reply', { id, result: result ?? null });
  } catch (e) {
    tally.send('engine:reply', { id, error: `${e.name || 'Error'}: ${e.message || e}` });
  }
});
