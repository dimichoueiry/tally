// Privacy must be easy to find from every toolbar state (Dimi had to ask how).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { privacyEntries } from '../src/shared/privacy.js';

test('folded: always an icon in Full screen — plain eye at Standard, eye-off above it', () => {
  assert.deepEqual(privacyEntries({ fullScreen: true, coverAvailable: true, privacy: 'standard' }).folded, { icon: 'eye', on: false });
  assert.deepEqual(privacyEntries({ fullScreen: true, coverAvailable: true, privacy: 'semi' }).folded, { icon: 'eye-off', on: true });
  assert.deepEqual(privacyEntries({ fullScreen: true, coverAvailable: true, privacy: 'very' }).folded, { icon: 'eye-off', on: true });
  assert.equal(privacyEntries({ fullScreen: false, coverAvailable: true, privacy: 'very' }).folded, null); // Window mode: hidden
});

test('More menu: a Privacy row, greyed out with the reason in Window mode', () => {
  assert.deepEqual(privacyEntries({ fullScreen: true, coverAvailable: true }).more, { icon: 'eye', disabled: null });
  assert.equal(privacyEntries({ fullScreen: false, coverAvailable: true, privacy: 'semi' }).more.disabled, 'No cover in Window mode');
});

test('collapsed: only a tiny eye-off hint, only above Standard and in Full screen', () => {
  assert.equal(privacyEntries({ fullScreen: true, coverAvailable: true, privacy: 'standard' }).collapsedDot, false);
  assert.equal(privacyEntries({ fullScreen: true, coverAvailable: true, privacy: 'very' }).collapsedDot, true);
  assert.equal(privacyEntries({ fullScreen: false, coverAvailable: true, privacy: 'very' }).collapsedDot, false);
});

test('no cover helper (not macOS): no privacy entry anywhere; unknown levels read as Standard', () => {
  assert.deepEqual(privacyEntries({ fullScreen: true, coverAvailable: false, privacy: 'very' }), { folded: null, more: null, collapsedDot: false });
  assert.equal(privacyEntries({ fullScreen: true, coverAvailable: true, privacy: 'bogus' }).folded.icon, 'eye');
});

test('toolbar wiring: swatch says "Desktop cover & privacy", popover has a Privacy heading, icon and row open it', () => {
  const src = fs.readFileSync(new URL('../src/renderer/bar/bar.js', import.meta.url), 'utf8');
  assert.match(src, /data-tip="\$\{win \? 'No cover in Window mode' : cam \? 'No desktop in Camera only' : 'Desktop cover &amp; privacy'\}"/);
  assert.match(src, /aria-label="Desktop cover &amp; privacy:/);
  assert.match(src, /<h4 class="pvh" id="pvHead">Privacy /);
  assert.equal((src.match(/data-act="privacy-open"/g) || []).length, 2); // folded icon + More row
  assert.match(src, /case 'privacy-open':[\s\S]{0,300}openPop\('cover'\)/);
});
