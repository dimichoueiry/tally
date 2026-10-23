// Recording session state machine. Pure: every transition takes the current
// state, an event and a clock reading, and returns the next state (or the same
// object when the event does not apply).
//
//   idle → countdown → recording ⇄ paused
//   recording | paused → confirm(restart | cancel) → back (Keep going) | countdown | idle
//   recording | paused | confirm → finalizing → idle
//
// `sessionActive` (spec §4) is true from the first recorded frame until the file
// is saved or discarded; it stays true across a Restart's countdown.

export const initial = Object.freeze({
  state: 'idle',
  sessionActive: false,
  accMs: 0, // recorded time before `runningSince`
  runningSince: null,
  confirm: null, // { kind: 'restart' | 'cancel', resumeTo: 'recording' | 'paused' }
});

export function elapsedMs(s, now) {
  return s.accMs + (s.state === 'recording' && s.runningSince != null ? now - s.runningSince : 0);
}

const stopClock = (s, now) => ({ ...s, accMs: elapsedMs(s, now), runningSince: null });

export function transition(s, event, now = Date.now()) {
  const type = typeof event === 'string' ? event : event.type;
  switch (s.state) {
    case 'idle':
      if (type === 'START') return { ...initial, state: 'countdown' };
      return s;

    case 'countdown':
      if (type === 'COUNTDOWN_DONE') return { ...s, state: 'recording', sessionActive: true, accMs: 0, runningSince: now };
      // Esc during any countdown: nothing written. After a Restart the old take is already gone.
      if (type === 'CANCEL_COUNTDOWN' || type === 'ERROR') return { ...initial };
      return s;

    case 'recording':
    case 'paused': {
      if (type === 'TOGGLE_PAUSE') return transition(s, s.state === 'recording' ? 'PAUSE' : 'RESUME', now);
      if (type === 'PAUSE' && s.state === 'recording') return { ...stopClock(s, now), state: 'paused' };
      if (type === 'RESUME' && s.state === 'paused') return { ...s, state: 'recording', runningSince: now };
      if (type === 'ASK_RESTART' || type === 'ASK_CANCEL') {
        // D3: the recording pauses the moment the confirmation appears.
        const kind = type === 'ASK_RESTART' ? 'restart' : 'cancel';
        return { ...stopClock(s, now), state: 'confirm', confirm: { kind, resumeTo: s.state } };
      }
      if (type === 'STOP') return { ...stopClock(s, now), state: 'finalizing' };
      if (type === 'ERROR') return { ...initial };
      return s;
    }

    case 'confirm': {
      const { kind, resumeTo } = s.confirm;
      // The same shortcut again confirms; the other one switches the question.
      if ((type === 'ASK_RESTART' && kind === 'restart') || (type === 'ASK_CANCEL' && kind === 'cancel') || type === 'CONFIRM') {
        if (kind === 'restart') return { ...initial, state: 'countdown', sessionActive: true };
        return { ...initial };
      }
      if (type === 'ASK_RESTART' || type === 'ASK_CANCEL') return { ...s, confirm: { kind: type === 'ASK_RESTART' ? 'restart' : 'cancel', resumeTo } };
      if (type === 'KEEP_GOING') {
        return resumeTo === 'recording' ? { ...s, state: 'recording', confirm: null, runningSince: now } : { ...s, state: 'paused', confirm: null };
      }
      if (type === 'TOGGLE_PAUSE') return s; // the question must be answered first
      if (type === 'STOP') return { ...s, state: 'finalizing', confirm: null };
      if (type === 'ERROR') return { ...initial };
      return s;
    }

    case 'finalizing':
      if (type === 'FINALIZED' || type === 'ERROR') return { ...initial };
      return s;

    default:
      return s;
  }
}

// What ⌥⇧R means in each state (spec §4: start when idle, stop otherwise).
export function primaryAction(s) {
  if (s.state === 'idle') return 'START';
  if (s.state === 'countdown') return 'COUNTDOWN_DONE'; // pressing it again starts now
  if (s.state === 'finalizing') return null;
  return 'STOP';
}
