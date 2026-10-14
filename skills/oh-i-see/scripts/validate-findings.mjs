#!/usr/bin/env node
/**
 * validate-findings.mjs — the evidence gate.
 *
 * A finding is a claim. This script checks that the claim is backed by
 * something a human can open or recompute. It runs before merge and before
 * the report is generated, so the report can never drift from the data.
 *
 *   node validate-findings.mjs <findings-dir> [--root <run-dir>] [--strict]
 *
 * Exit 0 = clean, 1 = errors found, 2 = usage error.
 *
 * `--strict` promotes warnings to errors. Use it on a run you intend to
 * publish; leave it off while workers are still writing.
 */

import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const strict = args.includes('--strict');
// Read flag values from argv, not from a filtered copy. Indexing a filtered
// array with an index taken from the unfiltered one silently mis-reads every
// flag value — which is how `--root` once pointed at a flag name instead of a
// path and the run reported a clean pass on a directory that did not exist.
const flagValue = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const findingsDir = args.filter((a) => !a.startsWith('--') && a !== flagValue('--root'))[0];
const root = path.resolve(flagValue('--root') ?? path.dirname(findingsDir));

if (!findingsDir) {
  console.error('usage: node validate-findings.mjs <findings-dir> [--root <run-dir>] [--strict]');
  process.exit(2);
}

const REQUIRED = ['id', 'severity', 'category', 'route', 'summary', 'evidence'];
const SEVERITIES = ['P0', 'P1', 'P2', 'P3', 'P4'];
const CATEGORIES = [
  'layout', 'geometry', 'responsive', 'typography', 'spacing', 'alignment',
  'color', 'hierarchy', 'component', 'theme', 'state', 'interaction',
  'copy', 'runtime', 'route', 'a11y',
];
const CONFIDENCE = ['high', 'medium', 'low'];

const errors = [];
const warnings = [];
const stats = { files: 0, findings: 0, bySeverity: {}, withMeasurement: 0, withSource: 0, fixtureInduced: 0 };

function fail(file, id, msg) { errors.push({ file, id, msg }); }
function warn(file, id, msg) { warnings.push({ file, id, msg }); }

const files = fs.readdirSync(findingsDir).filter((f) => f.endsWith('.json'));

for (const file of files) {
  const full = path.join(findingsDir, file);
  let doc;
  try {
    doc = JSON.parse(fs.readFileSync(full, 'utf8'));
  } catch (e) {
    fail(file, '-', `not valid JSON: ${e.message}`);
    continue;
  }
  stats.files += 1;

  if (!Array.isArray(doc.findings)) { fail(file, '-', 'missing "findings" array'); continue; }
  if (typeof doc.flow !== 'string') warn(file, '-', 'missing "flow" id');
  if (typeof doc.captures !== 'number') warn(file, '-', 'missing "captures" count');

  const seenIds = new Set();

  for (const f of doc.findings) {
    stats.findings += 1;
    const id = f.id ?? '(no id)';

    // ── shape ──
    for (const key of REQUIRED) {
      if (f[key] === undefined || f[key] === null || f[key] === '') fail(file, id, `missing required field "${key}"`);
    }
    if (f.severity && !SEVERITIES.includes(f.severity)) fail(file, id, `severity "${f.severity}" not in ${SEVERITIES.join('/')}`);
    if (f.category && !CATEGORIES.includes(f.category)) warn(file, id, `category "${f.category}" not in the standard list`);
    if (f.confidence && !CONFIDENCE.includes(f.confidence)) warn(file, id, `confidence "${f.confidence}" not high|medium|low`);
    if (f.id && seenIds.has(f.id)) fail(file, f.id, 'duplicate id within file');
    if (f.id) seenIds.add(f.id);

    // ── evidence: the part that matters ──
    if (!Array.isArray(f.evidence) || f.evidence.length === 0) {
      fail(file, id, 'no evidence — a finding a human cannot open is not a finding');
    } else {
      for (const rel of f.evidence) {
        const p = path.join(root, rel);
        if (!fs.existsSync(p)) fail(file, id, `evidence file does not exist: ${rel}`);
      }
    }

    // A screenshot alone is not proof of a measurement claim.
    const claimsMeasurement =
      /\d+(\.\d+)?\s*:\s*1|\d+px|\bscrollWidth\b|\bclientWidth\b|\d+\s*(errors|occurrences)/i.test(
        `${f.summary} ${f.observed ?? ''} ${f.measurement ?? ''}`,
      );
    if (claimsMeasurement && !f.measurement) {
      warn(file, id, 'makes a numeric claim but "measurement" is empty — the number is unreproducible');
    }
    if (f.measurement) stats.withMeasurement += 1;

    // A source claim should be a real locator.
    if (f.sourceHint) {
      stats.withSource += 1;
      if (!/[\w./-]+\.[a-z]{1,5}:\d+/.test(f.sourceHint)) {
        warn(file, id, `sourceHint is not a file:line locator — "${f.sourceHint}"`);
      }
      const m = f.sourceHint.match(/^([\w./-]+):(\d+)/);
      if (m) {
        const src = path.join(root, '..', '..', m[1]);
        const fromRoot = path.join(root, m[1]);
        if (!fs.existsSync(src) && !fs.existsSync(fromRoot)) {
          warn(file, id, `sourceHint points at a file that does not resolve from the run dir: ${m[1]}`);
        }
      }
    }

    // A severe finding with no source and no measurement is usually a guess.
    if (['P0', 'P1'].includes(f.severity) && !f.measurement && !f.sourceHint && f.confidence !== 'high') {
      warn(file, id, `${f.severity} with no measurement, no sourceHint and confidence "${f.confidence}"`);
    }

    if (f.fixtureInduced === true) {
      stats.fixtureInduced += 1;
      if (['P0', 'P1'].includes(f.severity)) {
        fail(file, id, `${f.severity} cannot be fixture-induced — either it is real or it is not a defect`);
      }
    }

    if (f.severity) stats.bySeverity[f.severity] = (stats.bySeverity[f.severity] || 0) + 1;
  }
}

const line = (level, arr) => {
  if (!arr.length) return;
  const byFile = {};
  for (const e of arr) (byFile[e.file] ||= []).push(e);
  for (const [file, items] of Object.entries(byFile)) {
    console.log(`\n${level === 'ERROR' ? '✗' : '!'} ${file}`);
    for (const e of items) console.log(`    ${e.id}: ${e.msg}`);
  }
};

console.log(`validate-findings — ${stats.files} files, ${stats.findings} findings`);
console.log(`  severity      ${JSON.stringify(stats.bySeverity)}`);
console.log(`  with measurement ${stats.withMeasurement}/${stats.findings}`);
console.log(`  with source      ${stats.withSource}/${stats.findings}`);
console.log(`  fixture-induced  ${stats.fixtureInduced}`);

line('ERROR', errors);
line('WARN', warnings);

if (errors.length) {
  console.log(`\n${errors.length} error(s).`);
  process.exit(1);
}
if (strict && warnings.length) {
  console.log(`\n${warnings.length} warning(s) and --strict is set.`);
  process.exit(1);
}
console.log(`\nclean${warnings.length ? ` (${warnings.length} warning(s))` : ''}.`);
process.exit(0);