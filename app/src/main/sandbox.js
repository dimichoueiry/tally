// Dev sandbox (TALLY_DEV_SANDBOX=1, with TALLY_USER_DATA): a scripted test instance that
// can run while someone is using the Mac, next to their own Tally.
// - Own app name, so its single-instance lock and userData never meet the real app's.
// - No menu-bar icon and no global shortcuts (⌥⇧R must reach the real Tally).
// - Every window is invisible (opacity 0), click-through, and never takes focus or
//   activates the app. capturePage and sendInputEvent still reach the pages, so the
//   dev-control scripts can drive and photograph it.
export const SANDBOX = process.env.TALLY_DEV_SANDBOX === '1';

// `app` is passed in so this module stays importable from plain-Node unit tests.
export function initSandbox(app) {
  if (!SANDBOX) return;
  app.setName('Tally Dev');
  app.focus = () => {};
  // Invisible windows count as occluded on macOS; keep their frames (and so their
  // rAF-aligned mouse moves) flowing for the scripted checks.
  app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
  app.commandLine.appendSwitch('disable-renderer-backgrounding');
}

export function sandboxWindow(win) {
  if (!SANDBOX) return win;
  win.setOpacity(0);
  win.setIgnoreMouseEvents(true);
  win.setIgnoreMouseEvents = () => {};
  win.focus = () => {};
  win.show = () => win.showInactive();
  return win;
}

// Stand-ins with the same surface as the real objects.
export const noGlobalShortcuts = { register: () => true, unregister() {}, isRegistered: () => false, unregisterAll() {} };

export class NoTray {
  bounds() {
    return { x: 0, y: 0, width: 0, height: 0 };
  }
  update() {}
  setSetupOpen() {}
}
