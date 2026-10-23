// Encoder warm-up and recorder start, without browser globals so they are unit-tested
// (test/warmup.test.js). The packaged app's hardware encoder starts cold: the first
// frame of a take went in, then ~0.3 s of frames were dropped while the encoder came
// up. During the countdown a throwaway recorder on the same output takes ~0.5 s of
// frames and is discarded (its data never leaves the engine), so the real recorder
// starts warm. Any failure just means today's cold start: it never blocks recording.

const nextFrame = (ms) => new Promise((r) => setTimeout(r, ms));

// makeRecorder() → a MediaRecorder-like object; emit(i) sends warm-up frame i.
export async function warmEncoder({ makeRecorder, emit, frames = 15, periodMs = 1000 / 30, stopTimeoutMs = 1500, signal, sleep = nextFrame }) {
  const t0 = Date.now();
  let rec;
  let sent = 0;
  try {
    rec = makeRecorder();
    rec.ondataavailable = () => {}; // discarded: nothing reaches the library or recovery
    rec.start();
    for (; sent < frames; sent++) {
      if (signal?.aborted) break;
      emit(sent);
      await sleep(periodMs);
    }
  } catch (e) {
    stopQuietly(rec);
    return { ok: false, frames: sent, ms: Date.now() - t0, reason: `${e?.name || 'Error'}: ${e?.message || e}` };
  }
  const stopped = await stopWithin(rec, stopTimeoutMs);
  if (signal?.aborted) return { ok: false, frames: sent, ms: Date.now() - t0, reason: 'cancelled' };
  return { ok: stopped, frames: sent, ms: Date.now() - t0, reason: stopped ? null : 'warm-up recorder did not stop' };
}

function stopQuietly(rec) {
  try {
    if (rec && rec.state !== 'inactive') rec.stop();
  } catch {}
}

function stopWithin(rec, ms) {
  return new Promise((resolve) => {
    if (!rec || rec.state === 'inactive') return resolve(true);
    const t = setTimeout(() => resolve(false), ms);
    rec.addEventListener('stop', () => (clearTimeout(t), resolve(true)), { once: true });
    stopQuietly(rec);
  });
}

// Waits for a pending warm-up, but never longer than `capMs` (a countdown cut short
// with Space must not wait). Returns the warm-up result, or null when capped/failed.
export function settleWarmup(warm, capMs = 1000) {
  if (!warm) return Promise.resolve(null);
  return Promise.race([Promise.resolve(warm).catch(() => null), new Promise((r) => setTimeout(() => r(null), capMs))]);
}
