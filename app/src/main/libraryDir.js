// Which recordings folder this launch uses, decided before crash recovery runs (it
// scans that folder's sessions). An isolated test instance (TALLY_USER_DATA) never
// gets the user's real folder: it uses TALLY_LIBRARY_DIR, else its own folder inside
// its userData. Pure, so it is unit-tested (test/liveSession.test.js).
import path from 'node:path';

export function bootLibraryDir({ env = {}, userData, saved, defaultDir }) {
  const isolated = !!env.TALLY_USER_DATA;
  let dir = env.TALLY_LIBRARY_DIR || (isolated ? path.join(userData, 'library') : saved || defaultDir);
  const real = [saved, defaultDir].filter(Boolean).map((d) => path.resolve(d));
  // An isolated instance pointed at the real folder anyway: give it its own.
  if (isolated && !env.TALLY_LIBRARY_DIR && real.includes(path.resolve(dir))) dir = path.join(userData, 'library');
  const recover = !(isolated && real.includes(path.resolve(dir)));
  return { dir, recover, override: dir !== saved };
}
