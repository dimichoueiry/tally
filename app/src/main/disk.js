// Disk space rules (spec §3.8). Pure, so they are unit-tested.
//   before start: warn under 5 GB (with minutes left), Record disabled under 1 GB
//   while recording: bar notice at 2 min left, auto-stop at 500 MB free
import { bytesPerSecond } from '../shared/media.js';

export const GB = 1e9;
export const MB = 1e6;
export const WARN_BELOW = 5 * GB;
export const BLOCK_BELOW = 1 * GB;
export const STOP_AT = 500 * MB;
export const NOTICE_SECONDS = 120;

// Minutes of recording left before the auto-stop line, at this quality.
export function minutesLeft(free, quality, audio = false) {
  if (free == null) return null;
  return Math.max(0, Math.floor((free - STOP_AT) / bytesPerSecond(quality, audio) / 60));
}

export function preflight(free, quality, audio = false) {
  if (free == null) return { level: 'ok' };
  if (free < BLOCK_BELOW) return { level: 'block', minutes: minutesLeft(free, quality, audio) };
  if (free < WARN_BELOW) return { level: 'warn', minutes: minutesLeft(free, quality, audio) };
  return { level: 'ok' };
}

// While recording: 'ok' | 'notice' (≤ 2 min left) | 'stop'.
export function during(free, quality, audio = false) {
  if (free == null) return { level: 'ok' };
  if (free <= STOP_AT) return { level: 'stop', seconds: 0 };
  const seconds = Math.floor((free - STOP_AT) / bytesPerSecond(quality, audio));
  return { level: seconds <= NOTICE_SECONDS ? 'notice' : 'ok', seconds };
}
