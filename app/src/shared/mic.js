// Optional microphone (off by default). Pure helpers shared by the engine (recording),
// the toolbar (level meter) and the tests: which input device to open, the capture
// constraints, and the WebAudio graph that mixes the mic with system audio.

// Voice processing on, unlike system audio (shared/media.js): the mic is a voice in a room.
export const MIC_AUDIO = Object.freeze({ echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 });

// macOS prefixes the system default's label ("Default - MacBook Pro Microphone").
export const cleanMicLabel = (label = '') => label.replace(/^Default\s*[-–]\s*/i, '').replace(/\s*\([0-9a-f]{4}:[0-9a-f]{4}\)$/i, '').trim();

// Chromium lists the system default (and on Windows the communications device) twice:
// once as an alias, once as itself.
const isAlias = (d) => d.deviceId === 'default' || d.deviceId === 'communications';

// The device to open for the saved choice: same deviceId, else the same label (ids
// change when a device is re-plugged or permissions are reset), else the system default.
// Always a real device when one can be told apart from the alias, so the recording
// stays on that microphone even if the system default changes mid-take.
// Returns { deviceId, label, by: 'id' | 'label' | 'default' } or null when there is no input.
export function pickMic(devices, { deviceId = null, deviceLabel = null } = {}) {
  const inputs = (devices || []).filter((d) => d.kind === 'audioinput' && d.deviceId);
  if (!inputs.length) return null;
  const real = inputs.filter((d) => !isAlias(d));
  const out = (d, by) => ({ deviceId: d.deviceId, label: cleanMicLabel(d.label), by });
  if (deviceId) {
    const d = inputs.find((x) => x.deviceId === deviceId);
    if (d) return out(d, 'id');
  }
  if (deviceLabel) {
    const want = cleanMicLabel(deviceLabel);
    const d = real.find((x) => cleanMicLabel(x.label) === want);
    if (d) return out(d, 'label');
  }
  const def = inputs.find((x) => x.deviceId === 'default');
  const concrete = def && real.find((x) => cleanMicLabel(x.label) === cleanMicLabel(def.label));
  return out(concrete || real[0] || def || inputs[0], 'default');
}

// What the picker lists: real devices only, and which one is in use.
export function micChoices(devices, saved = {}) {
  const real = (devices || []).filter((d) => d.kind === 'audioinput' && d.deviceId && !isAlias(d));
  const cur = pickMic(devices, saved);
  return { list: real.map((d) => ({ deviceId: d.deviceId, label: cleanMicLabel(d.label) || 'Microphone' })), current: cur && !isAlias(cur) ? cur.deviceId : real[0]?.deviceId || null, by: cur?.by || null };
}

export const micConstraints = (deviceId) => ({ audio: { ...MIC_AUDIO, ...(deviceId ? { deviceId: { exact: deviceId } } : {}) }, video: false });

// The recorder's one audio track: every input (system audio, mic) → its own gain →
// a stereo MediaStreamDestination. A mono mic is up-mixed to both channels
// (channelInterpretation 'speakers'). Each input also feeds an analyser, for the
// level and for "is it still delivering". Inputs can be swapped (mic re-plugged)
// without touching the destination, so the recorder's track never changes.
// `ac` is an AudioContext (or a test double with the same node factories).
export function buildMixGraph(ac, inputs = {}) {
  const dest = ac.createMediaStreamDestination();
  dest.channelCount = 2;
  dest.channelCountMode = 'explicit';
  dest.channelInterpretation = 'speakers';
  const graph = { dest, inputs: {} };
  for (const [name, track] of Object.entries(inputs)) if (track) connectInput(ac, graph, name, track);
  return graph;
}

export function connectInput(ac, graph, name, track) {
  disconnectInput(graph, name);
  const src = ac.createMediaStreamSource(new MediaStream([track]));
  const gain = ac.createGain();
  gain.gain.value = 1;
  const analyser = ac.createAnalyser();
  analyser.fftSize = 2048;
  src.connect(gain);
  gain.connect(graph.dest);
  src.connect(analyser);
  graph.inputs[name] = { track, src, gain, analyser };
  return graph.inputs[name];
}

export function disconnectInput(graph, name) {
  const i = graph.inputs[name];
  if (!i) return;
  try {
    i.src.disconnect();
    i.gain.disconnect();
  } catch {}
  delete graph.inputs[name];
}

// Peak of an analyser's current window (0–1).
export function peakOf(analyser, buf = new Float32Array(analyser.fftSize)) {
  analyser.getFloatTimeDomainData(buf);
  let p = 0;
  for (const v of buf) p = Math.max(p, Math.abs(v));
  return p;
}

// Meter position (0–1) for a peak: dBFS over a 60 dB range, so a normal voice sits mid-way.
export const meterLevel = (peak) => (peak > 0 ? Math.max(0, Math.min(1, 1 + (20 * Math.log10(peak)) / 60)) : 0);
