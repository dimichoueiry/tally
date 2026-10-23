// LC-10 regression: writes to a dead terminal and Node warnings must never throw, and
// uncaught errors are logged instead of crashing / showing a dialog.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { Writable } from 'node:stream';
import { writeLog, initLogFile, logFile } from '../src/main/logger.js';

const LOGGER = path.resolve(import.meta.dirname, '../src/main/logger.js');

test('a stream that throws EPIPE is dropped; the line still reaches the log file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tally-log-'));
  initLogFile(dir);
  const dead = new Writable({ write() {} });
  dead.write = () => {
    throw Object.assign(new Error('write EPIPE'), { code: 'EPIPE' });
  };
  assert.doesNotThrow(() => writeLog('info', ['hello', 42], dead));
  assert.doesNotThrow(() => writeLog('info', ['again'], dead));
  const text = fs.readFileSync(logFile(), 'utf8');
  assert.match(text, /info  hello 42/);
  assert.match(text, /again/);
});

// A child with the guards installed loses its stdout/stderr reader (like npm dying),
// then emits a Node warning, logs, and throws from a timer. It must keep running.
test('child process: closed stdout/stderr + warning + uncaught error → no crash, all logged', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tally-log-'));
  const marker = path.join(dir, 'survived');
  const src = `
    import { installProcessGuards, initLogFile } from ${JSON.stringify(LOGGER)};
    import fs from 'node:fs';
    installProcessGuards();
    initLogFile(${JSON.stringify(dir)});
    console.log('ready');
    setTimeout(() => {
      for (let i = 0; i < 20; i++) console.log('line', i, 'x'.repeat(2000));
      process.emitWarning('late warning', 'TestWarning');
      console.error('to a dead stderr');
      setTimeout(() => { throw new Error('boom'); }, 10);
      setTimeout(() => { fs.writeFileSync(${JSON.stringify(marker)}, 'yes'); process.exit(0); }, 300);
    }, 300);`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', src], { stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise((r) => child.stdout.once('data', r));
  child.stdout.destroy();
  child.stderr.destroy();
  const code = await new Promise((r) => child.on('exit', r));
  assert.equal(code, 0, 'child exited normally');
  assert.equal(fs.readFileSync(marker, 'utf8'), 'yes');
  const text = fs.readFileSync(path.join(dir, 'tally.log'), 'utf8');
  assert.match(text, /TestWarning: late warning/);
  assert.match(text, /to a dead stderr/);
  assert.match(text, /fatal uncaught uncaughtException: Error: boom/);
});
