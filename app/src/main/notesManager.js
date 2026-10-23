// Speaker-notes script I/O (SETUP_V2 §12.5): the panel sends every edit; this keeps the
// latest text, writes it 0.5 s after typing stops (atomic), and flushes on hide / quit.
import { NotesStore } from './notesStore.js';

export class NotesManager {
  constructor(file, { onSaved = () => {}, delay = 500 } = {}) {
    this.store = new NotesStore(file);
    this.text = this.store.read();
    this.dirty = false;
    this.timer = null;
    this.onSaved = onSaved;
    this.delay = delay;
  }

  set(text) {
    this.text = String(text ?? '');
    this.dirty = true;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), this.delay);
  }

  flush() {
    clearTimeout(this.timer);
    if (!this.dirty) return;
    this.store.write(this.text);
    this.dirty = false;
    this.onSaved();
  }
}
