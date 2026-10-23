import { test } from 'node:test';
import assert from 'node:assert/strict';
import { preflight, during, minutesLeft, GB, MB } from '../src/main/disk.js';
import { coverArgs } from '../src/main/cleanDesktop.js';

test('before start: ok ≥ 5 GB, warn under 5 GB with minutes left, block under 1 GB', () => {
  assert.equal(preflight(20 * GB, '1080p').level, 'ok');
  const w = preflight(2.1 * GB, '1080p');
  assert.equal(w.level, 'warn');
  assert.equal(w.minutes, 35); // (2.1 GB − 0.5 GB) / 0.75 MB/s ≈ 35.5 min at 6 Mbit/s
  assert.equal(preflight(0.9 * GB, '1080p').level, 'block');
  assert.equal(minutesLeft(2.1 * GB, 'native'), 17); // 12 Mbit/s
});

test('while recording: notice at 2 min left, stop at 500 MB', () => {
  assert.equal(during(3 * GB, '1080p').level, 'ok');
  assert.equal(during(500 * MB + 0.75 * MB * 119, '1080p').level, 'notice');
  assert.equal(during(500 * MB + 0.75 * MB * 200, '1080p').level, 'ok');
  assert.equal(during(500 * MB, '1080p').level, 'stop');
  assert.equal(during(100 * MB, 'native').level, 'stop');
  assert.equal(during(null, '1080p').level, 'ok');
});

test('cover helper arguments', () => {
  assert.deepEqual(coverArgs(1, { cover: 'black' }), ['--display', '1', '--color', '000000']);
  assert.deepEqual(coverArgs(1, { cover: 'wallpaper' }), ['--display', '1', '--color', '1d2420', '--wallpaper']);
  assert.deepEqual(coverArgs(2, { cover: 'image', image: '/x/y.jpg' }), ['--display', '2', '--color', '1d2420', '--image', '/x/y.jpg']);
  assert.deepEqual(coverArgs(2, { cover: 'image' }), ['--display', '2', '--color', '1d2420']); // no image chosen → graphite
  assert.deepEqual(coverArgs(3, { cover: 'nope' }), ['--display', '3', '--color', '1d2420']);
  assert.deepEqual(coverArgs(1, { cover: 'glow' }), ['--display', '1', '--color', '111615', '--glow', '2d4a41,111615']);
});
