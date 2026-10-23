// Segment files on disk for one recording session, and recovery of sessions a
// crash left behind. Node only (no Electron), so it is unit-tested.
//
//   <root>/.tally/sessions/<id>/session.json   manifest (source, start time, name)
//                              /seg-00001.part  recorder bytes, in order
//                              /done            written once finalised (then the dir is removed)

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { execFile, execFileSync } from 'node:child_process';
import { repairFragmented, readDuration } from './mp4.js';
import { uniqueName } from '../library/names.js';

export const SEG_CHUNKS = 5; // 1 s chunks → a new segment file every ~5 s

export function sessionsRoot(libraryDir) {
  return path.join(libraryDir, '.tally', 'sessions');
}

// Who is recording into a session: this process. Written into session.json, so that a
// second Tally (a test instance, or one launched while this one still records) never
// "recovers" a live session. A test launch once did exactly that and cut a real take.
export const ownerStamp = () => ({ pid: process.pid, appStartedAt: Math.round(Date.now() - process.uptime() * 1000) });

function processStart(pid) {
  try {
    const t = Date.parse(execFileSync('/bin/ps', ['-o', 'lstart=', '-p', String(pid)], { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim());
    return Number.isFinite(t) ? t : null;
  } catch {
    return null;
  }
}

// Alive = the pid exists and (when both are known) started when the owner did; a pid
// reused by another program after a reboot doesn't count.
export function ownerAlive(owner, { kill = process.kill.bind(process), startOf = processStart } = {}) {
  if (!owner?.pid) return false;
  try {
    kill(owner.pid, 0);
  } catch (e) {
    if (e.code !== 'EPERM') return false;
  }
  const started = startOf(owner.pid);
  if (started == null || owner.appStartedAt == null) return true;
  return Math.abs(started - owner.appStartedAt) < 10_000;
}

// Leading ftyp + moov of the stream (null until both arrived). Without them nothing
// after can be played, so the writer keeps a copy in case its folder disappears.
function initBoxes(buf) {
  let off = 0;
  let moovEnd = 0;
  while (off + 8 <= buf.length) {
    const size = buf.readUInt32BE(off);
    const type = buf.toString('latin1', off + 4, off + 8);
    if (size < 8 || off + size > buf.length) return null;
    off += size;
    if (type === 'moov') moovEnd = off;
    if (moovEnd || (type !== 'ftyp' && type !== 'moov')) break;
  }
  return moovEnd ? buf.subarray(0, moovEnd) : null;
}

export class SegmentWriter {
  constructor(dir, manifest, { chunksPerSegment = SEG_CHUNKS, log = () => {} } = {}) {
    this.dir = dir;
    this.log = log;
    this.init = null; // ftyp + moov
    this.early = Buffer.alloc(0); // bytes before init was found (capped)
    this.recreated = 0;
    this.chunksPerSegment = chunksPerSegment;
    this.index = 0;
    this.chunksInSeg = 0;
    this.fh = null;
    this.bytes = 0;
    this.queue = Promise.resolve();
    this.error = null;
    this.manifest = { ...manifest, owner: manifest.owner ?? ownerStamp() };
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'session.json'), JSON.stringify(this.manifest, null, 2));
  }

  static segName(i) {
    return `seg-${String(i).padStart(5, '0')}.part`;
  }

  // Appends are serialised; the caller never awaits ordering itself.
  append(chunk) {
    const buf = Buffer.from(chunk);
    this.queue = this.queue.then(async () => {
      if (this.error) return;
      try {
        if (!this.init && this.early.length < 16e6) {
          this.early = Buffer.concat([this.early, buf]);
          this.init = initBoxes(this.early);
          if (this.init) this.early = Buffer.alloc(0);
        }
        if (!fs.existsSync(this.dir)) await this._recreate();
        if (!this.fh || this.chunksInSeg >= this.chunksPerSegment) await this._rotate();
        await this.fh.write(buf);
        this.chunksInSeg++;
        this.bytes += buf.length;
      } catch (e) {
        this.error = e;
      }
    });
    return this.queue;
  }

  async _rotate() {
    const old = this.fh;
    this.fh = null; // never reuse a handle that is being (or was) closed
    if (old) {
      await old.sync();
      await old.close();
    }
    this.index++;
    this.chunksInSeg = 0;
    this.fh = await fsp.open(path.join(this.dir, SegmentWriter.segName(this.index)), 'a+');
  }

  // The session folder vanished mid-recording (something deleted it). Recreate it and
  // keep recording: the manifest, the stream's init boxes (as segment 0, so what follows
  // stays playable) and the segment in progress, read back from its still-open handle.
  // Segments closed before the deletion are gone.
  async _recreate() {
    fs.mkdirSync(this.dir, { recursive: true });
    fs.writeFileSync(path.join(this.dir, 'session.json'), JSON.stringify(this.manifest, null, 2));
    if (this.init && this.index > 1) await fsp.writeFile(path.join(this.dir, SegmentWriter.segName(0)), this.init);
    if (this.fh) {
      const old = this.fh;
      this.fh = null;
      let cur = Buffer.alloc(0);
      try {
        const { size } = await old.stat();
        cur = Buffer.alloc(size);
        await old.read(cur, 0, size, 0); // explicit position: the unlinked file is still readable
      } catch {}
      await old.close().catch(() => {});
      this.fh = await fsp.open(path.join(this.dir, SegmentWriter.segName(this.index)), 'a+');
      if (cur.length) await this.fh.write(cur);
    }
    this.recreated++;
    this.log(`session folder was missing, recreated it and kept recording (segment ${this.index}${this.init ? '' : ', no init yet'})`);
  }

  async close() {
    await this.queue;
    const fh = this.fh;
    this.fh = null;
    if (fh) {
      await fh.sync();
      await fh.close();
    }
    if (this.error) throw this.error;
  }
}

export async function listSegments(dir) {
  const names = (await fsp.readdir(dir)).filter((n) => /^seg-\d+\.part$/.test(n)).sort();
  return names.map((n) => path.join(dir, n));
}

export async function concatSegments(dir) {
  const files = await listSegments(dir);
  return Buffer.concat(await Promise.all(files.map((f) => fsp.readFile(f))));
}

export function findFfmpeg(env = process.env) {
  const candidates = [env.TALLY_FFMPEG, '/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg', '/usr/bin/ffmpeg'].filter(Boolean);
  return candidates.find((c) => fs.existsSync(c)) || null;
}

export const FPS = 30;
const REMUX_MARGIN = 200 * 1024 * 1024; // keep this much free after the remuxed copy

// Copy-remux to a regular MP4 with the moov up front (+faststart). Never re-encodes.
// The compositor emits exactly one frame per 30 fps clock tick, so frame N is
// stamped at N/30 s (setts on the video only): the file is constant 30 fps, free of
// the encoder's arrival-time jitter. Safe because Chromium's H.264 has no B-frames
// (pts = dts). Audio (system audio and/or the mic), when recorded, is copied with its
// own timestamps and cut where the video ends (-shortest): the recorder's stop drain
// leaves ~0.3 s of audio after the last frame.
function remux(ffmpeg, input, output) {
  const ts = `N/(${FPS}*TB)`;
  return new Promise((resolve, reject) => {
    execFile(ffmpeg, ['-v', 'error', '-y', '-i', input, '-map', '0:v:0', '-map', '0:a?', '-c', 'copy', '-bsf:v', `setts=pts=${ts}:dts=${ts}`, '-video_track_timescale', String(FPS * 1000), '-shortest', '-movflags', '+faststart', output], (err, _o, stderr) =>
      err ? reject(new Error(stderr || err.message)) : resolve(),
    );
  });
}

const segIndex = (f) => Number(path.basename(f).match(/seg-(\d+)\.part$/)[1]);

// Joins the segments into one file without a second copy on disk: segment 1 becomes
// joined.part and every later segment is appended to it, then deleted. join.json
// records progress after each fsync, so a crash mid-join resumes cleanly (the file
// is truncated back to the last recorded size; already-appended segments are skipped).
// Peak extra disk use: one segment (~5 s), which is what lets a disk-full stop save.
export async function joinInPlace(dir) {
  const joined = path.join(dir, 'joined.part');
  const markerFile = path.join(dir, 'join.json');
  let marker = null;
  try {
    marker = JSON.parse(await fsp.readFile(markerFile, 'utf8'));
  } catch {}
  let segs = await listSegments(dir);
  if (!fs.existsSync(joined)) {
    if (!segs.length) return null;
    const first = segIndex(segs[0]);
    await fsp.rename(segs[0], joined);
    marker = { upto: first, size: (await fsp.stat(joined)).size };
  } else if (!marker) {
    // Crashed between the rename and the first marker: nothing was appended yet.
    marker = { upto: segs.length ? segIndex(segs[0]) - 1 : 0, size: (await fsp.stat(joined)).size };
  }
  const writeMarker = async () => {
    await fsp.writeFile(markerFile + '.tmp', JSON.stringify(marker));
    await fsp.rename(markerFile + '.tmp', markerFile);
  };
  await writeMarker();
  segs = await listSegments(dir);
  const fh = await fsp.open(joined, 'r+');
  try {
    await fh.truncate(marker.size); // drop a partial append from an interrupted join
    const buf = Buffer.alloc(8 * 1024 * 1024);
    for (const seg of segs) {
      if (segIndex(seg) <= marker.upto) {
        await fsp.rm(seg, { force: true }); // appended before a crash, not yet deleted
        continue;
      }
      const src = await fsp.open(seg, 'r');
      let pos = marker.size;
      try {
        for (;;) {
          const { bytesRead } = await src.read(buf, 0, buf.length, null);
          if (!bytesRead) break;
          await fh.write(buf, 0, bytesRead, pos);
          pos += bytesRead;
        }
      } finally {
        await src.close();
      }
      await fh.sync();
      marker = { upto: segIndex(seg), size: pos };
      await writeMarker();
      await fsp.rm(seg, { force: true });
    }
  } finally {
    await fh.close();
  }
  return joined;
}

// Top-level boxes of a file, reading headers only (the file can be gigabytes).
async function scanBoxes(file) {
  const fh = await fsp.open(file, 'r');
  const head = Buffer.alloc(16);
  const boxes = [];
  try {
    const { size: end } = await fh.stat();
    let off = 0;
    while (off + 8 <= end) {
      await fh.read(head, 0, 16, off);
      let size = head.readUInt32BE(0);
      const type = head.toString('latin1', 4, 8);
      let header = 8;
      if (size === 1) {
        if (off + 16 > end) break;
        size = Number(head.readBigUInt64BE(8));
        header = 16;
      } else if (size === 0) size = end - off;
      if (size < header) {
        boxes.push({ type, start: off, size, complete: false });
        break;
      }
      boxes.push({ type, start: off, size, header, complete: off + size <= end });
      if (off + size > end) break;
      off += size;
    }
    return { boxes, end, tail: off < end && !boxes.some((b) => !b.complete) ? end - off : 0 };
  } finally {
    await fh.close();
  }
}

// Makes the joined file playable. A clean stop needs nothing. A crash-cut tail is
// repaired by reading only ftyp + moov and the last fragment (memory stays small):
// everything from the first broken box is cut, and a cut last fragment is salvaged.
export async function repairFile(file) {
  const { boxes, end, tail } = await scanBoxes(file);
  const moov = boxes.find((b) => b.type === 'moov' && b.complete);
  if (!moov) return { ok: false, reason: 'no-moov', fragments: 0 };
  const firstBad = boxes.findIndex((b) => !b.complete || (b.type === 'mdat' && boxes[boxes.indexOf(b) - 1]?.type !== 'moof'));
  let complete = 0;
  for (let i = 0; i < boxes.length; i++) if (boxes[i].type === 'moof' && boxes[i + 1]?.type === 'mdat' && boxes[i + 1].complete && (firstBad < 0 || i + 1 < firstBad)) complete++;
  const lastIsPair = boxes.at(-1)?.type === 'mdat' && boxes.at(-2)?.type === 'moof';
  if (firstBad < 0 && !tail && lastIsPair) return { ok: complete > 0, reason: complete ? null : 'no-fragments', fragments: complete, salvagedSamples: 0, droppedBytes: 0 };
  // Cut point: the first broken box, or an orphan trailing moof / unparsable tail.
  let cut = firstBad >= 0 ? boxes[firstBad].start : end - tail;
  if (firstBad < 0 && boxes.at(-1)?.type === 'moof') cut = boxes.at(-1).start;
  const prefixEnd = moov.start + moov.size;
  const fh = await fsp.open(file, 'r+');
  try {
    let salvaged = null;
    const bad = boxes[firstBad];
    const prev = boxes[firstBad - 1];
    if (bad?.type === 'mdat' && prev?.type === 'moof') {
      // Last fragment cut inside its mdat: rebuild it from ftyp+moov + that fragment.
      const head = Buffer.alloc(prefixEnd);
      await fh.read(head, 0, prefixEnd, 0);
      const frag = Buffer.alloc(end - prev.start);
      await fh.read(frag, 0, frag.length, prev.start);
      const r = repairFragmented(Buffer.concat([head, frag]));
      if (r.ok && r.salvagedSamples) salvaged = { bytes: r.buf.subarray(prefixEnd), samples: r.salvagedSamples };
      cut = prev.start;
    }
    await fh.truncate(cut);
    if (salvaged) await fh.write(salvaged.bytes, 0, salvaged.bytes.length, cut);
    const fragments = complete + (salvaged ? 1 : 0);
    return { ok: fragments > 0, reason: fragments ? null : 'no-fragments', fragments, salvagedSamples: salvaged?.samples || 0, droppedBytes: end - cut - (salvaged?.bytes.length || 0) };
  } finally {
    await fh.close();
  }
}

export function freeBytes(dir) {
  try {
    const s = fs.statfsSync(dir);
    return s.bavail * s.bsize;
  } catch {
    return null;
  }
}

// Turn a session dir into a finished file in `libraryDir`. Used by Stop and by
// crash recovery. Returns { file, duration, fragments, droppedBytes, remuxed }.
// The remux (a second full copy) only runs when the disk has room for it; otherwise
// the fragmented MP4 is kept as the final file (it plays; seeking is slower).
export async function finalizeSession(dir, libraryDir, baseName, { ffmpeg = findFfmpeg(), log = () => {}, free = freeBytes } = {}) {
  const joined = await joinInPlace(dir);
  const repaired = joined ? await repairFile(joined) : { ok: false, reason: 'no-segments' };
  if (!repaired.ok) {
    await fsp.rm(dir, { recursive: true, force: true });
    return { file: null, reason: repaired.reason };
  }
  let src = joined;
  let remuxed = false;
  let skipped = null;
  if (ffmpeg) {
    const size = (await fsp.stat(joined)).size;
    const room = free(dir);
    if (room != null && room < size + REMUX_MARGIN) {
      skipped = 'low-disk';
      log(`low disk (${Math.round(room / 1e6)} MB free): keeping the fragmented MP4, no remux`);
    } else {
      const out = path.join(dir, 'final.mp4');
      try {
        await remux(ffmpeg, joined, out);
        src = out;
        remuxed = true;
        await fsp.rm(joined, { force: true });
      } catch (e) {
        await fsp.rm(out, { force: true });
        log(`remux failed, keeping fragmented MP4: ${e.message}`);
      }
    }
  }
  const taken = new Set(await fsp.readdir(libraryDir));
  const file = path.join(libraryDir, uniqueName(baseName, '.mp4', taken));
  await fsp.rename(src, file);
  await fsp.writeFile(path.join(dir, 'done'), file);
  const head = await readHead(file);
  await fsp.rm(dir, { recursive: true, force: true });
  return { file, duration: readDuration(head), fragments: repaired.fragments, droppedBytes: repaired.droppedBytes, remuxed, skipped };
}

// Enough of the file to find the moov after +faststart.
async function readHead(file, bytes = 4 * 1024 * 1024) {
  const fh = await fsp.open(file, 'r');
  try {
    const { size } = await fh.stat();
    const buf = Buffer.alloc(Math.min(size, bytes));
    await fh.read(buf, 0, buf.length, 0);
    return buf;
  } finally {
    await fh.close();
  }
}

// Called on launch: every session dir still on disk was interrupted.
export async function recoverSessions(libraryDir, opts = {}) {
  const root = sessionsRoot(libraryDir);
  let ids = [];
  try {
    ids = await fsp.readdir(root);
  } catch {
    return [];
  }
  const results = [];
  for (const id of ids) {
    const dir = path.join(root, id);
    if (!(await fsp.stat(dir)).isDirectory()) continue;
    if (fs.existsSync(path.join(dir, 'done'))) {
      await fsp.rm(dir, { recursive: true, force: true });
      continue;
    }
    let manifest = {};
    try {
      manifest = JSON.parse(await fsp.readFile(path.join(dir, 'session.json'), 'utf8'));
    } catch {}
    if (ownerAlive(manifest.owner, opts)) {
      results.push({ id, manifest, file: null, live: true, reason: 'still recording' }); // never touch it
      continue;
    }
    const base = `${manifest.baseName || id} (recovered)`;
    try {
      results.push({ id, manifest, ...(await finalizeSession(dir, libraryDir, base, opts)) });
    } catch (e) {
      results.push({ id, manifest, file: null, reason: e.message });
    }
  }
  return results;
}
