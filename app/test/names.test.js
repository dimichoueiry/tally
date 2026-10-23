import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultBaseName, sourceLabel, sanitize, uniqueName, planRename } from '../src/main/library/names.js';

test('default name is YYYY-MM-DD HH.MM <Source>', () => {
  assert.equal(defaultBaseName(new Date(2026, 9, 21, 14, 32), 'Built-in'), '2026-10-21 14.32 Built-in');
  assert.equal(defaultBaseName(new Date(2026, 0, 2, 3, 4), ''), '2026-01-02 03.04');
  assert.equal(defaultBaseName(new Date(2026, 0, 2, 3, 4), 'a/b:c'), '2026-01-02 03.04 abc');
});

test('source labels', () => {
  assert.equal(sourceLabel({ kind: 'display', label: 'Built-in Retina Display' }), 'Built-in');
  assert.equal(sourceLabel({ kind: 'display', label: 'LG UltraFine' }), 'LG UltraFine');
  assert.equal(sourceLabel({ kind: 'window', title: 'Acme Dashboard — Chrome' }), 'Acme Dashboard — Chrome');
  assert.equal(sourceLabel({ kind: 'window', title: 'x'.repeat(60) }).length, 40);
});

test('sanitize strips invalid characters and reports it', () => {
  assert.deepEqual(sanitize('Demo: v2/final?'), { name: 'Demo v2final', stripped: true });
  assert.deepEqual(sanitize('Onboarding demo'), { name: 'Onboarding demo', stripped: false });
  assert.equal(sanitize('..hidden').name, 'hidden');
  assert.equal(sanitize('trailing. ').name, 'trailing');
});

test('uniqueName counts up and ignores case', () => {
  const taken = new Set(['Onboarding demo.mp4', 'onboarding demo 2.mp4']);
  assert.equal(uniqueName('Onboarding demo', '.mp4', taken), 'Onboarding demo 3.mp4');
  assert.equal(uniqueName('Other', '.mp4', taken), 'Other.mp4');
});

test('planRename: keeps the extension, flags conflicts, ignores itself', () => {
  const taken = ['2026-10-21 14.32 Built-in.mp4', 'Onboarding demo.mp4'];
  const cur = '2026-10-21 14.32 Built-in.mp4';
  assert.deepEqual(planRename(cur, 'Onboarding demo', taken), { ok: true, target: 'Onboarding demo 2.mp4', conflict: true, stripped: false });
  assert.deepEqual(planRename(cur, 'Fresh', taken), { ok: true, target: 'Fresh.mp4', conflict: false, stripped: false });
  assert.equal(planRename(cur, '2026-10-21 14.32 Built-in', taken).unchanged, true);
  assert.equal(planRename(cur, '///', taken).ok, false);
  // case-only rename of itself is allowed
  assert.equal(planRename(cur, '2026-10-21 14.32 BUILT-IN', taken).conflict, false);
});

test('window titles that are file names do not leak an extension into the name', () => {
  assert.equal(sourceLabel({ kind: 'window', title: 'notes.md' }), 'notes');
  assert.equal(sourceLabel({ kind: 'window', title: 'Q3 report.pdf — Preview' }), 'Q3 report — Preview');
  assert.equal(sourceLabel({ kind: 'window', title: 'README.md - LoomClone - Visual Studio Code' }), 'README - LoomClone - Visual Studio Code');
  assert.equal(sourceLabel({ kind: 'window', title: 'Release v1.2' }), 'Release v1.2');
  assert.equal(sourceLabel({ kind: 'window', title: '.md' }), 'Window');
  const base = defaultBaseName(new Date(2026, 9, 21, 14, 32), sourceLabel({ kind: 'window', title: 'M1_PLAN.md' }));
  assert.equal(base, '2026-10-21 14.32 M1_PLAN');
  assert.equal(`${base}.mp4`.match(/\./g).length, 2); // "14.32" and ".mp4" only
  assert.equal(defaultBaseName(new Date(2026, 9, 21, 14, 32), 'index.html'), '2026-10-21 14.32 index');
});
