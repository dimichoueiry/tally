import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PendingDeletes } from '../src/main/library/pendingDelete.js';

const setup = () => {
  const lib = fs.mkdtempSync(path.join(os.tmpdir(), 'tally-'));
  const trashed = [];
  const trash = async (p) => { trashed.push(path.basename(p)); fs.rmSync(p); };
  const file = path.join(lib, 'Onboarding demo.mp4');
  fs.writeFileSync(file, 'video');
  return { lib, trashed, trash, file };
};

test('delete then undo restores the same path and contents', async () => {
  const { lib, trash, file } = setup();
  const pd = new PendingDeletes(lib, trash);
  const t = await pd.remove(file);
  assert.equal(fs.existsSync(file), false);
  assert.equal(await pd.undo(t), file);
  assert.equal(fs.readFileSync(file, 'utf8'), 'video');
});

test('dismiss commits the delete to the Trash', async () => {
  const { lib, trashed, trash, file } = setup();
  const pd = new PendingDeletes(lib, trash);
  const t = await pd.remove(file);
  await pd.commit(t);
  assert.deepEqual(trashed, ['Onboarding demo.mp4']);
  assert.equal(await pd.undo(t), null, 'no undo after commit');
});

test('undo refuses to clobber a new file at the same path', async () => {
  const { lib, trash, file } = setup();
  const pd = new PendingDeletes(lib, trash);
  const t = await pd.remove(file);
  fs.writeFileSync(file, 'new');
  await assert.rejects(pd.undo(t));
});

test('sweep trashes what a crash left staged', async () => {
  const { lib, trashed, trash, file } = setup();
  await new PendingDeletes(lib, trash).remove(file);
  const n = await new PendingDeletes(lib, trash).sweep();
  assert.equal(n, 1);
  assert.deepEqual(trashed, ['Onboarding demo.mp4']);
});
