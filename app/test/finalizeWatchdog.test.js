// Stop must always end in a saved file or the error popup, never a stuck "Finishing file".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { guardedFinalize, withTimeout, errorPopup, copyBudgetMs } from '../src/main/session/watchdog.js';

const ok = () => ({ file: '/tmp/x.mp4', duration: 3 });
const never = () => new Promise(() => {});

test('happy path returns the stats and the file', async () => {
  const r = await guardedFinalize({ stop: () => ({ frames: 90 }), close: () => {}, finalize: ok });
  assert.deepEqual(r, { stats: { frames: 90 }, res: ok() });
});

test('a forced error in any step becomes the error popup (file closed, the real bug)', async () => {
  for (const broken of ['stop', 'close', 'finalize']) {
    const steps = { stop: () => ({}), close: () => {}, finalize: ok };
    steps[broken] = () => { throw new Error('file closed'); };
    const e = await guardedFinalize(steps).catch((x) => x);
    const p = errorPopup(e, { name: 'take.mp4', partsLeft: true });
    assert.equal(p.finalizing, false, broken);
    assert.equal(p.error.title, 'Couldn’t finish the file');
    assert.equal(p.error.text, 'file closed.');
    assert.equal(p.error.canSave, true);
  }
});

test('a step that hangs times out into the error popup; a late copy is kept for salvage', async () => {
  for (const hung of ['stop', 'close', 'finalize']) {
    const steps = { stop: () => ({}), close: () => {}, finalize: ok };
    steps[hung] = never;
    const t0 = Date.now();
    const e = await guardedFinalize(steps, { stepMs: 30, budget: () => 30 }).catch((x) => x);
    assert.ok(Date.now() - t0 < 1000);
    assert.equal(e.timeout, true, hung);
    const p = errorPopup(e, { name: 'take.mp4', partsLeft: true });
    assert.equal(p.finalizing, false);
    assert.match(p.error.text, /took longer than/);
    if (hung === 'finalize') assert.ok(e.job instanceof Promise, 'the running copy is handed to salvage');
  }
});

test('nothing playable is an error too; no parts left means no Save button', async () => {
  const e = await guardedFinalize({ stop: () => ({}), close: () => {}, finalize: () => ({ file: null, reason: 'no-moov' }) }).catch((x) => x);
  assert.match(e.message, /no-moov/);
  assert.equal(errorPopup(e, { name: 'a.mp4', partsLeft: false }).error.canSave, false);
});

test('copy budget grows with the file; withTimeout clears its timer', async () => {
  assert.equal(copyBudgetMs(0), 20_000);
  assert.equal(copyBudgetMs(2e9), 40_000);
  assert.equal(await withTimeout(Promise.resolve(7), 10, 'x'), 7);
});

test('controller: every failure after Stop goes through the error popup', () => {
  const src = fs.readFileSync(new URL('../src/main/controller.js', import.meta.url), 'utf8');
  const fin = src.slice(src.indexOf('async _finalize()'), src.indexOf('  _discardSession() {'));
  assert.match(fin, /guardedFinalize\(/);
  assert.match(fin, /catch \(e\) \{[\s\S]*this\._finishFailed\(/);
  const at = src.indexOf('_finishFailed(failed, e) {');
  assert.ok(at > 0);
  const ff = src.slice(at, at + 900);
  assert.match(ff, /errorPopup\(/);
});

test('the popup reason is plain words, never a raw errno with long paths', () => {
  const eacces = Object.assign(new Error("EACCES: permission denied, rename '/var/folders/xy/lib/.tally/sessions/1/final.mp4' -> '/var/folders/xy/lib/2026-10-23 10.04 Built-in.mp4'"), { code: 'EACCES' });
  const t = errorPopup(eacces, { name: 'a.mp4', partsLeft: true }).error.text;
  assert.equal(t, 'Tally isn’t allowed to write to the recordings folder.');
  assert.equal(errorPopup(Object.assign(new Error('ENOSPC: no space left'), { code: 'ENOSPC' }), { name: 'a', partsLeft: true }).error.text, 'The disk is full.');
  assert.equal(errorPopup(new Error("weird failure at '/Users/x/y/z.part'"), { name: 'a', partsLeft: true }).error.text, 'Something went wrong while saving the file.');
  assert.equal(errorPopup(new Error('file closed'), { name: 'a', partsLeft: true }).error.text, 'file closed.');
  for (const x of [t]) assert.doesNotMatch(x, /\/var|EACCES|->/);
  const css = fs.readFileSync(new URL('../src/renderer/shared/components.css', import.meta.url), 'utf8');
  assert.match(css, /\.saved \.meta\.errtext \{[^}]*white-space: normal;[^}]*overflow-wrap: anywhere;/);
});
