// Encoder warm-up during the countdown, and the clock waiting for the recorder's start.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { warmEncoder, settleWarmup } from '../src/renderer/engine/warmup.js';

class FakeRecorder extends EventTarget {
  constructor({ stops = true, startDelay = 0 } = {}) {
    super();
    this.state = 'inactive';
    this.stops = stops;
    this.startDelay = startDelay;
    this.log = [];
  }
  start() {
    this.state = 'recording';
    this.log.push('start');
    setTimeout(() => this.dispatchEvent(new Event('start')), this.startDelay);
  }
  stop() {
    this.log.push('stop');
    if (!this.stops) return;
    this.state = 'inactive';
    // a recorder hands over its last data on stop: the warm-up must drop it
    this.ondataavailable?.({ data: { size: 1234 } });
    setTimeout(() => this.dispatchEvent(new Event('stop')), 0);
  }
}
const fast = { periodMs: 0, sleep: () => Promise.resolve() };

test('warm-up: ~0.5 s of frames into a throwaway recorder, stopped, its data discarded', async () => {
  const rec = new FakeRecorder();
  const sent = [];
  const r = await warmEncoder({ makeRecorder: () => rec, emit: (i) => sent.push(i), ...fast });
  assert.equal(r.ok, true);
  assert.equal(r.frames, 15); // 15 frames at 30 fps = 0.5 s
  assert.deepEqual(sent, [...Array(15).keys()]);
  assert.deepEqual(rec.log, ['start', 'stop']);
  assert.equal(rec.state, 'inactive');
});

test('cancel or restart during the countdown stops the warm-up', async () => {
  const rec = new FakeRecorder();
  const ctl = new AbortController();
  let n = 0;
  const r = await warmEncoder({ makeRecorder: () => rec, emit: () => ++n === 4 && ctl.abort(), signal: ctl.signal, ...fast });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'cancelled');
  assert.equal(n, 4);
  assert.equal(rec.state, 'inactive', 'throwaway recorder stopped');
});

test('warm-up failures fall back to a cold start, never throw', async () => {
  const noRec = await warmEncoder({ makeRecorder: () => { throw new DOMException('not supported', 'NotSupportedError'); }, emit: () => {}, ...fast });
  assert.deepEqual([noRec.ok, noRec.reason], [false, 'NotSupportedError: not supported']);
  const rec = new FakeRecorder();
  const badFrame = await warmEncoder({ makeRecorder: () => rec, emit: () => { throw new Error('frame failed'); }, ...fast });
  assert.equal(badFrame.ok, false);
  assert.match(badFrame.reason, /frame failed/);
  assert.equal(rec.state, 'inactive', 'stopped after a failure');
  const stuck = await warmEncoder({ makeRecorder: () => new FakeRecorder({ stops: false }), emit: () => {}, stopTimeoutMs: 20, ...fast });
  assert.deepEqual([stuck.ok, stuck.reason], [false, 'warm-up recorder did not stop']);
});

test('a pending warm-up is awaited at most the cap (Space during the countdown)', async () => {
  const t0 = Date.now();
  assert.equal(await settleWarmup(new Promise(() => {}), 30), null);
  assert.ok(Date.now() - t0 < 500);
  assert.deepEqual(await settleWarmup(Promise.resolve({ ok: true }), 30), { ok: true });
  assert.equal(await settleWarmup(Promise.reject(new Error('x')), 30), null);
  assert.equal(await settleWarmup(null), null);
});

test('engine wiring: warm-up during prepare, start waits for it (capped), clock starts with the recorder, abort cancels', () => {
  const src = fs.readFileSync(new URL('../src/renderer/engine/engine.js', import.meta.url), 'utf8');
  const prep = src.slice(src.indexOf('async prepare('), src.indexOf('async start()'));
  assert.match(prep, /S\.warm = warmUp\(S\);/);
  assert.doesNotMatch(prep, /await warmUp/, 'prepare (and so the countdown) never waits for it');
  const start = src.slice(src.indexOf('async start()'), src.indexOf('async pause()'));
  assert.ok(start.indexOf('settleWarmup(sess.warm, 1000)') < start.indexOf('makeRecorder(sess)'));
  // No waiting for the 'start' event: Chromium fires it only once media flows, and
  // holding frames back put the audio ~0.5 s ahead of the video (measured).
  assert.doesNotMatch(start, /await [^;]*start/i);
  assert.ok(start.indexOf('rec.start(1000)') < start.indexOf('S.clock.start()'));
  assert.match(src.slice(src.indexOf('async abort()'), src.indexOf('async abort()') + 200), /S\.warmCtl\?\.abort\(\)/);
  const warm = src.slice(src.indexOf('async function warmUp('), src.indexOf('const api = {'));
  assert.doesNotMatch(warm, /engine:chunk|tally\.send/, 'warm-up data never leaves the engine');
  assert.match(src, /const ts = Math\.round\(S\.tsBase \+ \(S\.frames \* 1e6\) \/ FPS\);/, 'take timestamps continue after the warm-up');
});
