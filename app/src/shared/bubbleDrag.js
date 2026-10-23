// Bubble drag gesture (DESIGN_SPEC §3.2), pure so it is unit-tested (test/bubbleDrag.test.js).
//
// LC-9: the old code started tracking on pointerdown and only stopped on pointerup.
// When the pointerup never arrived (the bubble window was hidden mid-press, focus
// moved away, the button was released outside), every later pointermove, including
// plain hovering with no button down, was treated as a drag and the bubble followed
// the pointer. Rules now:
//   - only a primary-button press arms a drag; hover never does
//   - it starts after the pointer moves MORE than 3 px with the button still down
//   - a move with no button pressed ends it (the release was lost)
//   - release, cancel, window blur, Esc, leaving the window or hiding the bubble end it
export const DRAG_THRESHOLD = 3; // px

export class BubbleDrag {
  constructor() {
    this.s = null; // null | { x, y, started }
  }

  get active() {
    return !!this.s;
  }

  get started() {
    return !!this.s?.started;
  }

  // Returns the actions for the caller to perform: [{ phase: 'start'|'move'|'end', x, y }].
  press(x, y, button = 0) {
    if (button !== 0) return [];
    const out = this.s ? this.end(x, y) : []; // a stale gesture never survives a new press
    this.s = { x, y, started: false, lx: x, ly: y };
    return out;
  }

  // `buttons`: the PointerEvent bitmask. 0 means no button is down.
  move(x, y, buttons) {
    if (!this.s) return [];
    if (!(buttons & 1)) return this.end(x, y);
    this.s.lx = x;
    this.s.ly = y;
    const out = [];
    if (!this.s.started) {
      if (Math.hypot(x - this.s.x, y - this.s.y) <= DRAG_THRESHOLD) return [];
      this.s.started = true;
      out.push({ phase: 'start', x: this.s.x, y: this.s.y });
    }
    out.push({ phase: 'move', x, y });
    return out;
  }

  // Release, cancel, blur, Esc, leave, hide: all end the gesture. A drag that never
  // started (a click) produces nothing.
  end(x, y) {
    const s = this.s;
    this.s = null;
    if (!s?.started) return [];
    return [{ phase: 'end', x: x ?? s.lx, y: y ?? s.ly }];
  }
}
