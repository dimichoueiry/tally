// LC-19: Reset permission resets Tally's own entry, and a stale grant is explained.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { bundleIdFor, isStaleGrant, STALE_GRANT_TEXT } from '../src/main/permAdvice.js';

const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const src = (f) => fs.readFileSync(new URL(`../src/main/${f}`, import.meta.url), 'utf8');

test('reset uses the packaged appId, never Electron\'s dev id', () => {
  assert.equal(bundleIdFor(pkg), 'app.tally.recorder');
  assert.equal(bundleIdFor(pkg), pkg.build.appId);
  assert.throws(() => bundleIdFor({}), /appId/);
  const index = src('index.js');
  assert.match(index, /h\('perm:reset', \(\) => perms\.resetScreenPermission\(bundleIdFor\(/);
  assert.doesNotMatch(index, /com\.github\.Electron/);
  assert.doesNotMatch(index, /TALLY_BUNDLE_ID/);
  assert.match(src('permissions.js'), /execFile\('tccutil', \['reset', 'ScreenCapture', bundleId\]/);
});

test('capture failing while the permission reads granted is a stale grant', () => {
  for (const msg of ['NotAllowedError: Permission denied', 'NotReadableError: Could not start video source', 'No display source', 'AbortError: getDisplayMedia failed']) {
    assert.equal(isStaleGrant(new Error(msg), 'granted'), true, msg);
  }
  assert.equal(isStaleGrant(Object.assign(new Error('Permission denied by system'), { name: 'NotAllowedError' }), 'granted'), true);
});

test('not a stale grant: permission not granted, or an unrelated failure', () => {
  assert.equal(isStaleGrant(new Error('NotAllowedError: Permission denied'), 'denied'), false, 'denied: the normal permission flow handles it');
  assert.equal(isStaleGrant(new Error('NotAllowedError'), 'not-determined'), false);
  assert.equal(isStaleGrant(new Error('file closed'), 'granted'), false);
  assert.equal(isStaleGrant(new Error('engine prepare timed out'), 'granted'), false);
  assert.equal(isStaleGrant(null, 'granted'), false);
});

test('the guidance says exactly what to do, in plain words', () => {
  assert.match(STALE_GRANT_TEXT, /Screen & System Audio Recording/);
  assert.match(STALE_GRANT_TEXT, /remove Tally with −/);
  assert.match(STALE_GRANT_TEXT, /add it again with \+/);
  assert.match(STALE_GRANT_TEXT, /reopen Tally/);
  assert.doesNotMatch(STALE_GRANT_TEXT, /TCC|cdhash|tccutil/);
});

test('controller: a stale grant shows the guidance with Open Settings, cleared once capture works', () => {
  const c = src('controller.js');
  assert.match(c, /this\.staleGrant = isStaleGrant\(e, screenStatus\(\)\)/);
  assert.match(c, /if \(this\.staleGrant && !this\.noticeDismissed\?\.has\('stale'\)\) return \{ kind: 'perm', tone: 'bad', text: STALE_GRANT_TEXT, action: 'Open Settings', wrap: true \}/);
  assert.match(c, /async _startRecording\(\) \{\s*this\.staleGrant = false;/);
  const bar = fs.readFileSync(new URL('../src/renderer/bar/bar.js', import.meta.url), 'utf8');
  assert.match(bar, /n\.kind === 'perm' \|\| n\.kind === 'micperm'/, 'perm notices get the Open Settings button');
});
