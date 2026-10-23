// Settings window: only what M2 needs (LC-7) — the camera background image and the
// System audio and Microphone switches. Everything else lives in the popover (the
// microphone's device and level are in the toolbar's More menu).
import { installIcons, icon, esc } from '../shared/ui.js';
import { BUILTIN, builtinImage } from '../shared/bg/images.js';

const tally = window.tally;
installIcons();
const root = document.getElementById('root');
let st = null;
let micPerm = null;
const thumbs = Object.fromEntries(BUILTIN.map((b) => [b.id, builtinImage(b.id, 192, 128).toDataURL('image/png')]));

function render() {
  if (!st) return;
  const cur = st.camera.bgImage;
  const tiles = [
    ...BUILTIN.map((b) => ({ ref: b.id, label: b.label, src: thumbs[b.id], user: false })),
    ...(st.backgrounds || []).map((n, i) => ({ ref: `user:${n}`, name: n, label: `Your image ${i + 1}`, src: `app://tally/user/backgrounds/${encodeURIComponent(n)}`, user: true })),
  ];
  root.innerHTML = `
    <section aria-labelledby="h-bg">
      <h2 id="h-bg">Camera background image</h2>
      <div class="well">
        <div class="grid" role="radiogroup" aria-label="Background image">
          ${tiles
            .map(
              (t) => `<div class="tile" role="radio" tabindex="0" data-ref="${esc(t.ref)}" aria-checked="${t.ref === cur}" aria-label="${esc(t.label)}" style="background-image:url('${t.src}')">
                <span class="cap">${esc(t.label)}</span>
                ${t.user ? `<button class="rm" data-remove="${esc(t.name)}" aria-label="Remove ${esc(t.label)}" title="Remove">${icon('x', 's14')}</button>` : ''}
              </div>`,
            )
            .join('')}
          <button class="tile add" data-act="choose">${icon('plus')}Choose image…</button>
        </div>
      </div>
      <p class="foot">Used when the camera background is set to Image. Pictures you add are copied into Tally's own data and stay on this Mac.</p>
    </section>
    <section aria-labelledby="h-audio">
      <h2 id="h-audio">Sound</h2>
      <div class="well">
        <div class="line">
          ${icon(st.systemAudio ? 'speaker' : 'speaker-off')}
          <span class="lbl"><b>Record system audio</b><small>What your Mac plays: videos, app sounds, calls. Off by default.</small></span>
          <span class="switch" role="switch" tabindex="0" data-switch="audio" aria-label="Record system audio" aria-checked="${st.systemAudio}"></span>
        </div>
        <div class="line">
          ${icon(st.mic.on ? 'mic' : 'mic-off')}
          <span class="lbl"><b>Record microphone</b><small>Your voice. Off by default. Choose the microphone in the toolbar's More menu.</small></span>
          <span class="switch" role="switch" tabindex="0" data-switch="mic" aria-label="Record microphone" aria-checked="${st.mic.on}"></span>
        </div>
        ${['denied', 'restricted'].includes(micPerm) ? `<div class="line" role="alert">${icon('warn')}<span class="lbl"><small>Microphone access is off for Tally. Turn it on in System Settings › Privacy &amp; Security › Microphone.</small></span><button class="btn" data-act="mic-settings">Open Settings</button></div>` : ''}
      </div>
      <p class="foot">Tally uses the microphone only when you turn it on. Muting your Mac also mutes system audio in the recording.</p>
    </section>`;
}

async function save(partial) {
  st = await tally.invoke('app:setSettings', partial);
  render();
}

root.addEventListener('click', async (e) => {
  const rm = e.target.closest('[data-remove]');
  if (rm) {
    st = await tally.invoke('app:removeImage', rm.dataset.remove);
    return render();
  }
  const t = e.target.closest('[data-ref], [data-act], [data-switch]');
  if (!t) return;
  if (t.dataset.ref) save({ camera: { bgImage: t.dataset.ref, background: 'image' } });
  if (t.dataset.act === 'choose') {
    const next = await tally.invoke('app:chooseImage', 'settings');
    if (next) {
      st = next;
      render();
    }
  }
  if (t.dataset.switch === 'audio') save({ systemAudio: !st.systemAudio });
  if (t.dataset.switch === 'mic') {
    if (st.mic.on) return save({ mic: { on: false } });
    const r = await tally.invoke('app:micAccess'); // not-determined → the system prompt
    micPerm = r.status;
    if (r.granted) save({ mic: { on: true } });
    else render();
  }
  if (t.dataset.act === 'mic-settings') tally.invoke('app:openMicSettings');
});

root.addEventListener('keydown', (e) => {
  if ((e.key === ' ' || e.key === 'Enter') && e.target.matches('[data-ref], [data-switch]')) {
    e.preventDefault();
    e.target.click();
  }
  if (e.target.matches('[data-ref]') && ['ArrowLeft', 'ArrowRight'].includes(e.key)) {
    const all = [...root.querySelectorAll('[data-ref]')];
    all[(all.indexOf(e.target) + (e.key === 'ArrowRight' ? 1 : -1) + all.length) % all.length]?.focus();
  }
});

tally.on('app:settings', (s) => {
  st = s;
  render();
});
tally.invoke('app:settings').then((s) => {
  st = s;
  render();
});
