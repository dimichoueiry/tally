// The recordings folder: listing, metadata, rename. Metadata lives in
// <library>/.tally/meta.json keyed by inode, so renames in Finder keep it.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { readDuration } from '../session/mp4.js';
import { planRename } from './names.js';

const VIDEO = /\.(mp4|mov|m4v|webm)$/i;

export class Library {
  constructor(dir) {
    this.dir = dir;
    this.metaFile = path.join(dir, '.tally', 'meta.json');
    this.thumbDir = path.join(dir, '.tally', 'thumbs');
    fs.mkdirSync(this.thumbDir, { recursive: true });
  }

  _readMeta() {
    try {
      return JSON.parse(fs.readFileSync(this.metaFile, 'utf8'));
    } catch {
      return {};
    }
  }

  async setMeta(file, meta, thumbJpeg) {
    const { ino } = await fsp.stat(file);
    const all = this._readMeta();
    if (thumbJpeg) {
      const t = path.join(this.thumbDir, `${ino}.jpg`);
      await fsp.writeFile(t, thumbJpeg);
      meta.thumb = path.basename(t);
    }
    all[ino] = { ...all[ino], ...meta };
    await fsp.writeFile(this.metaFile, JSON.stringify(all, null, 2));
  }

  async entry(file) {
    const st = await fsp.stat(file);
    const meta = this._readMeta()[st.ino] || {};
    let duration = meta.duration ?? null;
    if (duration == null) {
      try {
        const fh = await fsp.open(file, 'r');
        const buf = Buffer.alloc(Math.min(st.size, 2 * 1024 * 1024));
        await fh.read(buf, 0, buf.length, 0);
        await fh.close();
        duration = readDuration(buf);
      } catch {}
    }
    let thumb = null;
    if (meta.thumb) {
      try {
        thumb = `data:image/jpeg;base64,${(await fsp.readFile(path.join(this.thumbDir, meta.thumb))).toString('base64')}`;
      } catch {}
    }
    return {
      file,
      name: path.basename(file),
      size: st.size,
      created: (st.birthtimeMs || st.mtimeMs),
      duration,
      quality: meta.quality || null,
      fps: meta.fps || null,
      camera: !!meta.camera,
      thumb,
      tally: !!meta.tally,
    };
  }

  async list() {
    let names = [];
    try {
      names = await fsp.readdir(this.dir);
    } catch {
      return [];
    }
    const files = names.filter((n) => VIDEO.test(n) && !n.startsWith('.'));
    const entries = await Promise.all(files.map((n) => this.entry(path.join(this.dir, n)).catch(() => null)));
    return entries.filter(Boolean).sort((a, b) => b.created - a.created);
  }

  async names() {
    return (await fsp.readdir(this.dir)).filter((n) => !n.startsWith('.'));
  }

  async checkRename(file, typed) {
    return planRename(path.basename(file), typed, await this.names());
  }

  // Applies the plan (conflicts resolve to "<name> 2"). Returns the new path.
  async rename(file, typed) {
    const plan = await this.checkRename(file, typed);
    if (!plan.ok) throw new Error(plan.reason);
    if (plan.unchanged) return { file, plan };
    const target = path.join(this.dir, plan.target);
    await fsp.rename(file, target);
    return { file: target, plan };
  }

  watch(onChange) {
    let t = null;
    try {
      const w = fs.watch(this.dir, () => {
        clearTimeout(t);
        t = setTimeout(onChange, 250);
      });
      return () => w.close();
    } catch {
      return () => {};
    }
  }
}
