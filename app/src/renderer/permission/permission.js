import { installIcons, icon } from '../shared/ui.js';
installIcons();
const tally = window.tally;
const root = document.getElementById('root');
let granted = false;
let confirmReset = false;
function render() {
  root.innerHTML = `
    <span class="mark lg idle" aria-hidden="true"></span>
    <div><h3>Allow screen recording</h3><p class="lead">macOS needs your OK before Tally can see your screen. Recordings stay on this Mac.</p></div>
    <div class="steps">
      <div class="step ${granted ? 'done' : 'cur'}"><span class="n">${granted ? icon('check', 's14') : '1'}</span><div><b>Open Screen &amp; System Audio Recording</b><small>Turn on Tally in the list</small></div>
        <span class="state ${granted ? 'ok' : ''}">${granted ? `${icon('check', 's14')} Allowed` : '<span class="spin"></span> Waiting…'}</span></div>
      <div class="step ${granted ? 'cur' : ''}"><span class="n">2</span><div><b>Quit &amp; reopen Tally</b><small>macOS applies the change on relaunch</small></div><span></span></div>
    </div>
    <div class="onb-foot">
      <small>${icon('lock', 's14')} Camera and microphone are asked later, only if you turn them on.</small>
      <span class="sp"></span>
      ${granted ? '' : `<button class="btn quiet" id="camonly" title="Record just your camera: no screen, so no Screen Recording needed">Use camera only</button>`}
      ${granted
        ? `<button class="btn primary" id="relaunch" style="height:40px;padding:0 18px">Reopen Tally ${icon('arrow-r', 's14')}</button>`
        : `<button class="btn quiet" id="reset">${confirmReset ? 'Reset now?' : 'Reset permission…'}</button><button class="btn primary" id="open" style="height:40px;padding:0 18px">Open System Settings ${icon('arrow-r', 's14')}</button>`}
    </div>`;
  (document.getElementById('relaunch') || document.getElementById('open')).focus();
}
root.addEventListener('click', async (e) => {
  const id = e.target.closest('button')?.id;
  if (id === 'open') tally.invoke('perm:open');
  if (id === 'relaunch') tally.invoke('perm:relaunch');
  if (id === 'camonly') tally.invoke('perm:cameraOnly'); // Camera only needs no Screen Recording
  if (id === 'reset') {
    if (!confirmReset) { confirmReset = true; return render(); }
    await tally.invoke('perm:reset');
    confirmReset = false;
    render();
  }
});
async function poll() {
  const s = await tally.invoke('perm:status');
  if ((s === 'granted') !== granted) { granted = s === 'granted'; render(); }
}
render();
poll();
setInterval(poll, 1000);
  