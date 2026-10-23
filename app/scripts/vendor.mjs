// Copies the MediaPipe runtime the app needs from node_modules into resources/vendor
// (served over app://, never fetched from the network). Only the SIMD WASM: every
// Electron 45 build has WASM SIMD, so the nosimd/module variants are skipped (−26 MB).
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const src = path.join(root, 'node_modules', '@mediapipe', 'tasks-vision');
const out = path.join(root, 'resources', 'vendor', 'mediapipe');
fs.mkdirSync(path.join(out, 'wasm'), { recursive: true });
for (const f of ['vision_bundle.mjs', 'LICENSE', 'package.json']) if (fs.existsSync(path.join(src, f))) fs.copyFileSync(path.join(src, f), path.join(out, f));
for (const f of ['vision_wasm_internal.js', 'vision_wasm_internal.wasm']) fs.copyFileSync(path.join(src, 'wasm', f), path.join(out, 'wasm', f));
console.log(`vendored MediaPipe ${JSON.parse(fs.readFileSync(path.join(src, 'package.json'), 'utf8')).version} → ${path.relative(root, out)}`);
