// The speaker-notes script (SETUP_V2 §12.5): one plain UTF-8 file in the app's data,
// readable outside Tally. No length cap. Written atomically (temp file + rename), so a
// crash mid-save never leaves half a script. Never uploaded, never put in a recording.
import fs from 'node:fs';
import path from 'node:path';

export class NotesStore {
  constructor(file) {
    this.file = file;
  }

  read() {
    try {
      return fs.readFileSync(this.file, 'utf8');
    } catch {
      return '';
    }
  }

  write(text) {
    const tmp = `${this.file}.${process.pid}.tmp`;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(tmp, String(text ?? ''), 'utf8');
    fs.renameSync(tmp, this.file);
  }
}
