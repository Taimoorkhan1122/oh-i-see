#!/usr/bin/env node
/**
 * merge.mjs — one pass over the findings files that produces every number the
 * report is allowed to quote.
 *
 *   node merge.mjs <findings-dir> [--root <run-dir>]
 *
 * Writes <run-dir>/all-findings.json and prints a stats block.
 *
 * Why this exists: on the reference run a report said 105 findings while the files
 * held 113, because the summary was generated before one worker finished
 * expanding its own file. A hand-maintained count drifts. This script has no
 * number typed by hand in it, so it cannot.
 */

import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };

// Accept `node merge.mjs <dir>` as shorthand for `--findings <dir>`, which is
// how everyone actually types it.
const positional = args.find((a) => !a.startsWith('--') && args[args.indexOf(a) - 1]?.startsWith('--') !== true);
const findingsDir = path.resolve(flag('--findings', positional ?? 'findings'));
const root = path.resolve(flag('--root', path.dirname(findingsDir)));
const outName = flag('--out', 'all-findings.json');

if (!fs.existsSync(findingsDir)) {
  console.error(`findings dir not found: ${findingsDir}`);
  process.exit(2);
}

const files = fs.readdirSync(findingsDir).filter((f) => f.endsWith('.json')).sort();
const order = files.slice().sort((a, b) => {
  const n = (s) => parseInt(String(s).match(/\d+/)?.[0] ?? '0', 10);
  return n(a) - n(b);
});

const all = [];
const perFlow = [];
const problems = [];

for (const file of order) {
  let doc;
  try { doc = JSON.parse(fs.readFileSync(path.join(findingsDir, file), 'utf8')); }
  catch (e) { problems.push(`${file}: unparseable — ${e.message}`); continue; }

  const flowId = doc.flow ?? file.replace(/\.json$/, '');
  const list = Array.isArray(doc.findings) ? doc.findings : [];
  perFlow.push({ flow: flowId, name: doc.flowName ?? null, captures: doc.captures ?? null, findings: list.length });

  for (const f of list) {
    if (!f.id) { problems.push(`${file}: a finding has no id`); continue; }
    const expectedPrefix = String(flowId).replace(/\D/g, '');
    if (String(f.id).startsWith('F') && expectedPrefix && !String(f.id).startsWith(`F${expectedPrefix}-`)) {
      problems.push(`${f.id} is in ${file} but its id does not start with F${expectedPrefix}-`);
    }
    all.push({ ...f, flow: flowId, flowName: doc.flowName ?? null, _file: file });
  }
}

// ── stats ────────────────────────────────────────────────────────────────
const bySeverity = {};
for (const f of all) bySeverity[f.severity] = (bySeverity[f.severity] || 0) + 1;

const withEvidence = all.filter((f) => Array.isArray(f.evidence) && f.evidence.length).length;
const withMeasurement = all.filter((f) => f.measurement && String(f.measurement).trim()).length;
const withSource = all.filter((f) => f.sourceHint && String(f.sourceHint).trim()).length;
const fixtureInduced = all.filter((f) => f.fixtureInduced === true).length;

const byCategory = {};
for (const f of all) byCategory[f.category || '(uncategorised)'] = (byCategory[f.category || '(uncategorised)'] || 0) + 1;

const byConfidence = {};
for (const f of all) byConfidence[f.confidence || '(unset)'] = (byConfidence[f.confidence || '(unset)'] || 0) + 1;

// Coverage comes from the capture artefacts, not from anything a worker typed.
let captures = 0, screenshots = 0;
const evidenceDir = path.join(root, 'evidence');
if (fs.existsSync(evidenceDir)) {
  for (const flowDir of fs.readdirSync(evidenceDir)) {
    const res = path.join(evidenceDir, flowDir, 'results.json');
    if (fs.existsSync(res)) {
      try { captures += JSON.parse(fs.readFileSync(res, 'utf8')).results?.length ?? 0; } catch {}
    }
    const walk = (d) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        if (e.isDirectory()) walk(path.join(d, e.name));
        else if (e.name.endsWith('.png')) screenshots += 1;
      }
    };
    const fd = path.join(evidenceDir, flowDir);
    if (fs.existsSync(fd)) walk(fd);
  }
}

const payload = {
  generatedAt: new Date().toISOString(),
  root: path.relative(process.cwd(), root) || '.',
  total: all.length,
  stats: {
    files: files.length,
    bySeverity,
    byCategory,
    byConfidence,
    withEvidence,
    withMeasurement,
    withSource,
    fixtureInduced,
    captures,
    screenshots,
  },
  perFlow,
  findings: all,
};

const out = path.join(root, outName);
fs.writeFileSync(out, JSON.stringify(payload, null, 2));

// ── report ───────────────────────────────────────────────────────────────
const pct = (n) => (all.length ? `${Math.round((n / all.length) * 100)}%` : '0%');
const sev = ['P0', 'P1', 'P2', 'P3', 'P4'].filter((s) => bySeverity[s]);

console.log(`merge — ${files.length} files, ${all.length} findings → ${path.relative(process.cwd(), out)}\n`);
console.log(`  severity         ${sev.map((s) => `${s} ${bySeverity[s]}`).join('   ') || '(none)'}`);
console.log(`  with evidence    ${withEvidence}/${all.length} (${pct(withEvidence)})`);
console.log(`  with measurement ${withMeasurement}/${all.length} (${pct(withMeasurement)})`);
console.log(`  with source      ${withSource}/${all.length} (${pct(withSource)})`);
console.log(`  fixture-induced  ${fixtureInduced}`);
console.log(`  coverage         ${captures} captures, ${screenshots} screenshots`);

console.log(`\n  by flow`);
for (const p of perFlow) console.log(`    ${String(p.flow).padEnd(5)} ${String(p.findings).padStart(3)} findings  ${p.captures ?? '?'} captures  ${p.name ?? ''}`);

const cats = Object.entries(byCategory).sort((a, b) => b[1] - a[1]);
if (cats.length) {
  console.log(`\n  by category`);
  for (const [c, n] of cats) console.log(`    ${c.padEnd(14)} ${String(n).padStart(3)}`);
}

if (problems.length) {
  console.log(`\n  ${problems.length} problem(s)`);
  for (const p of problems.slice(0, 20)) console.log(`    ! ${p}`);
}

console.log(`\nQuote these numbers in the report. Do not recount by hand — merge.mjs is the source.`);
if (problems.length) process.exit(1);
