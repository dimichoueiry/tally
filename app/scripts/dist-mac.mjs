// npm run dist:mac → electron-builder, signed with "Tally Local" when it is available
// (scripts/signing.mjs), ad-hoc otherwise. Extra args pass through (e.g. --arm64).
import { execFileSync, spawnSync } from 'node:child_process';
import { pickIdentity } from './signing.mjs';

let found = '';
try {
  found = execFileSync('/usr/bin/security', ['find-identity', '-v', '-p', 'codesigning'], { encoding: 'utf8' });
} catch {}
const identity = pickIdentity(found);
const archs = process.argv.slice(2).length ? process.argv.slice(2) : ['--arm64', '--x64'];
console.log(identity === '-' ? 'signing: ad-hoc (no trusted "Tally Local" identity; permissions reset with each build)' : `signing: ${identity} (stable designated requirement)`);
const r = spawnSync('npx', ['electron-builder', '--mac', 'dmg', ...archs, `-c.mac.identity=${identity}`], {
  stdio: 'inherit',
  env: { ...process.env, NODE_OPTIONS: '--experimental-require-module', CSC_IDENTITY_AUTO_DISCOVERY: 'false' },
});
process.exit(r.status ?? 1);
