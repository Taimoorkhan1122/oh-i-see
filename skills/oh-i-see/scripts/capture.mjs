#!/usr/bin/env node
/**
 * capture.mjs — drive a flow through the app, screenshot every state, and
 * record what the DOM measured.
 *
 *   node capture.mjs F3                    # one flow
 *   node capture.mjs all                   # every flow
 *   node capture.mjs F1,F2 --vp desktop    # override viewports
 *   node capture.mjs all --smoke           # first two steps only, fast fail
 *
 * Outputs, per flow, under <writeZone>/evidence/<FLOW_ID>/:
 *   <step-id>/<viewport>/view.png        full-page shot (capped)
 *   <step-id>/<viewport>/view-vp.png     viewport-only shot (always)
 *   results.json                        measurements, console, network, timing
 *
 * Step ids are folder names and evidence paths in findings point at them.
 * Rename a step id only if you also re-run the flow and update every finding.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchChromium } from './lib/resolve-playwright.mjs';
import { MEASURE, PROBE } from './lib/measure.mjs';
import { auditFocusOrder } from './lib/focus-audit.mjs';
import { pickAdapter, storageKey } from './lib/adapters/index.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

// ── args ──────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const targets = (argv.find((a) => !a.startsWith('--') && !isFlagValue(a)) || 'all').split(',').map((s) => s.trim());
function isFlagValue(a) { const i = argv.indexOf(a); return i > 0 && argv[i - 1].startsWith('--'); }

const configPath = path.resolve(flag('--config', path.join(HERE, '..', 'project.config.json')));
const smoke = argv.includes('--smoke');
const viewportOverride = flag('--vp', null)?.split(',').map((s) => s.trim());
const headed = argv.includes('--headed');
const keepOpenOnFail = argv.includes('--keep-open');

if (!fs.existsSync(configPath)) {
  console.error(`config not found: ${configPath}\n  copy assets/project.config.example.json and edit it`);
  process.exit(2);
}
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const base = flag('--base', config.baseUrl);
const writeZone = path.resolve(flag('--zone', config.writeZone));
const adapter = pickAdapter(config);
const key = storageKey(config);

// ── flows ─────────────────────────────────────────────────────────────────
async function loadFlows() {
  const explicit = flag('--flows', null);
  const candidates = explicit
    ? [path.resolve(explicit)]
    : [
        path.join(writeZone, 'flows.mjs'),
        path.resolve(HERE, '..', 'flows.mjs'),
      ];
  for (const c of candidates) {
    if (fs.existsSync(c)) {
      const mod = await import(c);
      const flows = mod.default ?? mod.FLOWS ?? Object.fromEntries(
        Object.entries(mod).filter(([, v]) => v && typeof v === 'object' && Array.isArray(v.steps)),
      );
      return { flows, from: c };
    }
  }
  console.error(
    `no flows found. Looked in:\n${candidates.map((c) => `  ${c}`).join('\n')}\n` +
      `  copy assets/flows.example.mjs to <writeZone>/flows.mjs and write your journeys.`,
  );
  process.exit(2);
}

const { flows, from: flowsFrom } = await loadFlows();

// ── viewports ─────────────────────────────────────────────────────────────
const VP = {};
for (const v of config.viewports ?? [{ name: 'desktop', width: 1440, height: 900 }]) VP[v.name] = v;

/** One viewport per step gets the keyboard focus audit. Default: the widest. */
function focusViewport(cfg) {
  if (cfg.focusViewport) return cfg.focusViewport;
  const names = Object.keys(VP);
  return names.reduce((best, n) => (VP[n].width > VP[best].width ? n : best), names[0]);
}

// ── screenshot with a size cap ────────────────────────────────────────────
// Reference run: an uncapped full-page shot on one long route produced a 47MB PNG.
// A tall screenshot also is not readable when a human opens it, so we cap the
// full-page capture and always take a viewport-only shot alongside it.
const MAX_SHOT_PX = config.maxScreenshotHeight ?? 6000;

async function shoot(page, dir, baseName) {
  const out = {};
  fs.mkdirSync(dir, { recursive: true });

  const docH = await page.evaluate(() => document.documentElement.scrollHeight);
  const capped = docH > MAX_SHOT_PX;
  const viewportShot = path.join(dir, `${baseName}-vp.png`);
  await page.screenshot({ path: viewportShot, fullPage: false });
  out.viewport = path.relative(writeZone, viewportShot);

  if (capped) {
    // Clamp the page height so Playwright stops at the cap instead of
    // rendering the whole document.
    await page.evaluate((h) => {
      const d = document.documentElement;
      d.style.overflow = 'hidden';
      window.scrollTo(0, 0);
      d.style.maxHeight = `${h}px`;
      d.style.setProperty('--audit-cap', `${h}px`);
    }, MAX_SHOT_PX);
  }
  try {
    const fullShot = path.join(dir, `${baseName}.png`);
    await page.screenshot({ path: fullShot, fullPage: !capped });
    if (capped) {
      // fullPage:false above already clamped it via max-height; label it so a
      // reader is not misled about how much of the page they are looking at.
      fs.copyFileSync(viewportShot, fullShot);
    }
    out.full = path.relative(writeZone, fullShot);
    out.cappedAt = capped ? MAX_SHOT_PX : null;
    out.docHeight = docH;
  } catch (e) {
    out.fullError = String(e).slice(0, 160);
  }
  if (capped) await page.evaluate(() => { const d = document.documentElement; d.style.maxHeight = ''; d.style.overflow = ''; }).catch(() => {});
  return out;
}

// ── one step × one viewport ───────────────────────────────────────────────
async function captureStep(browser, flow, step, vpName, report) {
  const vp = VP[vpName];
  if (!vp) throw new Error(`unknown viewport "${vpName}" — config defines: ${Object.keys(VP).join(', ')}`);

  const context = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: vp.deviceScaleFactor ?? 1,
    isMobile: !!vp.isMobile,
    hasTouch: !!vp.hasTouch,
    userAgent: vp.isMobile
      ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
      : undefined,
    reducedMotion: 'reduce',
    colorScheme: 'dark',
  });

  const consoleMsgs = [];
  const pageErrors = [];
  const failedRequests = [];
  const apiCalls = [];
  const apiHosts = config.api?.hostPattern?.slice(2).replace(/\/\*\*$/, '') || null;

  const page = await context.newPage();
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) consoleMsgs.push({ type: m.type(), text: m.text().slice(0, 400) }); });
  page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 400)));
  page.on('requestfailed', (r) => failedRequests.push({ url: r.url().slice(0, 200), error: r.failure()?.errorText ?? 'unknown' }));
  page.on('response', (r) => {
    const host = apiHosts && r.url().includes(apiHosts);
    if (host || /supabase\.co|firebaseio|graphql|onrender|fly\.dev|railway\.app/.test(r.url())) {
      apiCalls.push({ url: r.url().replace(/https:\/\/[^/]+/, '').slice(0, 200), status: r.status() });
    }
  });

  const entry = {
    step: step.id,
    flow: flow.id ?? null,
    route: step.route,
    viewport: vpName,
    ok: true,
    startedAt: new Date().toISOString(),
    actions: [],
    errors: [],
  };

  // Backend emulation + session seeding happen before the first navigation so
  // the app boots already authenticated and already "connected".
  let session = null;
  try {
    const attached = await adapter.impl.attach(context, {
      authOutcome: step.authOutcome || config.api?.defaultAuthOutcome || 'success',
      rows: step.rows || {},
      emptyTables: step.emptyTables || [],
      functions: step.functions || {},
      functionDelays: step.functionDelays || {},
      user: step.user,
      hostPattern: config.api?.hostPattern,
    });
    session = attached.session ?? null;
    if (step.signedIn && key && session) {
      await adapter.impl.seedSession(context, key, session, config.api?.seedExtra ?? {});
    }
  } catch (e) {
    entry.errors.push({ phase: 'adapter', text: String(e).slice(0, 300) });
  }

  // Canon config reaches the in-page engine for off-canon font detection.
  await context.addInitScript((cfg) => {
    window.__UI_AUDIT__ = { canonFonts: cfg.canonFonts || [], minTapTarget: cfg.minTapTarget || 44 };
  }, { canonFonts: config.canon?.fonts ? Object.values(config.canon.fonts) : [], minTapTarget: config.minTapTarget });

  const dir = path.join(writeZone, 'evidence', entry.flow || flow.id || 'X', step.id, vpName);

  try {
    await page.goto(base + step.route, { waitUntil: 'domcontentloaded', timeout: step.timeout ?? 30000 });
    await page.evaluate(() => document.fonts?.ready).catch(() => {});
    await page.waitForTimeout(step.settle ?? 1400);
  } catch (e) {
    entry.ok = false;
    entry.errors.push({ phase: 'goto', text: String(e).split('\n')[0].slice(0, 300) });
  }

  for (const act of step.actions ?? []) {
    const label = JSON.stringify(act).slice(0, 90);
    const t0 = Date.now();
    try {
      if (act.click) await page.click(act.click, { timeout: act.timeout ?? 8000 });
      if (act.clickText) await page.getByText(act.clickText, { exact: !!act.exact }).first().click({ timeout: act.timeout ?? 8000 });
      if (act.clickNth !== undefined) await page.locator(act.clickNth).nth(act.nth ?? 0).click({ timeout: act.timeout ?? 8000 });
      if (act.fill) await page.fill(act.fill[0], act.fill[1], { timeout: act.timeout ?? 8000 });
      if (act.type) { await page.click(act.type[0]); await page.type(act.type[0], act.type[1], { delay: 30 }); }
      if (act.press) await page.keyboard.press(act.press);
      if (act.hover) await page.hover(act.hover, { timeout: 8000 });
      if (act.focus) await page.focus(act.focus, { timeout: 8000 });
      if (act.select) await page.selectOption(act.select[0], act.select[1]);
      if (act.wait) await page.waitForTimeout(act.wait);
      if (act.waitFor) await page.waitForSelector(act.waitFor, { timeout: act.timeout ?? 10000 });
      if (act.expectUrl) await page.waitForURL(act.expectUrl, { timeout: act.timeout ?? 10000 });
      if (act.scroll !== undefined) await page.evaluate((y) => window.scrollTo(0, y), act.scroll);
      entry.actions.push({ action: label, ok: true, ms: Date.now() - t0 });
    } catch (e) {
      entry.ok = false;
      const text = String(e).split('\n')[0].slice(0, 300);
      entry.actions.push({ action: label, ok: false, ms: Date.now() - t0, error: text });
      entry.errors.push({ phase: `action:${label}`, text });
    }
  }

  await page.waitForTimeout(step.settleAfter ?? 700);

  try { entry.measure = await page.evaluate(MEASURE); } catch (e) { entry.errors.push({ phase: 'measure', text: String(e).slice(0, 300) }); }
  if (step.probe !== false) { try { entry.probe = await page.evaluate(PROBE); } catch (e) { entry.errors.push({ phase: 'probe', text: String(e).slice(0, 300) }); } }

  // Focus audit runs on one viewport per step. It presses real Tab keys, which
  // is the only way to see what a keyboard user gets, and it is slow enough
  // that running it at four viewports buys nothing.
  if (step.focusAudit !== false && focusViewport(config) === vpName) {
    try { entry.focusAudit = await auditFocusOrder(page, { maxStops: config.focusStops ?? 40 }); }
    catch (e) { entry.errors.push({ phase: 'focus-audit', text: String(e).slice(0, 300) }); }
  }

  try { entry.shots = await shoot(page, dir, step.shotName || 'view'); }
  catch (e) { entry.errors.push({ phase: 'screenshot', text: String(e).slice(0, 200) }); }

  entry.finalUrl = page.url();
  entry.console = consoleMsgs.slice(0, 25);
  entry.pageErrors = pageErrors.slice(0, 15);
  entry.failedRequests = failedRequests.slice(0, 25);
  entry.apiCalls = apiCalls.slice(0, 25);
  entry.finishedAt = new Date().toISOString();

  // ── smoke gates ──────────────────────────────────────────────────────
  // These are the five checks that catch a lying harness before ten workers
  // each rediscover the same problem.
  const m = entry.measure;
  const gates = [];
  if (m) {
    // 40 is deliberately low. A sign-in form with one field really can be this
    // short; the reference login page measured 66 chars across every state and
    // was fine. A capture at 0 is a broken harness. If you suspect a dead route,
    // compare a step's textLength against the same route's other steps rather
    // than against an absolute threshold.
    if ((m.textLength ?? 0) < (step.minText ?? 40)) gates.push(`blank render — textLength ${m.textLength}`);
    if ((step.expectZeroBrokenMedia !== false) && (m.brokenMedia?.length ?? 0) > 0 && (step.rows || {}).__images !== false) {
      const likelyFixture = m.brokenMedia.every((b) => !b.hasBox);
      gates.push(`brokenMedia ${m.brokenMedia.length}${likelyFixture ? ' (likely your fixture)' : ''}`);
    }
    if (step.expectApiCalls && apiCalls.length === 0) gates.push('no API calls seen — the interceptor missed, or the page is static');
    // `allowOverflow: true` on a step means "this route is *meant* to scroll
    // sideways, do not gate it". Default is to gate. The guard used to read
    // `m.hOverflow && step.allowOverflow`, which fired only when overflow was
    // explicitly permitted — the gate was dead code on every default flow and
    // printed a warning on the one flow that had asked for quiet.
    if (m.hOverflow && !step.allowOverflow) gates.push(`horizontal overflow: scrollWidth ${m.docScrollW} > ${m.vw}`);
  }
  if (entry.finalUrl && step.expectUrl && !step.finalUrl.includes(step.expectUrl)) {
    gates.push(`redirected: ${step.route} → ${entry.finalUrl.replace(base, '')}`);
  }
  entry.smoke = { pass: gates.length === 0, gates };

  report.captures += 1;
  if (gates.length) report.gateFailures.push(`${step.id}/${vpName}: ${gates.join('; ')}`);
  if (!entry.ok) report.failedCaptures.push(`${step.id}/${vpName}`);

  if (keepOpenOnFail && gates.length) console.log(`   ↳ holding ${vpName} open for inspection (--keep-open)`);
  else await context.close();

  return entry;
}

// ── main ──────────────────────────────────────────────────────────────────
const selected = targets.includes('all') ? Object.keys(flows) : targets;
const missing = selected.filter((id) => !flows[id]);
if (missing.length) {
  console.error(`unknown flow(s): ${missing.join(', ')}\navailable: ${Object.keys(flows).join(', ')}`);
  process.exit(2);
}

console.log(`capture — ${base}`);
console.log(`  flows    ${fromLabel(selected)}`);
console.log(`  adapter  ${adapter.name}${adapter.name === 'supabase' ? ' (backend emulated in-flight)' : ' (real backend)'}`);
console.log(`  flows.mjs ${flowsFrom}`);
console.log(`  output   ${path.join(writeZone, 'evidence')}\n`);

function fromLabel(ids) { return ids.length > 3 ? `${ids.length} flows` : ids.join(', '); }

const browser = await launchChromium({ headless: !headed, args: ['--font-render-hinting=none'] });
const overall = { captures: 0, gateFailures: [], failedCaptures: [], startedAt: new Date().toISOString() };

try {
  for (const id of selected) {
    const flow = flows[id];
    let steps = flow.steps;
    if (smoke) steps = steps.slice(0, 2);
    const outRoot = path.join(writeZone, 'evidence', id);
    const results = [];

    console.log(`${id} ${flow.name ?? ''}`);
    for (const step of steps) {
      const vps = viewportOverride ?? step.viewports ?? flow.viewports ?? ['desktop', 'mobile'];
      for (const vpName of vps) {
        const t0 = Date.now();
        process.stdout.write(`  ${step.id.padEnd(34)} ${vpName.padEnd(8)} `);
        try {
          const entry = await captureStep(browser, { ...flow, id }, step, vpName, overall);
          results.push(entry);
          const m = entry.measure;
          const bits = [
            m ? `txt ${m.textLength}` : 'no measure',
            m?.hOverflow ? 'H-OVERFLOW' : '',
            `${((Date.now() - t0) / 1000).toFixed(1)}s`,
          ].filter(Boolean).join('  ');
          console.log(`${bits}  ${entry.smoke.pass ? '' : '⚠ ' + entry.smoke.gates.join('; ')}`);
        } catch (e) {
          console.log(`ERROR ${String(e).slice(0, 140)}`);
          overall.gateFailures.push(`${step.id}/${vpName}: ${String(e).slice(0, 140)}`);
        }
      }
    }

    fs.mkdirSync(outRoot, { recursive: true });
    fs.writeFileSync(
      path.join(outRoot, 'results.json'),
      JSON.stringify({ flow: id, name: flow.name ?? null, adapter: adapter.name, viewportList: viewportOverride, results }, null, 2),
    );
  }
} finally {
  await browser.close();
}

fs.writeFileSync(path.join(writeZone, 'evidence', 'capture-run.json'), JSON.stringify(overall, null, 2));

// ── verdict ───────────────────────────────────────────────────────────────
const cap = overall.captures;
console.log(`\n${cap} captures`);
if (overall.gateFailures.length) {
  console.log(`\n${overall.gateFailures.length} gate failure(s) — fix these before dispatching workers:`);
  for (const g of overall.gateFailures.slice(0, 25)) console.log(`  ⚠ ${g}`);
  process.exit(smoke ? 1 : 0);
}
console.log(smoke ? '\nsmoke clean. safe to fan out.' : '\nall smoke gates passed.');
