import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Shortcuts, PRIMARY, SESSION, NOTES } from '../src/main/shortcuts.js';

function fakeGs(blocked = []) {
  const reg = new Map();
  return {
    reg,
    register: (a, fn) => (blocked.includes(a) || reg.has(a) ? false : (reg.set(a, fn), true)),
    unregister: (a) => reg.delete(a),
    isRegistered: (a) => reg.has(a),
  };
}
const handlers = { primary() {}, pause() {}, restart() {}, cancel() {}, camera() {}, notes() {} };

test('only ⌥⇧R is registered at launch', () => {
  const gs = fakeGs();
  const s = new Shortcuts(gs, handlers);
  assert.equal(s.registerPrimary(), true);
  assert.deepEqual([...gs.reg.keys()], [PRIMARY]);
});

test('P/Z/X/C are registered while a session is active and released after', () => {
  const gs = fakeGs();
  const s = new Shortcuts(gs, handlers);
  s.registerPrimary();
  s.setSessionActive(true);
  assert.deepEqual([...gs.reg.keys()].sort(), [PRIMARY, ...Object.values(SESSION)].sort());
  assert.equal(gs.reg.get(SESSION.pause), handlers.pause);
  s.setSessionActive(false);
  assert.deepEqual([...gs.reg.keys()], [PRIMARY]);
});

test('setSessionActive is idempotent (no double registration)', () => {
  const gs = fakeGs();
  const s = new Shortcuts(gs, handlers);
  const fails = [];
  s.onFailure = (a) => fails.push(a);
  s.setSessionActive(true);
  s.setSessionActive(true);
  assert.deepEqual(fails, []);
});

test('a failed registration is reported and the rest still register', () => {
  const gs = fakeGs([SESSION.restart]);
  const fails = [];
  const s = new Shortcuts(gs, handlers, (a) => fails.push(a));
  s.setSessionActive(true);
  assert.deepEqual(fails, [SESSION.restart]);
  assert.ok(gs.isRegistered(SESSION.pause));
  assert.ok(s.failed.has(SESSION.restart));
});

test('dispose releases everything', () => {
  const gs = fakeGs();
  const s = new Shortcuts(gs, handlers);
  s.registerPrimary();
  s.setSessionActive(true);
  s.dispose();
  assert.equal(gs.reg.size, 0);
});

test('⌥⇧N only while a session is active and notes are open (S17)', () => {
  const gs = fakeGs();
  const s = new Shortcuts(gs, handlers);
  s.registerPrimary();
  assert.equal(gs.isRegistered(NOTES), false);
  s.setSessionActive(true);
  s.setNotesActive(true);
  assert.equal(gs.reg.get(NOTES), handlers.notes);
  s.setNotesActive(false);
  assert.equal(gs.isRegistered(NOTES), false);
  s.setNotesActive(true);
  s.dispose();
  assert.equal(gs.reg.size, 0);
});
