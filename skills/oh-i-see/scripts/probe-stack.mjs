#!/usr/bin/env node
/**
 * probe-stack.mjs — Phase 1 recon. Everything the run needs to know, decided
 * before any worker is spawned.
 *
 *   node probe-stack.mjs [--cwd <dir>] [--port 8080] [--json]
 *
 * The point of this script is to collapse twenty minutes of discovery into one
 * command. Its most important output is the API-reachability verdict, because
 * that single fact determines whether the run has real data, bypassed data, or
 * emulated data — and that caveat belongs in the report header before a single
 * finding is written.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { findBrowserBuilds } from './lib/browser-cache.mjs';

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const cwd = path.resolve(flag('--cwd', process.cwd()));
const port = flag('--port', '8080');
const asJson = args.includes('--json');

const r = {};
const sh = (cmd, dir = cwd) => { try { return execSync(cmd, { cwd: dir, stdio: ['ignore', 'pipe', 'ignore'], timeout: 20000 }).toString().trim(); } catch { return null; } };
const has = (f) => fs.existsSync(path.join(cwd, f));

// ── 1. framework ──────────────────────────────────────────────────────────
r.framework = has('next.config.js') || has('next.config.mjs') || has('next.config.ts') ? 'next'
  : has('vite.config.ts') || has('vite.config.js') ? 'vite'
  : has('astro.config.mjs') ? 'astro'
  : has('angular.json') ? 'angular'
  : 'unknown';

r.devServer = {
  hasConfig: has('vite.config.ts') || has('next.config.js'),
  port,
  reachable: null,
  url: `http://localhost:${port}`,
};
r.devServer.reachable = !!sh(`curl -s -o /dev/null -w '%{http_code}' --max-time 4 http://localhost:${port}/`);
if (!r.devServer.reachable) {
  const pm = sh('node -e "const p=require(\'./package.json\');console.log((p.scripts||{}).dev||\'\')"');
  r.devServer.startCommand = pm || null;
}

// ── 2. router ─────────────────────────────────────────────────────────────
if (has('src/App.tsx')) {
  const src = fs.readFileSync(path.join(cwd, 'src/App.tsx'), 'utf8');
  const paths = [...src.matchAll(/path="([^"]+)"/g)].map((m) => m[1]);
  r.router = { kind: 'react-router', file: 'src/App.tsx', routeCount: paths.length, routes: paths };
} else {
  const appDir = path.join(cwd, 'app');
  if (fs.existsSync(appDir)) {
    const walk = (d, acc = []) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        if (e.name.startsWith('.')) continue;
        const p = path.join(d, e.name);
        if (e.isDirectory()) walk(p, acc);
        else if (/^page\.(tsx|jsx|ts|js|mdx)$/.test(e.name)) acc.push('/' + path.relative(appDir, path.dirname(p)).split(path.sep).join('/'));
      }
      return acc;
    };
    r.router = { kind: 'app-dir', file: 'app/', routeCount: walk(appDir).length, routes: walk(appDir) };
  } else {
    r.router = { kind: 'unknown', file: null, routeCount: 0, routes: [] };
  }
}

// ── 3. API host + reachability (the branch that matters) ──────────────────
r.api = { host: null, kind: 'unknown', reachable: null, status: null, ladder: null, note: '' };

for (const f of ['.env', '.env.local', '.env.development']) {
  if (!has(f)) continue;
  const env = fs.readFileSync(path.join(cwd, f), 'utf8');
  const m = env.match(/^(?:VITE_|NEXT_PUBLIC_)?SUPABASE_URL\s*=\s*https?:\/\/([\w.-]+)/m);
  if (m) { r.api.host = m[1]; r.api.kind = 'supabase'; r.api.storageKey = `sb-${m[1].split('.')[0]}-auth-token`; break; }
}
if (!r.api.host) {
  const env = ['.env', '.env.local'].filter(has).map((f) => fs.readFileSync(path.join(cwd, f), 'utf8')).join('\n');
  const m = env.match(/https?:\/\/([\w-]+)\.(supabase\.co|onrender\.com|fly\.dev|api\.[\w.-]+)/);
  if (m) { r.api.host = m[0].replace(/^https?:\/\//, ''); r.api.ref = m[1]; }
}

if (r.api.host) {
  r.api.status = sh(`curl -s -o /dev/null -w '%{http_code}' --max-time 8 "https://${r.api.host}/"`) || '000';
  r.api.resolves = !!sh(`dig +short +time=3 +tries=1 @1.1.1.1 ${r.api.host} | head -1`);
  if (!r.api.resolves) {
    r.api.reachable = false;
    r.api.ladder = 3;
    r.api.note = 'API host does not resolve. Data and auth must be emulated in-flight. State this in the report header.';
  } else if (r.api.status === '401' || r.api.status === '403') {
    r.api.reachable = 'bypass';
    r.api.ladder = 2;
    r.api.note = 'API resolves but rejects anonymous requests. Add the auth bypass header from config.';
  } else {
    r.api.reachable = true;
    r.api.ladder = 1;
    r.api.note = 'API reachable. Use real auth and real data.';
  }
}

// ── 4. playwright ─────────────────────────────────────────────────────────
r.playwright = { installed: false, version: null, browsers: [], from: null };
// Playwright may live in the audited repo or beside this skill. Check both:
// probe used to look only at the repo and reported NOT INSTALLED for the
// documented install, where the skill carries its own dependency.
const SKILL_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
for (const from of [cwd, SKILL_ROOT]) {
  const v = sh(`node -e "console.log(require('playwright/package.json').version)"`, from);
  if (v) { r.playwright = { installed: true, version: v, browsers: [], from: from === cwd ? 'the audited repo' : 'the skill' }; break; }
}
r.playwright.browsers = findBrowserBuilds();

// ── 5. write-zone check (ask git, do not guess from ignore-file patterns) ──
// A directory being present is not the same as it being ignored. Ask git, and
// if nothing is ignored, say exactly what line to add.
r.writeZone = { path: null, ignored: false, how: null, suggestion: null };
const probe = flag('--write-zone', null);

const candidates = probe
  ? [probe]
  : ['docs/oh-i-see', 'reports/ui-audit', 'tmp/visual-audit', '.audit', 'docs/audit'];

for (const candidate of candidates) {
  const out = sh(`git check-ignore -v "${candidate}/probe-canary.txt"`);
  if (out) {
    const parts = out.split(':');
    r.writeZone = { path: candidate, ignored: true, how: parts[0].trim(), via: parts.slice(1, -1).join(':').trim() };
    break;
  }
}
if (!r.writeZone.ignored) {
  const d = candidates[0].split('/')[0];
  r.writeZone.suggestion = `echo '${candidates[0]}*/' >> .git/info/exclude   # keeps the audit out of history without touching .gitignore`;
}

// ── 6. blockers ───────────────────────────────────────────────────────────
r.blockers = [];
if (!r.playwright.installed) r.blockers.push(`playwright not resolvable — \`cd ${SKILL_ROOT} && npm install\` (or \`npm i -D playwright\` in the repo)`);
if (r.playwright.installed && !r.playwright.browsers.length) r.blockers.push('no chromium build — `npx playwright install chromium`');
if (!r.devServer.reachable && !r.devServer.startCommand) r.blockers.push('no dev server running and no start script — start one or pass --port');
if (!r.api.host) r.blockers.push('could not find an API host in .env* — mocking strategy needs a manual adapter');
if (!r.router.routeCount) r.blockers.push('could not enumerate routes — flows.mjs needs manual route list');
if (!r.writeZone.ignored) r.blockers.push(`write zone is not git-ignored — ${r.writeZone.suggestion}`);

// ── output ────────────────────────────────────────────────────────────────
if (asJson) {
  console.log(JSON.stringify(r, null, 2));
} else {
  const yn = (v) => (v === true ? 'yes' : v === false ? 'NO' : String(v));
  console.log(`
probe-stack — ${cwd}

framework      ${r.framework}
dev server     ${r.devServer.reachable ? `up at ${r.devServer.url}` : `DOWN${r.devServer.startCommand ? ` (start with: ${r.devServer.startCommand})` : ''}`}
router         ${r.router.kind} — ${r.router.routeCount} routes${r.router.file ? ` (${r.router.file})` : ''}
playwright     ${r.playwright.installed ? `v${r.playwright.version} (${r.playwright.from})` : 'NOT INSTALLED'}  browsers: ${r.playwright.browsers.join(', ') || 'none'}
write zone     ${r.writeZone.path ?? '(none found)'} — ignored: ${yn(r.writeZone.ignored)}${r.writeZone.how ? ` via ${r.writeZone.how}${r.writeZone.via ? ` (${r.writeZone.via})` : ''}` : ''}
${!r.writeZone.ignored ? '               ' + r.writeZone.suggestion : ''}

API            host: ${r.api.host ?? '(not found)'}
               resolves: ${yn(r.api.resolves)}   status: ${r.api.status ?? 'n/a'}
               LADDER ${r.api.ladder ?? '?'} — ${r.api.note || 'unknown'}`);

  if (r.api.ladder === 3) {
    console.log(`
  ┌──────────────────────────────────────────────────────────────────┐
  │ The backend is unreachable. Two consequences you must carry       │
  │ through the whole run, not just the config:                      │
  │  1. Write "data emulated in-flight" in the report header.       │
  │  2. Any finding that depends on row CONTENT must be marked      │
  │     fixtureInduced and excluded from severity ranking. Layout,    │
  │     typography, contrast, focus and routing findings hold.       │
  └──────────────────────────────────────────────────────────────────┘`);
  }

  console.log(r.blockers.length ? `\nBLOCKERS\n${r.blockers.map((b) => `  - ${b}`).join('\n')}` : '\nno blockers. safe to dispatch workers.');
}

process.exit(r.blockers.length ? 1 : 0);