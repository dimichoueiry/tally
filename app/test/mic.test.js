// The optional microphone: off by default, used only when switched on, and only by the
// windows that need it. Permission policy, device choice, the mix graph, and scans of
// the source and build config that keep those rules honest.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { allowPermissionRequest, allowPermissionCheck, displayMediaStreams, SYSTEM_AUDIO_CONSTRAINTS } from '../src/main/mediaPolicy.js';
import { MIC_AUDIO, pickMic, micChoices, micConstraints, cleanMicLabel, buildMixGraph, connectInput, disconnectInput, meterLevel } from '../src/shared/mic.js';
import { DEFAULTS } from '../src/main/settings.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const SRC = path.join(ROOT, 'src');
const files = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(path.join(dir, e.name)) : /\.(m?js|cjs|html)$/.test(e.name) ? [path.join(dir, e.name)] : []));
const sources = files(SRC).map((f) => ({ f: path.relative(SRC, f), text: fs.readFileSync(f, 'utf8') }));

test('microphone is off by default', () => {
  assert.deepEqual(DEFAULTS.mic, { on: false, deviceId: null, deviceLabel: null });
  assert.equal(DEFAULTS.systemAudio, false);
});

test('permission policy: camera yes, microphone only when allowed', () => {
  assert.equal(allowPermissionRequest('media', { mediaTypes: ['video'] }), true);
  assert.equal(allowPermissionRequest('media', { mediaTypes: ['audio'] }), false);
  assert.equal(allowPermissionRequest('media', { mediaTypes: ['video', 'audio'] }), false);
  assert.equal(allowPermissionRequest('media', { mediaTypes: ['audio'] }, { micAllowed: true }), true);
  assert.equal(allowPermissionRequest('media', {}, { micAllowed: true }), false);
  assert.equal(allowPermissionRequest('display-capture'), true);
  assert.equal(allowPermissionRequest('geolocation', {}, { micAllowed: true }), false);
  assert.equal(allowPermissionCheck('media', { mediaType: 'audio' }), false);
  assert.equal(allowPermissionCheck('media', { mediaType: 'audio' }, { micAllowed: true }), true);
  assert.equal(allowPermissionCheck('media', { mediaType: 'video' }), true);
});

test('system audio is loopback only, only when asked for and switched on', () => {
  const src = { id: 'screen:1:0' };
  assert.deepEqual(displayMediaStreams(src, { audioRequested: true, systemAudio: false }), { video: src });
  assert.deepEqual(displayMediaStreams(src, { audioRequested: false, systemAudio: true }), { video: src });
  assert.deepEqual(displayMediaStreams(src, { audioRequested: true, systemAudio: true }), { video: src, audio: 'loopback' });
  assert.deepEqual(SYSTEM_AUDIO_CONSTRAINTS, { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 2 });
});

test('mic constraints: voice processing on, exact device when known', () => {
  assert.deepEqual(MIC_AUDIO, { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 });
  assert.deepEqual(micConstraints('abc'), { audio: { ...MIC_AUDIO, deviceId: { exact: 'abc' } }, video: false });
  assert.deepEqual(micConstraints(null), { audio: { ...MIC_AUDIO }, video: false });
});

const dev = (deviceId, label, kind = 'audioinput') => ({ deviceId, label, kind });
const DEVICES = [
  dev('default', 'Default - MacBook Pro Microphone'),
  dev('mbp', 'MacBook Pro Microphone'),
  dev('usb', 'Shure MV7 (14ed:1012)'),
  dev('cam', 'FaceTime HD Camera', 'videoinput'),
  dev('spk', 'MacBook Pro Speakers', 'audiooutput'),
];

test('device choice: id, then label, then the system default (a real device)', () => {
  assert.deepEqual(pickMic(DEVICES, { deviceId: 'usb', deviceLabel: 'Shure MV7 (14ed:1012)' }), { deviceId: 'usb', label: 'Shure MV7', by: 'id' });
  // Re-plugged: new id, same name.
  const replugged = DEVICES.map((d) => (d.deviceId === 'usb' ? { ...d, deviceId: 'usb2' } : d));
  assert.deepEqual(pickMic(replugged, { deviceId: 'usb', deviceLabel: 'Shure MV7 (14ed:1012)' }), { deviceId: 'usb2', label: 'Shure MV7', by: 'label' });
  // Gone: the system default, resolved to the device behind the alias.
  assert.deepEqual(pickMic(DEVICES.filter((d) => d.deviceId !== 'usb'), { deviceId: 'usb', deviceLabel: 'Shure MV7' }), { deviceId: 'mbp', label: 'MacBook Pro Microphone', by: 'default' });
  assert.deepEqual(pickMic(DEVICES, {}), { deviceId: 'mbp', label: 'MacBook Pro Microphone', by: 'default' });
  // Only the alias is listed: the alias itself.
  assert.equal(pickMic([dev('default', '')], {}).deviceId, 'default');
  assert.equal(pickMic([], {}), null);
  assert.equal(pickMic([dev('', '')], {}), null); // ids hidden until access is granted
  assert.equal(pickMic([dev('cam', 'FaceTime HD Camera', 'videoinput')], {}), null);
});

test('device picker lists real inputs once, with the one in use', () => {
  const c = micChoices(DEVICES, { deviceId: null });
  assert.deepEqual(c.list, [{ deviceId: 'mbp', label: 'MacBook Pro Microphone' }, { deviceId: 'usb', label: 'Shure MV7' }]);
  assert.equal(c.current, 'mbp');
  assert.equal(micChoices(DEVICES, { deviceId: 'usb' }).current, 'usb');
  assert.equal(micChoices([], {}).current, null);
  assert.equal(cleanMicLabel('Default - AirPods Pro'), 'AirPods Pro');
});

// A test double for the parts of AudioContext the graph uses; it records every edge.
function fakeAudio() {
  let edges = [];
  const node = (kind) => {
    const n = {
      kind,
      connect: (to) => edges.push([n, to]),
      disconnect: () => (edges = edges.filter(([a]) => a !== n)),
    };
    return n;
  };
  globalThis.MediaStream = class {
    constructor(tracks) {
      this.tracks = tracks;
    }
  };
  const ac = {
    createMediaStreamDestination: () => Object.assign(node('dest'), { stream: { getAudioTracks: () => ['out'] } }),
    createMediaStreamSource: (s) => Object.assign(node('src'), { stream: s }),
    createGain: () => Object.assign(node('gain'), { gain: { value: 0 } }),
    createAnalyser: () => Object.assign(node('analyser'), { fftSize: 0 }),
  };
  return { ac, edges: () => edges, has: (from, to) => edges.some(([a, b]) => a === from && b === to) };
}

test('mix graph: system + mic → one stereo destination, each with a gain and an analyser', () => {
  const { ac, edges, has } = fakeAudio();
  const g = buildMixGraph(ac, { system: 'sysTrack', mic: 'micTrack' });
  assert.equal(g.dest.channelCount, 2);
  assert.equal(g.dest.channelCountMode, 'explicit');
  assert.equal(g.dest.channelInterpretation, 'speakers'); // a mono mic is up-mixed to L + R
  assert.deepEqual(Object.keys(g.inputs), ['system', 'mic']);
  assert.deepEqual(g.inputs.system.src.stream.tracks, ['sysTrack']);
  assert.deepEqual(g.inputs.mic.src.stream.tracks, ['micTrack']);
  for (const i of Object.values(g.inputs)) {
    assert.ok(has(i.src, i.gain) && has(i.gain, g.dest) && has(i.src, i.analyser));
    assert.equal(i.gain.gain.value, 1);
    assert.ok(!has(i.analyser, g.dest));
  }
  assert.equal(edges().filter(([, b]) => b === g.dest).length, 2);
});

test('mix graph: mic only, system only, or nothing (a silent track)', () => {
  assert.deepEqual(Object.keys(buildMixGraph(fakeAudio().ac, { system: null, mic: 'm' }).inputs), ['mic']);
  assert.deepEqual(Object.keys(buildMixGraph(fakeAudio().ac, { system: 's', mic: undefined }).inputs), ['system']);
  const g = buildMixGraph(fakeAudio().ac, {});
  assert.deepEqual(Object.keys(g.inputs), []);
  assert.equal(g.dest.stream.getAudioTracks()[0], 'out');
});

test('mix graph: a re-plugged mic replaces the old input; the destination stays', () => {
  const { ac, edges } = fakeAudio();
  const g = buildMixGraph(ac, { system: 's', mic: 'm1' });
  const { dest } = g;
  const old = g.inputs.mic;
  connectInput(ac, g, 'mic', 'm2');
  assert.equal(g.dest, dest);
  assert.notEqual(g.inputs.mic, old);
  assert.ok(!edges().some(([a]) => a === old.src || a === old.gain), 'old mic disconnected');
  assert.equal(edges().filter(([, b]) => b === dest).length, 2);
  disconnectInput(g, 'mic');
  assert.deepEqual(Object.keys(g.inputs), ['system']);
  assert.equal(edges().filter(([, b]) => b === dest).length, 1);
});

test('level meter: dBFS over 60 dB', () => {
  assert.equal(meterLevel(0), 0);
  assert.equal(meterLevel(1), 1);
  assert.equal(meterLevel(0.001), 0); // −60 dB
  assert.ok(Math.abs(meterLevel(0.1) - 2 / 3) < 1e-9); // −20 dB
});

test('source scan: camera getUserMedia is video-only; audio only through micConstraints', () => {
  let calls = 0;
  for (const { f, text } of sources) {
    for (const m of text.matchAll(/getUserMedia\s*\(/g)) {
      calls++;
      const args = text.slice(m.index, text.indexOf(';', m.index));
      assert.match(args, /audio:\s*false|micConstraints\(/, `${f}: getUserMedia neither video-only nor the mic → ${args.slice(0, 120)}`);
    }
  }
  assert.ok(calls > 0);
  const micUsers = sources.filter(({ text }) => /getUserMedia\(micConstraints\(/.test(text)).map(({ f }) => f).sort();
  assert.deepEqual(micUsers, ['renderer/bar/bar.js', 'renderer/engine/engine.js']);
  for (const { f, text } of sources) assert.doesNotMatch(text, /audio:\s*true/, `${f}: audio: true`);
});

test('source scan: the mic permission is asked only from the Microphone switch path', () => {
  const ask = sources.filter(({ text }) => /askForMediaAccess\(\s*['"]microphone/.test(text)).map(({ f }) => f);
  assert.deepEqual(ask, ['main/permissions.js']);
  const callers = sources.filter(({ text }) => /\.requestMic\(\)/.test(text)).map(({ f }) => f).sort();
  assert.deepEqual(callers, ['main/index.js']); // app:micAccess, which the switches call
});

test('source scan: getDisplayMedia audio uses the system-audio constraints or false', () => {
  for (const { f, text } of sources) {
    for (const m of text.matchAll(/getDisplayMedia\s*\(/g)) {
      const args = text.slice(m.index, text.indexOf(';', m.index));
      assert.match(args, /audio:\s*(false|wantAudio \? SYSTEM_AUDIO : false)/, `${f}: ${args.slice(0, 160)}`);
    }
  }
});

test('build: honest usage strings, audio-input entitlement, afterPack keeps the mic key', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const info = pkg.build.mac.extendInfo;
  assert.match(info.NSMicrophoneUsageDescription, /only when you turn Microphone on/);
  for (const k of ['NSCameraUsageDescription', 'NSAudioCaptureUsageDescription']) assert.doesNotMatch(info[k], /never (uses|records) the microphone/i, k);
  assert.equal(pkg.build.mac.hardenedRuntime, true);
  for (const f of ['entitlements.mac.plist', 'entitlements.mac.inherit.plist']) {
    const x = fs.readFileSync(path.join(ROOT, 'build', f), 'utf8');
    assert.match(x, /<key>com\.apple\.security\.device\.audio-input<\/key><true\/>/, f);
    assert.match(x, /<key>com\.apple\.security\.device\.camera<\/key><true\/>/, f);
  }
  const drop = fs.readFileSync(path.join(ROOT, 'build', 'afterPack.cjs'), 'utf8').match(/const DROP = \[([^\]]*)\]/)[1];
  assert.doesNotMatch(drop, /NSMicrophoneUsageDescription/);
  assert.match(drop, /NSBluetoothAlwaysUsageDescription/);
  assert.match(drop, /NSBluetoothPeripheralUsageDescription/);
});
