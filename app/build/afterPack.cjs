// electron-builder afterPack (before signing): Electron's stock Info.plist asks for
// Bluetooth, which Tally never uses, so those usage strings are removed from the shipped
// app. The microphone string stays: package.json → build.mac.extendInfo sets Tally's own
// NSMicrophoneUsageDescription (the optional Microphone switch).
const { execFileSync } = require('node:child_process');
const path = require('node:path');

const DROP = ['NSBluetoothAlwaysUsageDescription', 'NSBluetoothPeripheralUsageDescription'];

exports.default = async function afterPack(ctx) {
  if (ctx.electronPlatformName !== 'darwin') return;
  const plist = path.join(ctx.appOutDir, `${ctx.packager.appInfo.productFilename}.app`, 'Contents', 'Info.plist');
  for (const key of DROP) {
    try {
      execFileSync('/usr/libexec/PlistBuddy', ['-c', `Delete :${key}`, plist], { stdio: 'ignore' });
    } catch {} // already absent
  }
};
