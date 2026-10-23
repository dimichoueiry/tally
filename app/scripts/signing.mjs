// Which identity signs the Mac build. "Tally Local" (a self-signed code-signing
// certificate in the login keychain) when it is present and trusted; ad-hoc ("-")
// otherwise. With a real certificate the designated requirement is
// `identifier "app.tally.recorder" and certificate leaf = H"…"`, the same for every
// build, so macOS keeps the Screen Recording / Camera / Mic grants across updates.
// Ad-hoc signatures are cdhash-based: every build looks like a new app to macOS.
export const LOCAL_IDENTITY = 'Tally Local';

// `security find-identity -v -p codesigning` output → identity name for electron-builder.
export function pickIdentity(findIdentityOutput = '') {
  const valid = String(findIdentityOutput)
    .split('\n')
    .filter((l) => /^\s*\d+\)\s+[0-9A-F]{40}\s+"/.test(l) && !/CSSMERR_|REVOKED|EXPIRED/i.test(l));
  return valid.some((l) => l.includes(`"${LOCAL_IDENTITY}"`)) ? LOCAL_IDENTITY : '-';
}
