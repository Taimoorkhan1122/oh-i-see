/**
 * resolve-playwright.mjs — load Playwright, or explain how to install it.
 *
 * Node resolves a bare `import 'playwright'` relative to the *importing file*,
 * never relative to the process cwd. That matters because this skill is a
 * drop-in directory: installed under a skills directory it has no `node_modules`
 * of its own unless someone ran `npm install` inside it, so a plain import
 * throws ERR_MODULE_NOT_FOUND and the run dies before printing one useful line.
 *
 * Two install shapes are supported, in order:
 *
 *   1. `npm install` inside the skill itself — the documented install. The
 *      dependency sits next to scripts/ and a plain import resolves.
 *   2. The audited project already depends on Playwright — common when the skill
 *      directory is vendored inside a repo. Resolved from the config's repo path,
 *      or from cwd as a last resort.
 *
 * Failing both, we throw one error naming the two commands, instead of a module
 * resolution stack trace nobody can act on.
 */

import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SKILL_ROOT = path.resolve(HERE, '..', '..');

/** Directories to try, in priority order, each with a label for the error text. */
function candidates() {
  const out = [{ dir: SKILL_ROOT, label: 'the skill directory' }];
  const repo = process.env.UI_AUDIT_REPO;
  if (repo) out.push({ dir: path.resolve(repo), label: 'the audited repo' });
  out.push({ dir: process.cwd(), label: `the current directory (${process.cwd()})` });
  return out;
}

export async function loadChromium() {
  try {
    return (await import('playwright')).chromium;
  } catch {
    // Not installed beside the skill. Look where else it might live.
  }

  for (const { dir, label } of candidates()) {
    try {
      const req = createRequire(path.join(dir, 'noop.js'));
      const pkgJson = req.resolve('playwright/package.json');
      const mod = await import(pathToFileURL(path.join(path.dirname(pkgJson), 'index.js')).href);
      if (mod.chromium) return mod.chromium;
    } catch {
      // try the next one
    }
  }

  throw new Error(
    `Playwright not found.\n\nTried: ${candidates().map((c) => c.label).join(', ')}\n\n` +
      `Install it in the skill (recommended):\n` +
      `    cd ${SKILL_ROOT} && npm install\n` +
      `or in the project you are auditing:\n` +
      `    npm install --save-dev playwright\n` +
      `then fetch the browser binary once:\n` +
      `    npx playwright install chromium`,
  );
}

/**
 * Launch Chromium, turning Playwright's missing-browser banner into a one-line
 * message. As an unhandled rejection that banner arrives under a stack trace.
 */
export async function launchChromium(launchOptions) {
  const chromium = await loadChromium();
  try {
    return await chromium.launch(launchOptions);
  } catch (err) {
    const msg = String(err?.message ?? err);
    if (/Executable doesn't exist|please run the following command/i.test(msg)) {
      throw new Error(
        `Chromium is missing for this Playwright version.\n` +
          `Run:  npx playwright install chromium\n` +
          `Cause: ${msg.split('\n')[0]}`,
      );
    }
    throw err;
  }
}
