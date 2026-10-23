// Delete with undo. The file is moved into <library>/.tally/pending-delete/<token>/
// (same volume: instant, and the original path is remembered). It reaches the
// OS Trash when the undo window closes. Undo moves it back to the same path.
// Anything left there after a crash is trashed on the next launch.

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

export class PendingDeletes {
  constructor(libraryDir, trash) {
    this.root = path.join(libraryDir, '.tally', 'pending-delete');
    this.trash = trash; // async (absPath) => void, e.g. shell.trashItem
    this.items = new Map(); // token → { original, staged }
  }

  async remove(file) {
    const token = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const dir = path.join(this.root, token);
    await fsp.mkdir(dir, { recursive: true });
    const staged = path.join(dir, path.basename(file));
    await fsp.rename(file, staged);
    await fsp.writeFile(path.join(dir, '.original'), file);
    this.items.set(token, { original: file, staged });
    return token;
  }

  async undo(token) {
    const item = this.items.get(token);
    if (!item) return null;
    if (fs.existsSync(item.original)) throw new Error('A file with that name exists again');
    await fsp.rename(item.staged, item.original);
    await fsp.rm(path.dirname(item.staged), { recursive: true, force: true });
    this.items.delete(token);
    return item.original;
  }

  async commit(token) {
    const item = this.items.get(token);
    if (!item) return;
    this.items.delete(token);
    await this.trash(item.staged);
    await fsp.rm(path.dirname(item.staged), { recursive: true, force: true });
  }

  async commitAll() {
    await Promise.all([...this.items.keys()].map((t) => this.commit(t)));
  }

  // Launch: trash whatever a crash left staged.
  async sweep() {
    let tokens = [];
    try {
      tokens = await fsp.readdir(this.root);
    } catch {
      return 0;
    }
    let n = 0;
    for (const t of tokens) {
      const dir = path.join(this.root, t);
      const files = (await fsp.readdir(dir)).filter((f) => f !== '.original');
      for (const f of files) {
        await this.trash(path.join(dir, f));
        n++;
      }
      await fsp.rm(dir, { recursive: true, force: true });
    }
    return n;
  }
}
