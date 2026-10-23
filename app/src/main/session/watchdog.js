// Stop → finished file, with a time limit on every step. A step that fails or runs
// out of time ends in the "Couldn't finish the file" popup (never a forever
// "Finishing file…"). Pure, so it is unit-tested (test/finalizeWatchdog.test.js).

export const STEP_MS = 20_000;
// The final copy (join + remux) grows with the file: 20 s plus 1 s per 100 MB.
export const copyBudgetMs = (bytes = 0) => STEP_MS + Math.ceil(Math.max(0, bytes) / 100e6) * 1000;

export function withTimeout(promise, ms, what) {
  let t;
  const late = new Promise((_, reject) => {
    t = setTimeout(() => reject(Object.assign(new Error(`${what} took longer than ${Math.round(ms / 1000)} s`), { timeout: true })), ms);
  });
  return Promise.race([promise, late]).finally(() => clearTimeout(t));
}

// steps: stop() → engine stats, close() → last bytes on disk, finalize() → { file, … }.
// A finalize that ran out of time may still finish on its own: the error carries it
// as `job`, so "Save what was recorded" can wait for it instead of racing it.
export async function guardedFinalize({ stop, close, finalize, bytes = () => 0 }, { stepMs = STEP_MS, budget = copyBudgetMs } = {}) {
  const stats = await withTimeout(Promise.resolve().then(stop), stepMs, 'Stopping the recorder');
  await withTimeout(Promise.resolve().then(close), stepMs, 'Writing the last part');
  const job = Promise.resolve().then(finalize);
  try {
    const res = await withTimeout(job, budget(bytes()), 'Finishing the file');
    if (!res?.file) throw new Error(`Nothing playable was recorded (${res?.reason || 'empty'})`);
    return { stats, res };
  } catch (e) {
    e.job = job;
    job.catch(() => {}); // settles later, handled by the salvage path
    throw e;
  }
}

// The reason in plain words: system errors carry codes and long paths, never shown raw
// (the full message goes to the log).
const PLAIN = {
  EACCES: 'Tally isn’t allowed to write to the recordings folder.',
  EPERM: 'Tally isn’t allowed to write to the recordings folder.',
  EROFS: 'The recordings folder is on a read-only disk.',
  ENOSPC: 'The disk is full.',
  EDQUOT: 'The disk is full.',
  ENOENT: 'A part of the recording went missing on disk.',
  EIO: 'The disk reported a read or write error.',
};
export function plainReason(e) {
  if (e?.timeout) return `${e.message}.`;
  if (e?.code && PLAIN[e.code]) return PLAIN[e.code];
  const msg = String(e?.message || e || 'Unknown error').replace(/^Error: /, '');
  return /['"]?\/[^\s]+/.test(msg) ? 'Something went wrong while saving the file.' : `${msg}.`.replace(/\.\.$/, '.');
}

// What the popup shows when a recording couldn't be finished.
export function errorPopup(e, { name, partsLeft }) {
  return { finalizing: false, name, error: { title: 'Couldn’t finish the file', text: plainReason(e), canSave: !!partsLeft } };
}
