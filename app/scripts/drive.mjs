// Scripted run for verification: node scripts/drive.mjs scenario.txt
// Scenario lines: "wait <ms>" or a dev-control command (see devControl in src/main/index.js).
// Prints the app's [tally] log and DEV replies. Exits when the scenario ends.
import { spawn, execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const lines = fs.readFileSync(process.argv[2], 'utf8').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
const child = spawn(path.join(root, 'node_modules/.bin/electron'), ['.'], { cwd: root, env: { ...process.env, TALLY_DEV_CONTROL: '1' }, stdio: ['pipe', 'pipe', 'pipe'] });
const show = (d) => d.toString().split('\n').filter((l) => /^(\[tally\]|DEV )/.test(l) || /Error|error/.test(l)).forEach((l) => console.log(l.slice(0, 2000)));
child.stdout.on('data', show);
child.stderr.on('data', show);
let ready = false;
child.stdout.on('data', (d) => { if (/\[tally\] ready/.test(d)) ready = true; });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
for (let i = 0; i < 100 && !ready; i++) await sleep(100);
for (const l of lines) {
  const m = l.match(/^wait (\d+)/);
  if (m) await sleep(Number(m[1]));
  else if (l.startsWith('sh ')) console.log(`SH ${l.slice(3)} → ${execSync(l.slice(3)).toString().trim()}`); // e.g. real mouse events
  else {
    console.log('>> ' + l);
    child.stdin.write(l + '\n');
    await sleep(150);
  }
}
child.stdin.write('quit\n');
await sleep(1500);
child.kill();
