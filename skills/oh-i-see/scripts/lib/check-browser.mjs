#!/usr/bin/env node
/**
 * check-browser.mjs — postinstall sanity check.
 *
 * `npm install` in the skill directory puts Playwright on disk, but the browser
 * binary is a separate ~100MB download. Nothing about the install tells a new
 * user that, and the first symptom they meet is a browser launch failure
 * halfway into their first audit run.
 *
 * This warns loudly and still exits 0: failing postinstall would break the
 * common case where the binary is already cached, or arrives via a CI step.
 */

import { findBrowserBuilds, browserCacheRoots } from './browser-cache.mjs';

const builds = findBrowserBuilds();

if (builds.length) {
  console.log(`✓ chromium available (${builds.join(', ')})`);
  process.exit(0);
}

console.log(`
  Playwright is installed, but no chromium build was found.
  Looked in:
${browserCacheRoots().map((r) => `    ${r}`).join('\n')}

  Fetch it once before your first run:

      npx playwright install chromium

  Until then, capture.mjs will fail at browser launch.
`);
process.exit(0);
