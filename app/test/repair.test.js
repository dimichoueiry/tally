import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { walkBoxes, repairFragmented, readDuration } from '../src/main/session/mp4.js';
import { SegmentWriter, recoverSessions, finalizeSession, sessionsRoot, findFfmpeg, joinInPlace, repairFile } from '../src/main/session/segments.js';

// Sessions in these tests belong to a process that crashed (recovery skips live owners).
const CRASHED = { pid: 0 };
const box = (type, payload = Buffer.alloc(0)) => {
  const h = Buffer.alloc(8);
  h.writeUInt32BE(8 + payload.length, 0);
  h.write(type, 4, 'latin1');
  return Buffer.concat([h, payload]);
};
const mvhd = (timescale, duration) => {
  const p = Buffer.alloc(100);
  p.writeUInt32BE(timescale, 12);
  p.writeUInt32BE(duration, 16);
  return box('mvhd', p);
};
const synth = (frags) =>
  Buffer.concat([box('ftyp', Buffer.from('isom0000')), box('moov', mvhd(1000, 5000)), ...Array.from({ length: frags }, (_, i) => [box('moof', Buffer.alloc(16, i)), box('mdat', Buffer.alloc(64, i))]).flat()]);

test('walkBoxes finds top-level boxes and marks a cut box incomplete', () => {
  const buf = synth(2);
  assert.deepEqual(walkBoxes(buf).map((b) => b.type), ['ftyp', 'moov', 'moof', 'mdat', 'moof', 'mdat']);
  const cut = walkBoxes(buf.subarray(0, buf.length - 10));
  assert.equal(cut.at(-1).complete, false);
});

test('repair keeps complete fragments and drops a truncated tail', () => {
  const full = synth(3);
  const cut = full.subarray(0, full.length - 20); // last mdat cut
  const r = repairFragmented(cut);
  assert.equal(r.ok, true);
  assert.equal(r.fragments, 2);
  assert.deepEqual(r.buf, synth(2));
});

test('repair drops an orphan moof (crash between moof and mdat)', () => {
  const two = synth(2);
  const r = repairFragmented(Buffer.concat([two, box('moof', Buffer.alloc(16))]));
  assert.equal(r.fragments, 2);
  assert.deepEqual(r.buf, two);
});

test('repair refuses a file without moov', () => {
  assert.equal(repairFragmented(Buffer.from([0, 0, 0, 8, 0x66, 0x74, 0x79])).ok, false);
});

test('readDuration reads mvhd', () => {
  assert.equal(readDuration(synth(1)), 5);
});

test('crashed session on disk is recovered on next launch; segments split mid-box', async () => {
  const lib = fs.mkdtempSync(path.join(os.tmpdir(), 'tally-'));
  const dir = path.join(sessionsRoot(lib), 's1');
  const w = new SegmentWriter(dir, { baseName: '2026-10-21 14.32 Built-in', owner: CRASHED }, { chunksPerSegment: 2 });
  const bytes = synth(4);
  for (let i = 0; i < bytes.length; i += 37) w.append(bytes.subarray(i, Math.min(i + 37, bytes.length - 30))); // crash: last 30 bytes never written
  await w.close();
  assert.ok(fs.readdirSync(dir).filter((f) => f.endsWith('.part')).length > 2, 'several segment files');
  const res = await recoverSessions(lib, { ffmpeg: null });
  assert.equal(res.length, 1);
  assert.equal(path.basename(res[0].file), '2026-10-21 14.32 Built-in (recovered).mp4');
  assert.equal(res[0].fragments, 3);
  assert.deepEqual(fs.readFileSync(res[0].file), synth(3));
  assert.equal(fs.existsSync(dir), false, 'session dir removed');
});

test('a session with no moov (crash in the first second) is discarded', async () => {
  const lib = fs.mkdtempSync(path.join(os.tmpdir(), 'tally-'));
  const w = new SegmentWriter(path.join(sessionsRoot(lib), 's2'), { baseName: 'x', owner: CRASHED });
  w.append(box('ftyp', Buffer.from('isom0000')));
  await w.close();
  const res = await recoverSessions(lib, { ffmpeg: null });
  assert.equal(res[0].file, null);
  assert.deepEqual(fs.readdirSync(lib).filter((f) => f.endsWith('.mp4')), []);
});

test('finalize never overwrites: same-minute names count up', async () => {
  const lib = fs.mkdtempSync(path.join(os.tmpdir(), 'tally-'));
  fs.writeFileSync(path.join(lib, 'Take.mp4'), 'existing');
  const dir = path.join(sessionsRoot(lib), 's3');
  const w = new SegmentWriter(dir, {});
  w.append(synth(1));
  await w.close();
  const r = await finalizeSession(dir, lib, 'Take', { ffmpeg: null });
  assert.equal(path.basename(r.file), 'Take 2.mp4');
  assert.equal(fs.readFileSync(path.join(lib, 'Take.mp4'), 'utf8'), 'existing');
});

// Real Chromium fMP4 from the spike, truncated mid-fragment, then repaired and
// remuxed with ffmpeg. Skipped when either is missing.
const real = path.resolve('../spike/out/rec-screen_1_0-1792591543040.mp4');
const ffmpeg = findFfmpeg();
test('real recorder output truncated mid-fragment is repaired and plays', { skip: !(fs.existsSync(real) && ffmpeg) }, async () => {
  const lib = fs.mkdtempSync(path.join(os.tmpdir(), 'tally-'));
  const src = fs.readFileSync(real);
  const cutAt = Math.floor(src.length * 0.7);
  const w = new SegmentWriter(path.join(sessionsRoot(lib), 'real'), { baseName: 'real', owner: CRASHED });
  for (let i = 0; i < cutAt; i += 300_000) w.append(src.subarray(i, Math.min(i + 300_000, cutAt)));
  await w.close();
  const [r] = await recoverSessions(lib, { ffmpeg });
  assert.ok(r.file && r.remuxed, JSON.stringify(r));
  const probe = execFileSync(ffmpeg.replace(/ffmpeg$/, 'ffprobe'), ['-v', 'error', '-show_entries', 'format=duration:stream=codec_name,nb_read_frames', '-count_frames', '-of', 'json', r.file]).toString();
  const j = JSON.parse(probe);
  assert.equal(j.streams[0].codec_name, 'h264');
  assert.ok(Number(j.format.duration) > 2, `duration ${j.format.duration}`);
  assert.ok(r.duration > 2, 'mvhd duration readable after faststart');
});

test('real recorder output cut in the last fragment keeps the samples on disk', { skip: !(fs.existsSync(real) && ffmpeg) }, async () => {
  const src = fs.readFileSync(real);
  const full = repairFragmented(src);
  const cut = repairFragmented(src.subarray(0, src.length - 600_000));
  assert.equal(full.fragments, cut.fragments, 'last fragment salvaged, not dropped');
  assert.ok(cut.salvagedSamples > 0);
});

test('segments are joined in place (no second copy) and byte-exact', async () => {
  const lib = fs.mkdtempSync(path.join(os.tmpdir(), 'tally-'));
  const dir = path.join(sessionsRoot(lib), 'j1');
  const w = new SegmentWriter(dir, { baseName: 'j', owner: CRASHED }, { chunksPerSegment: 1 });
  const bytes = synth(6);
  for (let i = 0; i < bytes.length; i += 23) w.append(bytes.subarray(i, Math.min(i + 23, bytes.length)));
  await w.close();
  const joined = await joinInPlace(dir);
  assert.deepEqual(fs.readFileSync(joined), bytes);
  assert.deepEqual(fs.readdirSync(dir).filter((f) => f.endsWith('.part')), ['joined.part']);
});

test('a join interrupted by a crash resumes without duplicating or losing bytes', async () => {
  const lib = fs.mkdtempSync(path.join(os.tmpdir(), 'tally-'));
  const dir = path.join(sessionsRoot(lib), 'j2');
  const w = new SegmentWriter(dir, { baseName: 'j', owner: CRASHED }, { chunksPerSegment: 1 });
  const bytes = synth(5);
  const parts = [];
  for (let i = 0; i < bytes.length; i += 40) parts.push(bytes.subarray(i, Math.min(i + 40, bytes.length)));
  parts.forEach((p) => w.append(p));
  await w.close();
  // Simulate: seg 1 renamed, seg 2 appended + marker written, seg 2 not yet deleted,
  // and half of seg 3 appended before the crash.
  fs.renameSync(path.join(dir, 'seg-00001.part'), path.join(dir, 'joined.part'));
  const s2 = fs.readFileSync(path.join(dir, 'seg-00002.part'));
  fs.appendFileSync(path.join(dir, 'joined.part'), s2);
  const size = fs.statSync(path.join(dir, 'joined.part')).size;
  fs.writeFileSync(path.join(dir, 'join.json'), JSON.stringify({ upto: 2, size }));
  fs.appendFileSync(path.join(dir, 'joined.part'), fs.readFileSync(path.join(dir, 'seg-00003.part')).subarray(0, 10));
  const r = await finalizeSession(dir, lib, 'resumed', { ffmpeg: null });
  assert.deepEqual(fs.readFileSync(r.file), bytes);
});

test('crashed between rename and the first marker: nothing is skipped', async () => {
  const lib = fs.mkdtempSync(path.join(os.tmpdir(), 'tally-'));
  const dir = path.join(sessionsRoot(lib), 'j3');
  const w = new SegmentWriter(dir, { baseName: 'j', owner: CRASHED }, { chunksPerSegment: 1 });
  const bytes = synth(3);
  for (let i = 0; i < bytes.length; i += 50) w.append(bytes.subarray(i, Math.min(i + 50, bytes.length)));
  await w.close();
  fs.renameSync(path.join(dir, 'seg-00001.part'), path.join(dir, 'joined.part'));
  const r = await finalizeSession(dir, lib, 'r', { ffmpeg: null });
  assert.deepEqual(fs.readFileSync(r.file), bytes);
});

test('low disk: the remux (a second copy) is skipped and the fragmented file is kept', async () => {
  const lib = fs.mkdtempSync(path.join(os.tmpdir(), 'tally-'));
  const dir = path.join(sessionsRoot(lib), 'j4');
  const w = new SegmentWriter(dir, {});
  w.append(synth(2));
  await w.close();
  const r = await finalizeSession(dir, lib, 'low', { ffmpeg: '/nonexistent/ffmpeg', free: () => 1000 });
  assert.equal(r.remuxed, false);
  assert.equal(r.skipped, 'low-disk');
  assert.deepEqual(fs.readFileSync(r.file), synth(2));
});

test('real recorder output cut mid-fragment is repaired on disk (tail only)', { skip: !fs.existsSync(real) }, async () => {
  const src = fs.readFileSync(real);
  const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tally-')), 'cut.mp4');
  fs.writeFileSync(tmp, src.subarray(0, src.length - 600_000));
  const r = await repairFile(tmp);
  const mem = repairFragmented(src.subarray(0, src.length - 600_000));
  assert.equal(r.fragments, mem.fragments);
  assert.deepEqual(fs.readFileSync(tmp), mem.buf);
});
