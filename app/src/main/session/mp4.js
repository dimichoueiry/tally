// Minimal MP4 box walking: enough to repair a fragmented MP4 cut off by a crash
// and to read a file's duration. Works on Buffers.

export function walkBoxes(buf, start = 0, end = buf.length) {
  const boxes = [];
  let off = start;
  while (off + 8 <= end) {
    let size = buf.readUInt32BE(off);
    const type = buf.toString('latin1', off + 4, off + 8);
    let header = 8;
    if (size === 1) {
      if (off + 16 > end) {
        boxes.push({ type, start: off, size: null, complete: false });
        return boxes;
      }
      size = Number(buf.readBigUInt64BE(off + 8));
      header = 16;
    } else if (size === 0) {
      size = end - off; // extends to the end of the file
    }
    if (size < header) {
      boxes.push({ type, start: off, size, complete: false, corrupt: true });
      return boxes;
    }
    const complete = off + size <= end;
    boxes.push({ type, start: off, size, header, complete });
    if (!complete) return boxes;
    off += size;
  }
  if (off < end) boxes.push({ type: null, start: off, size: end - off, complete: false });
  return boxes;
}

// Keep ftyp/moov and every complete moof+mdat pair. A final fragment whose mdat
// was cut short is salvaged: its trun is trimmed to the samples fully on disk.
// Everything after that is dropped.
export function repairFragmented(buf) {
  const boxes = walkBoxes(buf);
  const hasMoov = boxes.some((b) => b.type === 'moov' && b.complete);
  if (!hasMoov) return { ok: false, reason: 'no-moov', fragments: 0, buf: null, droppedBytes: buf.length };
  const parts = [];
  let fragments = 0;
  let salvagedSamples = 0;
  for (let i = 0; i < boxes.length; i++) {
    const b = boxes[i];
    if (!b.complete) break;
    if (b.type === 'moof') {
      const next = boxes[i + 1];
      if (next && next.type === 'mdat' && next.complete) {
        parts.push(buf.subarray(b.start, next.start + next.size));
        fragments++;
        i++;
        continue;
      }
      const tail = next && next.type === 'mdat' ? salvage(buf, b, next) : null;
      if (tail) {
        parts.push(tail.buf);
        fragments++;
        salvagedSamples = tail.samples;
      }
      break;
    }
    if (b.type === 'mdat') break; // mdat without a moof: unreadable
    parts.push(buf.subarray(b.start, b.start + b.size));
  }
  const out = Buffer.concat(parts);
  return { ok: fragments > 0, reason: fragments ? null : 'no-fragments', fragments, salvagedSamples, buf: out, droppedBytes: buf.length - out.length };
}

const fullFlags = (buf, p) => buf.readUInt32BE(p) & 0xffffff;

// Rebuild moof + mdat for the samples of a cut fragment that are fully present.
// Handles the single traf / single trun layout Chromium writes; returns null otherwise.
function salvage(buf, moof, mdat) {
  const mdatHeader = mdat.header;
  const available = buf.length - (mdat.start + mdatHeader);
  const trafs = walkBoxes(buf, moof.start + moof.header, moof.start + moof.size).filter((b) => b.type === 'traf');
  if (trafs.length !== 1) return null;
  const traf = trafs[0];
  const kids = walkBoxes(buf, traf.start + traf.header, traf.start + traf.size);
  const tfhd = kids.find((b) => b.type === 'tfhd');
  const truns = kids.filter((b) => b.type === 'trun');
  if (!tfhd || truns.length !== 1) return null;
  const trun = truns[0];

  let q = tfhd.start + tfhd.header;
  const tf = fullFlags(buf, q);
  q += 8; // version/flags + track_ID
  if (tf & 0x1) q += 8;
  if (tf & 0x2) q += 4;
  if (tf & 0x8) q += 4;
  const defaultSize = tf & 0x10 ? buf.readUInt32BE(q) : null;

  const p = trun.start + trun.header;
  const flags = fullFlags(buf, p);
  const count = buf.readUInt32BE(p + 4);
  let fieldsStart = p + 8;
  const dataOffsetPos = flags & 0x1 ? fieldsStart : null;
  if (flags & 0x1) fieldsStart += 4;
  if (flags & 0x4) fieldsStart += 4;
  const perSample = [0x100, 0x200, 0x400, 0x800].filter((f) => flags & f).length * 4;
  const sizeAt = flags & 0x100 ? 4 : 0;
  const dataOffset = dataOffsetPos != null ? buf.readInt32BE(dataOffsetPos) : moof.size + mdatHeader;
  let used = dataOffset - (moof.size + mdatHeader); // payload bytes before the first sample
  let keep = 0;
  for (let i = 0; i < count; i++) {
    const size = flags & 0x200 ? buf.readUInt32BE(fieldsStart + i * perSample + sizeAt) : defaultSize;
    if (size == null || used + size > available) break;
    used += size;
    keep++;
  }
  if (!keep) return null;

  const cut = (count - keep) * perSample; // bytes removed from trun, traf and moof
  const newMoof = Buffer.concat([
    buf.subarray(moof.start, trun.start),
    buf.subarray(trun.start, fieldsStart + keep * perSample),
    buf.subarray(trun.start + trun.size, moof.start + moof.size),
  ]);
  const rel = (abs) => abs - moof.start;
  newMoof.writeUInt32BE(moof.size - cut, 0);
  newMoof.writeUInt32BE(traf.size - cut, rel(traf.start));
  newMoof.writeUInt32BE(trun.size - cut, rel(trun.start));
  newMoof.writeUInt32BE(keep, rel(trun.start + trun.header + 4));
  if (dataOffsetPos != null) newMoof.writeInt32BE(dataOffset - cut, rel(dataOffsetPos));
  const payload = buf.subarray(mdat.start + mdatHeader, mdat.start + mdatHeader + used);
  const mdatHead = Buffer.alloc(8);
  mdatHead.writeUInt32BE(8 + payload.length, 0);
  mdatHead.write('mdat', 4, 'latin1');
  return { buf: Buffer.concat([newMoof, mdatHead, payload]), samples: keep };
}

function child(buf, parent, type) {
  return walkBoxes(buf, parent.start + parent.header, parent.start + parent.size).find((b) => b.type === type && b.complete);
}

// Duration in seconds from moov/mvhd. Falls back to mehd (fragment duration) for
// fragmented files. Returns null when unknown (e.g. Chrome's fMP4 writes 0).
export function readDuration(buf) {
  const moov = walkBoxes(buf).find((b) => b.type === 'moov' && b.complete);
  if (!moov) return null;
  const mvhd = child(buf, moov, 'mvhd');
  if (!mvhd) return null;
  const p = mvhd.start + mvhd.header;
  const version = buf[p];
  const timescale = version === 1 ? buf.readUInt32BE(p + 20) : buf.readUInt32BE(p + 12);
  let duration = version === 1 ? Number(buf.readBigUInt64BE(p + 24)) : buf.readUInt32BE(p + 16);
  if (!duration || duration === 0xffffffff) {
    const mvex = child(buf, moov, 'mvex');
    const mehd = mvex && child(buf, mvex, 'mehd');
    if (mehd) {
      const q = mehd.start + mehd.header;
      duration = buf[q] === 1 ? Number(buf.readBigUInt64BE(q + 4)) : buf.readUInt32BE(q + 4);
    }
  }
  return timescale && duration ? duration / timescale : null;
}
