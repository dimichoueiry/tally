// A test launch of Tally once "recovered" (finalised and deleted) a session another
// Tally was still recording into, and the rest of that take was lost. Guards:
// the session names its owner and recovery leaves live owners alone; and an isolated
// instance (TALLY_USER_DATA) never opens the real recordings folder.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SegmentWriter, recoverSessions, sessionsRoot, ownerAlive, ownerStamp } from '../src/main/session/segments.js';
import { bootLibraryDir } from '../src/main/libraryDir.js';

const box = (type, payload = Buffer.alloc(0)) => {
  const h = Buffer.alloc(8);
  h.writeUInt32BE(8 + payload.length, 0);
  h.write(type, 4, 'latin1');
  return Buffer.concat([h, payload]);
};
const mvhd = () => {
  const p = Buffer.alloc(100);
  p.writeUInt32BE(1000, 12);
  p.writeUInt32BE(5000, 16);
  return box('mvhd', p);
};
const head = Buffer.concat([box('ftyp', Buffer.from('isom0000')), box('moov', mvhd())]);
const frag = (i) => Buffer.concat([box('moof', Buffer.alloc(16, i)), box('mdat', Buffer.alloc(64, i))]);
const tmpLib = () => fs.mkdtempSync(path.join(os.tmpdir(), 'tally-live-'));

test('a live session survives a second instance\'s recovery scan', async () => {
  const lib = tmpLib();
  const dir = path.join(sessionsRoot(lib), 'live');
  const w = new SegmentWriter(dir, { baseName: 'take' }, { chunksPerSegment: 2 });
  w.append(head);
  for (let i = 0; i < 3; i++) w.append(frag(i));
  await w.queue;
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'session.json'), 'utf8'));
  assert.equal(manifest.owner.pid, process.pid);
  // "Second instance" launches and scans the same library while we still record.
  const res = await recoverSessions(lib, { ffmpeg: null });
  assert.equal(res.length, 1);
  assert.equal(res[0].live, true);
  assert.equal(res[0].file, null);
  assert.ok(fs.existsSync(dir), 'session dir untouched');
  assert.deepEqual(fs.readdirSync(lib).filter((f) => f.endsWith('.mp4')), [], 'no (recovered) file made');
  for (let i = 3; i < 5; i++) w.append(frag(i)); // recording carries on
  await w.close();
  assert.equal(w.error, null);
  // After the owner is gone, the same session is recovered normally.
  const dead = await recoverSessions(lib, { ffmpeg: null, kill: () => { throw Object.assign(new Error('no such process'), { code: 'ESRCH' }); } });
  assert.equal(dead[0].live, undefined);
  assert.deepEqual(fs.readFileSync(dead[0].file), Buffer.concat([head, ...[0, 1, 2, 3, 4].map(frag)]));
});

test('owner check: dead pid, reused pid and no owner are not live; this process is', () => {
  assert.equal(ownerAlive(ownerStamp()), true);
  assert.equal(ownerAlive({ pid: process.pid, appStartedAt: ownerStamp().appStartedAt }, { startOf: () => ownerStamp().appStartedAt - 3600_000 }), false, 'pid reused');
  assert.equal(ownerAlive({ pid: 999999 }, { kill: () => { throw Object.assign(new Error('x'), { code: 'ESRCH' }); } }), false);
  assert.equal(ownerAlive({ pid: 42 }, { kill: () => { throw Object.assign(new Error('x'), { code: 'EPERM' }); }, startOf: () => null }), true, 'another user\'s live process');
  assert.equal(ownerAlive(undefined), false, 'old sessions without an owner are recovered as before');
});

test('an isolated test instance never uses (or scans) the real recordings folder', () => {
  const real = '/Users/someone/Movies/Tally';
  const ud = '/tmp/tally-sandbox-ud';
  assert.deepEqual(bootLibraryDir({ env: {}, userData: '/x', saved: real, defaultDir: real }), { dir: real, recover: true, override: false });
  const iso = bootLibraryDir({ env: { TALLY_USER_DATA: ud }, userData: ud, saved: real, defaultDir: real });
  assert.equal(iso.dir, path.join(ud, 'library'));
  assert.equal(iso.recover, true);
  const lib = bootLibraryDir({ env: { TALLY_USER_DATA: ud, TALLY_LIBRARY_DIR: '/tmp/lib' }, userData: ud, saved: real, defaultDir: real });
  assert.equal(lib.dir, '/tmp/lib');
  // A sandbox whose saved settings point at the real folder still gets its own.
  assert.equal(bootLibraryDir({ env: { TALLY_USER_DATA: ud }, userData: ud, saved: real, defaultDir: real }).dir, path.join(ud, 'library'));
  // Explicitly pointed at the real folder: allowed to look, never to recover.
  assert.equal(bootLibraryDir({ env: { TALLY_USER_DATA: ud, TALLY_LIBRARY_DIR: real }, userData: ud, saved: real, defaultDir: real }).recover, false);
});

test('index.js decides the folder before recovery and only recovers when allowed', () => {
  const src = fs.readFileSync(new URL('../src/main/index.js', import.meta.url), 'utf8');
  const boot = src.indexOf('bootLibraryDir({');
  const rec = src.indexOf('recoverSessions(libDir');
  assert.ok(boot > 0 && rec > boot, 'library chosen before recovery');
  assert.match(src, /boot\.recover \? await recoverSessions\(libDir/);
  assert.match(src, /boot\.recover \? await pending\.sweep\(\)/);
});

test('the session folder deleted mid-recording: the writer recreates it and the take still finishes', async () => {
  const { finalizeSession } = await import('../src/main/session/segments.js');
  for (const chunksPerSegment of [1000, 2]) {
    const lib = tmpLib();
    const dir = path.join(sessionsRoot(lib), 'gone');
    const logs = [];
    const w = new SegmentWriter(dir, { baseName: 'take' }, { chunksPerSegment, log: (t) => logs.push(t) });
    w.append(head);
    for (let i = 0; i < 4; i++) w.append(frag(i));
    await w.queue;
    fs.rmSync(dir, { recursive: true, force: true }); // what the bad recovery did
    for (let i = 4; i < 8; i++) w.append(frag(i));
    await w.close(); // used to throw "file closed"
    assert.equal(w.error, null);
    assert.equal(w.recreated, 1);
    assert.match(logs[0], /recreated/);
    assert.ok(JSON.parse(fs.readFileSync(path.join(dir, 'session.json'), 'utf8')).owner.pid);
    const res = await finalizeSession(dir, lib, 'take', { ffmpeg: null });
    assert.ok(res.file, `finished file (chunksPerSegment ${chunksPerSegment})`);
    const out = fs.readFileSync(res.file);
    if (chunksPerSegment === 1000) assert.deepEqual(out, Buffer.concat([head, ...[0, 1, 2, 3, 4, 5, 6, 7].map(frag)]), 'open segment read back: nothing lost');
    else {
      // Closed segments before the deletion are gone; init + the open one + everything after survive.
      assert.ok(out.subarray(0, head.length).equals(head));
      assert.ok(res.fragments >= 4, `fragments ${res.fragments}`);
      assert.ok(out.includes(frag(7)));
    }
  }
});

test('the scripted verification launch (sandbox userData + library) never resolves to the real ~/Movies/Tally', async () => {
  const { DEFAULTS } = await import('../src/main/settings.js');
  const real = DEFAULTS.libraryDir; // this machine's real folder (~/Movies/Tally)
  const ud = path.join(os.tmpdir(), 'tally-verify', 'userdata');
  for (const env of [{ TALLY_USER_DATA: ud }, { TALLY_USER_DATA: ud, TALLY_LIBRARY_DIR: path.join(os.tmpdir(), 'tally-verify', 'library') }]) {
    // whatever the saved settings say (even the real folder), the instance gets its own
    for (const saved of [real, undefined, path.join(real, '..', 'Tally')]) {
      const b = bootLibraryDir({ env, userData: ud, saved, defaultDir: real });
      const rel = path.relative(path.resolve(real), path.resolve(b.dir));
      assert.ok(rel.startsWith('..') || path.isAbsolute(rel), `${b.dir} is inside the real folder`);
      assert.ok(path.resolve(b.dir).startsWith(path.resolve(os.tmpdir())), b.dir);
    }
  }
});
