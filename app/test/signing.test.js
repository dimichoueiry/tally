// The Mac build signs with "Tally Local" when that identity is trusted, else ad-hoc.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { pickIdentity, LOCAL_IDENTITY } from '../scripts/signing.mjs';

const line = (n, name, extra = '') => `  ${n}) 5881F3D28F158AC4C53378E39D726A5532305E43 "${name}"${extra}`;

test('uses Tally Local when security lists it as valid', () => {
  assert.equal(pickIdentity(`${line(1, 'Tally Local')}\n     1 valid identities found\n`), LOCAL_IDENTITY);
  assert.equal(pickIdentity(`${line(1, 'Apple Development: X (ABC)')}\n${line(2, 'Tally Local')}\n`), LOCAL_IDENTITY);
});

test('falls back to ad-hoc when it is missing, untrusted or expired', () => {
  assert.equal(pickIdentity('     0 valid identities found\n'), '-');
  assert.equal(pickIdentity(''), '-');
  assert.equal(pickIdentity(line(1, 'Tally Local', ' (CSSMERR_TP_NOT_TRUSTED)')), '-');
  assert.equal(pickIdentity(line(1, 'Tally Local', ' (CSSMERR_TP_CERT_EXPIRED)')), '-');
  assert.equal(pickIdentity(line(1, 'Tally Local Copy')), '-');
});

test('dist:mac goes through the picker; the config default stays ad-hoc', () => {
  const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.match(pkg.scripts['dist:mac'], /node scripts\/dist-mac\.mjs/);
  assert.equal(pkg.build.mac.identity, '-');
  assert.match(fs.readFileSync(new URL('../scripts/dist-mac.mjs', import.meta.url), 'utf8'), /-c\.mac\.identity=\$\{identity\}/);
});
