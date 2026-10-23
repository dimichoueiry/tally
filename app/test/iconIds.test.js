// The icon sprite is prepended to <body>, so a symbol id equal to a page id wins
// getElementById (Library's #undo got the undo icon). Symbol ids are namespaced.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.join(import.meta.dirname, '../src/renderer');
const files = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? files(path.join(dir, d.name)) : [path.join(dir, d.name)]));

test('no page element id collides with an icon symbol id', () => {
  const ui = fs.readFileSync(path.join(root, 'shared/ui.js'), 'utf8');
  const symbols = new Set([...ui.matchAll(/<symbol id="([^"]+)"/g)].map((m) => m[1]));
  assert.ok(symbols.size > 20);
  for (const s of symbols) assert.match(s, /^i-/, `symbol ${s} is not namespaced`);
  const clashes = [];
  for (const f of files(root).filter((f) => /\.(html|js)$/.test(f) && !f.endsWith('shared/ui.js'))) {
    const src = fs.readFileSync(f, 'utf8');
    for (const m of src.matchAll(/\bid="([A-Za-z][\w-]*)"|getElementById\('([^']+)'\)|\$\('([^']+)'\)/g)) {
      const id = m[1] || m[2] || m[3];
      if (symbols.has(id)) clashes.push(`${path.relative(root, f)}: ${id}`);
    }
  }
  assert.deepEqual(clashes, []);
});
