// Images the user picks (camera background, clean-desktop cover) are copied into the
// app's own data folder, normalised to JPEG (macOS decodes HEIC here; Chromium can't)
// and capped at 2560 px. Served to renderers at app://tally/user/<kind>s/<name>.
import { nativeImage } from 'electron';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { userMediaDir } from './protocol.js';

export const imageDir = (kind) => path.join(userMediaDir(), kind === 'cover' ? 'covers' : 'backgrounds');
export const imagePath = (kind, name) => path.join(imageDir(kind), path.basename(name));

export async function importImage(file, kind) {
  let img = nativeImage.createFromPath(file);
  if (img.isEmpty()) throw new Error('Could not read that image');
  const { width, height } = img.getSize();
  const max = 2560;
  if (Math.max(width, height) > max) img = img.resize(width >= height ? { width: max } : { height: max }, 'best');
  const jpg = img.toJPEG(90);
  const name = `${crypto.createHash('sha1').update(jpg).digest('hex').slice(0, 12)}.jpg`;
  fs.mkdirSync(imageDir(kind), { recursive: true });
  fs.writeFileSync(imagePath(kind, name), jpg);
  return name;
}
