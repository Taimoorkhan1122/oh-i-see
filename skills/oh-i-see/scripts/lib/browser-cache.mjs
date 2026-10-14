/**
 * browser-cache.mjs — locate Playwright's browser download cache.
 *
 * The cache is platform-specific:
 *   macOS    ~/Library/Caches/ms-playwright
 *   Linux    ~/.cache/ms-playwright
 *   Windows  %LOCALAPPDATA%\ms-playwright
 *
 * Hardcoding the macOS path made every Linux and Windows install report "no
 * chromium build" — a blocker the run cannot clear. Both `probe-stack.mjs` and
 * the postinstall check read from here so there is one place to get it right.
 */

import fs from 'node:fs';
import path from 'node:path';

export function browserCacheRoots() {
  const home = process.env.HOME || process.env.USERPROFILE || '';
  return [
    process.platform === 'darwin' && path.join(home, 'Library', 'Caches', 'ms-playwright'),
    process.platform === 'win32' && process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright'),
    path.join(home, '.cache', 'ms-playwright'),
  ].filter(Boolean);
}

/** Installed chromium build directories, empty array when none are present. */
export function findBrowserBuilds() {
  for (const root of browserCacheRoots()) {
    if (!fs.existsSync(root)) continue;
    const dirs = fs.readdirSync(root).filter((d) => /^chromium/.test(d));
    if (dirs.length) return dirs;
  }
  return [];
}
