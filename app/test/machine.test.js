import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initial, transition, elapsedMs, primaryAction } from '../src/main/session/machine.js';

const run = (events, start = initial) => {
  let s = start;
  for (const [e, t] of events) s = transition(s, e, t);
  return s;
};

test('idle → countdown → recording, session becomes active on the first frame', () => {
  let s = transition(initial, 'START', 0);
  assert.equal(s.state, 'countdown');
  assert.equal(s.sessionActive, false);
  s = transition(s, 'COUNTDOWN_DONE', 1000);
  assert.equal(s.state, 'recording');
  assert.equal(s.sessionActive, true);
  assert.equal(elapsedMs(s, 4000), 3000);
});

test('Esc during the countdown cancels with nothing recorded', () => {
  const s = run([['START', 0], ['CANCEL_COUNTDOWN', 500]]);
  assert.deepEqual(s, { ...initial });
});

test('pause stops the clock; resume restarts it', () => {
  let s = run([['START', 0], ['COUNTDOWN_DONE', 0], ['PAUSE', 2000]]);
  assert.equal(s.state, 'paused');
  assert.equal(elapsedMs(s, 9000), 2000);
  s = transition(s, 'RESUME', 9000);
  assert.equal(elapsedMs(s, 10000), 3000);
  s = transition(s, 'TOGGLE_PAUSE', 10000);
  assert.equal(s.state, 'paused');
  s = transition(s, 'TOGGLE_PAUSE', 11000);
  assert.equal(s.state, 'recording');
});

test('D3: asking to restart pauses; Keep going resumes recording', () => {
  let s = run([['START', 0], ['COUNTDOWN_DONE', 0], ['ASK_RESTART', 5000]]);
  assert.equal(s.state, 'confirm');
  assert.deepEqual(s.confirm, { kind: 'restart', resumeTo: 'recording' });
  assert.equal(elapsedMs(s, 60000), 5000, 'clock frozen while the question is shown');
  s = transition(s, 'KEEP_GOING', 60000);
  assert.equal(s.state, 'recording');
  assert.equal(elapsedMs(s, 61000), 6000);
});

test('Keep going returns to paused when the take was already paused', () => {
  const s = run([['START', 0], ['COUNTDOWN_DONE', 0], ['PAUSE', 1000], ['ASK_CANCEL', 2000], ['KEEP_GOING', 3000]]);
  assert.equal(s.state, 'paused');
  assert.equal(elapsedMs(s, 9000), 1000);
});

test('confirm restart → countdown with the session still active and a fresh clock', () => {
  const s = run([['START', 0], ['COUNTDOWN_DONE', 0], ['ASK_RESTART', 5000], ['CONFIRM', 6000]]);
  assert.equal(s.state, 'countdown');
  assert.equal(s.sessionActive, true);
  assert.equal(s.accMs, 0);
});

test('the same shortcut again confirms; the other one switches the question', () => {
  let s = run([['START', 0], ['COUNTDOWN_DONE', 0], ['ASK_RESTART', 1000]]);
  s = transition(s, 'ASK_CANCEL', 1100);
  assert.deepEqual(s.confirm, { kind: 'cancel', resumeTo: 'recording' });
  s = transition(s, 'ASK_CANCEL', 1200);
  assert.deepEqual(s, { ...initial });
});

test('pause toggling is ignored while a confirmation is up', () => {
  const s = run([['START', 0], ['COUNTDOWN_DONE', 0], ['ASK_CANCEL', 1000]]);
  assert.equal(transition(s, 'TOGGLE_PAUSE', 1100), s);
});

test('stop from recording, paused or confirm → finalizing → idle', () => {
  for (const pre of [[], [['PAUSE', 500]], [['ASK_RESTART', 500]]]) {
    let s = run([['START', 0], ['COUNTDOWN_DONE', 0], ...pre, ['STOP', 1000]]);
    assert.equal(s.state, 'finalizing');
    assert.equal(s.sessionActive, true, 'session stays active until the file is saved');
    s = transition(s, 'FINALIZED', 2000);
    assert.deepEqual(s, { ...initial });
  }
});

test('irrelevant events leave the state untouched', () => {
  assert.equal(transition(initial, 'STOP'), initial);
  assert.equal(transition(initial, 'PAUSE'), initial);
  const c = transition(initial, 'START');
  assert.equal(transition(c, 'PAUSE'), c);
});

test('⌥⇧R: start when idle, start now in countdown, stop otherwise', () => {
  assert.equal(primaryAction(initial), 'START');
  assert.equal(primaryAction({ ...initial, state: 'countdown' }), 'COUNTDOWN_DONE');
  for (const st of ['recording', 'paused', 'confirm']) assert.equal(primaryAction({ ...initial, state: st }), 'STOP');
  assert.equal(primaryAction({ ...initial, state: 'finalizing' }), null);
});
