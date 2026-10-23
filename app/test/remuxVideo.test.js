// The final mux keeps every video frame. It used -shortest, which cut the last video
// frames (~0.3 s) whenever the audio ended first. Real ffmpeg on synthetic fMP4s shaped
// like the recorder's (H.264 without B-frames + AAC, fragmented).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { SegmentWriter, finalizeSession, sessionsRoot, findFfmpeg, remuxArgs } from '../src/main/session/segments.js';

const ffmpeg = findFfmpeg();
const ffprobe = ffmpeg && path.join(path.dirname(ffmpeg), 'ffprobe');
const canRun = !!ffmpeg && fs.existsSync(ffprobe) && /libx264/.test(execFileSync(ffmpeg, ['-hide_banner', '-encoders'], { encoding: 'utf8' }));
const FRAME = 1 / 30;

function fixture(dir, audioSeconds, videoSeconds = 1) {
  const f = path.join(dir, `in-${audioSeconds}.mp4`);
  execFileSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', `testsrc=size=320x240:rate=30:duration=${videoSeconds}`, '-f', 'lavfi', '-i', `sine=frequency=440:duration=${audioSeconds}`,
    '-c:v', 'libx264', '-bf', '0', '-g', '30', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-movflags', 'frag_keyframe+empty_moov+default_base_moof', f]);
  return f;
}
const probe = (f) => {
  const frames = Number(execFileSync(ffprobe, ['-v', 'error', '-select_streams', 'v:0', '-count_packets', '-show_entries', 'stream=nb_read_packets', '-of', 'csv=p=0', f], { encoding: 'utf8' }).trim());
  const dur = Object.fromEntries(execFileSync(ffprobe, ['-v', 'error', '-show_entries', 'stream=codec_type,duration', '-of', 'csv=p=0', f], { encoding: 'utf8' }).trim().split('\n').map((l) => l.split(',')).map(([k, v]) => [k, Number(v)]));
  return { frames, video: dur.video, audio: dur.audio };
};
// Through the real Stop path: a session folder with the recording as its segments.
async function finish(input) {
  const lib = fs.mkdtempSync(path.join(os.tmpdir(), 'tally-remux-'));
  const dir = path.join(sessionsRoot(lib), 's');
  const w = new SegmentWriter(dir, { baseName: 'take', owner: { pid: 0 } }, { chunksPerSegment: 2 });
  const bytes = fs.readFileSync(input);
  for (let i = 0; i < bytes.length; i += 4096) w.append(bytes.subarray(i, i + 4096));
  await w.close();
  const res = await finalizeSession(dir, lib, 'take', { ffmpeg });
  assert.equal(res.remuxed, true);
  return res.file;
}

test('audio that ends early: every video frame is kept, duration within one frame', { skip: !canRun }, async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tally-fx-'));
  const input = fixture(tmp, 0.7); // 30 frames, audio stops 0.3 s early (the bug)
  const inp = probe(input);
  assert.equal(inp.frames, 30);
  const out = probe(await finish(input));
  assert.equal(out.frames, inp.frames, 'no video frame cut');
  assert.ok(Math.abs(out.video - 30 / 30) <= FRAME, `video ${out.video} s`);
  assert.ok(out.audio < out.video, 'audio left as it is (ends early)');
});

test('audio that runs past the video: only the audio tail is cut, video untouched', { skip: !canRun }, async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tally-fx-'));
  const input = fixture(tmp, 1.4);
  const out = probe(await finish(input));
  assert.equal(out.frames, 30);
  assert.ok(Math.abs(out.video - 1) <= FRAME);
  assert.ok(out.audio <= out.video + FRAME, `audio ${out.audio} s cut to the video (± one AAC frame)`);
});

// Like the packaged recorder: frame 0, then a 0.3 s hole (9 frames dropped while the
// encoder warms up), then the rest of the frames.
function gappedFixture(dir) {
  const f = path.join(dir, 'gapped.mp4');
  const jitter = '0';
  execFileSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=30:duration=1', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1.3',
    '-c:v', 'libx264', '-bf', '0', '-g', '30', '-pix_fmt', 'yuv420p', '-c:a', 'aac',
    '-bsf:v', `setts=pts=${`if(gte(N,1),PTS+(0.3+${jitter})/TB,PTS)`.replace(/,/g, '\\,')}:dts=${`if(gte(N,1),DTS+(0.3+${jitter})/TB,DTS)`.replace(/,/g, '\\,')}`,
    '-movflags', 'frag_keyframe+empty_moov+default_base_moof', f]);
  return f;
}
const ptsList = (f) => execFileSync(ffprobe, ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'packet=pts_time', '-of', 'csv=p=0', f], { encoding: 'utf8' }).trim().split('\n').map(Number).sort((a, b) => a - b);

test('frames dropped mid-take: the hole stays in place (A/V sync), frames land on the 30 fps grid', { skip: !canRun }, async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tally-gap-'));
  const input = gappedFixture(tmp);
  const before = ptsList(input);
  assert.equal(before.length, 30);
  assert.ok(before[1] - before[0] > 0.3, 'fixture has the hole');
  const span = Math.round(before.at(-1) * 30) + 1; // ~39 ticks: 30 kept + ~9 dropped
  assert.ok(span >= 38, `span ${span}`);
  // A normal Stop passes the recorder's tick count.
  const lib = fs.mkdtempSync(path.join(os.tmpdir(), 'tally-remux-'));
  const dir = path.join(sessionsRoot(lib), 's');
  const w = new SegmentWriter(dir, { baseName: 'take', owner: { pid: 0 } });
  w.append(fs.readFileSync(input));
  await w.close();
  const res = await finalizeSession(dir, lib, 'take', { ffmpeg, videoFrames: span });
  const after = ptsList(res.file);
  assert.equal(after.length, 30, 'every frame kept');
  for (const t of after) assert.ok(Math.abs(t * 30 - Math.round(t * 30)) < 0.01, `on the grid: ${t}`);
  for (let i = 1; i < after.length; i++) assert.ok(after[i] > after[i - 1], 'strictly increasing');
  for (let i = 0; i < after.length; i++) assert.ok(Math.abs(after[i] - Math.round(before[i] * 30) / 30) < 1e-3, `frame ${i} keeps its place: ${before[i]} → ${after[i]}`);
  assert.ok(after[1] > 0.3, `the hole after frame 0 is kept (${after[1]})`);
  const out = probe(res.file);
  assert.ok(Math.abs(out.video - span / 30) <= FRAME, `video spans the take: ${out.video} vs ${span / 30}`);
  assert.ok(Math.abs(out.audio - out.video) <= FRAME, `audio ${out.audio} matches video ${out.video}`);
});

test('probe fallback measures the span, not the count (a hole is not cut from the audio)', { skip: !canRun }, async () => {
  const { countVideoFrames } = await import('../src/main/session/segments.js');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tally-gap-'));
  const f = gappedFixture(tmp);
  const pts = ptsList(f);
  assert.equal(pts.length, 30);
  assert.equal(await countVideoFrames(ffmpeg, f), Math.round(pts.at(-1) * 30) + 1, 'span (≈39), not the 30 packets');
});

test('mux arguments: no -shortest; the time limit applies only to the audio input', () => {
  const a = remuxArgs('in.mp4', 'out.mp4', 90);
  assert.ok(!a.includes('-shortest'));
  assert.deepEqual(a.slice(a.indexOf('-t'), a.indexOf('-t') + 4), ['-t', '3.000000', '-i', 'in.mp4']);
  assert.ok(a.indexOf('-i') < a.indexOf('-t'), 'video input (0) has no limit');
  assert.ok(a.includes('0:v:0') && a.includes('1:a?'));
  // Frames unknown (no ffprobe): nothing is cut at all.
  assert.ok(!remuxArgs('in.mp4', 'out.mp4', null).includes('-t'));
});

test('a normal Stop passes the recorder\'s frame count: no probe of the file', async () => {
  const { remux } = await import('../src/main/session/segments.js');
  const src = fs.readFileSync(new URL('../src/main/controller.js', import.meta.url), 'utf8');
  assert.match(src, /videoFrames: engineStats\?\.frames/);
  if (!canRun) return;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tally-fx-'));
  const input = fixture(tmp, 0.7);
  const never = path.join(tmp, 'ffprobe-never'); // would hang if it were called
  fs.writeFileSync(never, '#!/bin/sh\nsleep 30\n', { mode: 0o755 });
  const t0 = Date.now();
  const r = await remux(ffmpeg, input, path.join(tmp, 'o.mp4'), { frames: 30, probe: { ffprobe: never, timeoutMs: 60_000 } });
  assert.equal(r.frames, 30);
  assert.ok(Date.now() - t0 < 5000, 'probe not run');
  assert.equal(probe(path.join(tmp, 'o.mp4')).frames, 30);
});

test('probe fails or times out → the no-cut path (every frame and all audio kept)', async () => {
  const { countVideoFrames, remux } = await import('../src/main/session/segments.js');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tally-probe-'));
  const slow = path.join(tmp, 'ffprobe-slow');
  fs.writeFileSync(slow, '#!/bin/sh\nsleep 30\necho 999\n', { mode: 0o755 });
  const broken = path.join(tmp, 'ffprobe-broken');
  fs.writeFileSync(broken, '#!/bin/sh\necho oops >&2\nexit 1\n', { mode: 0o755 });
  const t0 = Date.now();
  assert.equal(await countVideoFrames('/x/ffmpeg', '/nope.mp4', { ffprobe: slow, timeoutMs: 200 }), null, 'timeout → null');
  assert.ok(Date.now() - t0 < 3000, 'own short limit, killed');
  assert.equal(await countVideoFrames('/x/ffmpeg', '/nope.mp4', { ffprobe: broken }), null, 'failure → null');
  assert.equal(await countVideoFrames('/x/ffmpeg', '/nope.mp4', { ffprobe: path.join(tmp, 'missing') }), null, 'absent → null');
  if (!canRun) return;
  const input = fixture(tmp, 1.4); // audio longer than the video
  const out = path.join(tmp, 'o.mp4');
  const r = await remux(ffmpeg, input, out, { probe: { ffprobe: slow, timeoutMs: 200 } });
  assert.equal(r.frames, null);
  const p = probe(out);
  assert.equal(p.frames, 30, 'no video frame cut');
  assert.ok(p.audio > 1.3, `audio uncut (${p.audio} s)`);
});
