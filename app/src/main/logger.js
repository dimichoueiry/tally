// Main-process logging and process guards (LC-10).
//
// Tally is often started from a terminal (`npm start`). When that terminal or the npm
// parent goes away, Electron keeps running with stdout/stderr pointing at a closed
// pipe. A later write then failed with EPIPE: Node's warning printer
// (process.emitWarning → writeOut → console.error) threw, the exception was uncaught,
// and Electron showed its "A JavaScript error occurred in the main process" dialog.
//
// Here: every line goes to a file under userData/logs, and to the terminal only while
// it is still there; stream errors are swallowed; warnings and uncaught errors are
// logged, never shown in a dialog.
import fs from 'node:fs';
import path from 'node:path';
import util from 'node:util';

const MAX_BYTES = 2 * 1024 * 1024; // then tally.log → tally.1.log
const DEAD = new Set(['EPIPE', 'EIO', 'ENOTCONN', 'ECONNRESET', 'ERR_STREAM_DESTROYED', 'ERR_STREAM_WRITE_AFTER_END']);

let file = null;
const alive = new Map(); // stream → still writable?

export function logFile() {
  return file;
}

export function initLogFile(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    file = path.join(dir, 'tally.log');
    if (fs.existsSync(file) && fs.statSync(file).size > MAX_BYTES) fs.renameSync(file, path.join(dir, 'tally.1.log'));
  } catch {
    file = null;
  }
}

function toStream(stream, text) {
  if (alive.get(stream) === false || !stream || stream.destroyed || !stream.writable) return;
  try {
    stream.write(text);
  } catch (e) {
    alive.set(stream, false); // closed terminal / pipe: stop writing there, keep the file
  }
}

export function writeLog(level, args, stream = process.stdout) {
  const text = util.format(...args);
  if (file) {
    try {
      fs.appendFileSync(file, `${new Date().toISOString()} ${level.padEnd(5)} ${text}\n`);
    } catch {}
  }
  toStream(stream, `${text}\n`);
}

// Call first thing in the main process.
export function installProcessGuards({ onFatal = () => {} } = {}) {
  for (const s of [process.stdout, process.stderr]) {
    alive.set(s, true);
    s?.on?.('error', (e) => {
      alive.set(s, false);
      if (!DEAD.has(e?.code)) writeLog('error', [`${s === process.stdout ? 'stdout' : 'stderr'} error: ${e?.message}`], null);
    });
  }
  console.log = (...a) => writeLog('info', a);
  console.info = (...a) => writeLog('info', a);
  console.warn = (...a) => writeLog('warn', a, process.stderr);
  console.error = (...a) => writeLog('error', a, process.stderr);
  // Node's default warning printer writes to stderr directly; replace it.
  process.removeAllListeners('warning');
  process.on('warning', (w) => writeLog('warn', [`${w.name}: ${w.message}`], process.stderr));
  // An uncaught main-process error is logged, never shown as a dialog, and never
  // quits: a recording in progress keeps going (its segments are already on disk).
  process.on('uncaughtException', (e, origin) => {
    writeLog('fatal', [`uncaught ${origin}: ${e?.stack || e}`], process.stderr);
    try {
      onFatal(e);
    } catch {}
  });
  process.on('unhandledRejection', (e) => writeLog('error', [`unhandled rejection: ${e?.stack || e}`], process.stderr));
}
