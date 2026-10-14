#!/usr/bin/env node
/**
 * cluster.mjs — collapse N findings into M root causes.
 *
 * The raw finding count is noise. What a team acts on is "seven lines of code
 * explain a third of the report". This script does the mechanical half of that
 * grouping; a human then names each cluster and writes the one-line fix.
 *
 *   node cluster.mjs <findings-dir> [--clusters <clusters.mjs>] [--json]
 *
 * Three passes, cheapest first:
 *
 *   1. SEEDED   regex patterns from the project's clusters file, matched over
 *               summary + expected + observed. These are the known systemic
 *               causes; you write them after the first run of a project.
 *   2. SOURCE   greedy grouping of findings that share a sourceHint file.
 *               This catches the root causes nobody seeded, because a defect
 *               with no source line is usually a guess and a defect with the
 *               same source line is usually the same cause.
 *   3. ROUTE    findings that repeat on the same route. Usually not a root
 *               cause but always worth surfacing — it marks a neglected screen.
 *
 * Output goes to stdout, or to <findings-dir>/../clusters.json with --json.
 */

import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const asJson = args.includes('--json');

/** Value that follows a flag, looked up in the original argv. */
const flagValue = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

const findingsDir = args.filter((a) => !a.startsWith('--') && a !== flagValue('--clusters'))[0];
const clustersFile = flagValue('--clusters');

if (!findingsDir) {
  console.error('usage: node cluster.mjs <findings-dir> [--clusters <clusters.mjs>] [--json]');
  process.exit(2);
}

const SEED = clustersFile && fs.existsSync(clustersFile)
  ? (await import(path.resolve(clustersFile))).default
  : [];

// ── load ──────────────────────────────────────────────────────────────────
const all = [];
for (const file of fs.readdirSync(findingsDir).filter((f) => f.endsWith('.json'))) {
  const doc = JSON.parse(fs.readFileSync(path.join(findingsDir, file), 'utf8'));
  for (const f of doc.findings) {
    all.push({
      ...f,
      flow: doc.flow,
      blob: `${f.summary} ${f.expected ?? ''} ${f.observed ?? ''}`.toLowerCase(),
      sourceFile: f.sourceHint ? (f.sourceHint.match(/^([\w./-]+):(\d+)/)?.[1] ?? null) : null,
    });
  }
}

// ── pass 1: seeded patterns ───────────────────────────────────────────────
const assigned = new Set();
const clusters = [];

for (const seed of SEED) {
  const re = new RegExp(seed.match, 'i');
  const hits = all.filter((f) => !assigned.has(f.id) && re.test(f.blob));
  if (hits.length < (seed.minHits ?? 2)) continue;
  for (const h of hits) assigned.add(h.id);
  clusters.push({
    id: seed.id,
    name: seed.name,
    match: seed.match,
    kind: 'seeded',
    note: seed.note ?? '',
    rootCause: seed.rootCause ?? '',
    oneLineFix: seed.oneLineFix ?? '',
    findings: hits,
  });
}

// ── pass 2: shared source file ────────────────────────────────────────────
const bySource = new Map();
for (const f of all) {
  if (assigned.has(f.id) || !f.sourceFile) continue;
  if (!bySource.has(f.sourceFile)) bySource.set(f.sourceFile, []);
  bySource.get(f.sourceFile).push(f);
}
for (const [src, hits] of [...bySource].sort((a, b) => b[1].length - a[1].length)) {
  if (hits.length < 2) continue;
  for (const h of hits) assigned.add(h.id);
  clusters.push({
    id: `SRC-${path.basename(src)}`,
    name: `Shared source: ${src}`,
    match: src,
    kind: 'source',
    note: 'Grouped because these findings point at the same file. Confirm they share a cause before filing.',
    rootCause: '',
    oneLineFix: '',
    findings: hits,
  });
}

// ── pass 3: hot routes ────────────────────────────────────────────────────
const byRoute = new Map();
for (const f of all) {
  if (assigned.has(f.id)) continue;
  const key = Array.isArray(f.route) ? f.route.join(' ') : String(f.route ?? '');
  if (!key) continue;
  const norm = key.split(',')[0].trim();
  if (!byRoute.has(norm)) byRoute.set(norm, []);
  byRoute.get(norm).push(f);
}
for (const [route, hits] of [...byRoute].sort((a, b) => b[1].length - a[1].length)) {
  if (hits.length < 3) continue;
  for (const h of hits) assigned.add(h.id);
  clusters.push({
    id: `ROUTE-${route.replace(/[^\w]+/g, '-')}`,
    name: `Hot route: ${route}`,
    match: route,
    kind: 'route',
    note: 'Several findings on one route. Usually a neglected screen rather than a shared cause — check for one behind the others.',
    rootCause: '',
    oneLineFix: '',
    findings: hits,
  });
}

// ── leftovers ─────────────────────────────────────────────────────────────
const leftovers = all.filter((f) => !assigned.has(f.id));
if (leftovers.length) {
  clusters.push({
    id: 'MISC',
    name: 'Unclustered findings',
    match: '',
    kind: 'misc',
    note: 'No shared seed pattern or source file. Each needs individual judgement.',
    rootCause: '',
    oneLineFix: '',
    findings: leftovers,
  });
}

// ── severity weight ───────────────────────────────────────────────────────
const W = { P0: 100, P1: 40, P2: 12, P3: 4, P4: 1 };
for (const c of clusters) {
  c.severity = c.findings.reduce((sum, f) => sum + (W[f.severity] ?? 0), 0);
  c.count = c.findings.length;
  c.bySeverity = c.findings.reduce((m, f) => ((m[f.severity] = (m[f.severity] || 0) + 1), m), {});
  c.routes = [...new Set(c.findings.map((f) => (Array.isArray(f.route) ? f.route.join(' ') : f.route)))];
  c.flows = [...new Set(c.findings.map((f) => f.flow))].sort();
}
clusters.sort((a, b) => b.severity - a.severity);

const total = all.length;
const clustered = clusters.filter((c) => c.kind !== 'misc').reduce((n, c) => n + c.count, 0);
const compression = total === 0 ? 0 : 1 - clusters.filter((c) => c.kind !== 'misc').length / clustered;

// ── output ────────────────────────────────────────────────────────────────
if (asJson) {
  const out = clusters.map(({ findings, ...rest }) => ({
    ...rest,
    findingIds: findings.map((f) => f.id),
  }));
  fs.writeFileSync(path.join(findingsDir, '..', 'clusters.json'), JSON.stringify({ total, clustered, clusters: out }, null, 2));
  console.error(`wrote ${path.join(findingsDir, '..', 'clusters.json')}`);
  process.exit(0);
}

console.log(`cluster — ${total} findings → ${clusters.length} groups (${clustered} clustered, ${(compression * 100).toFixed(0)}% compression)\n`);
for (const c of clusters) {
  const tag = c.kind === 'seeded' ? 'SEED' : c.kind === 'source' ? 'SRC ' : c.kind === 'route' ? 'RTE ' : 'MISC';
  console.log(`${tag} ${c.id.padEnd(34)} ${String(c.count).padStart(3)} findings  weight ${String(c.severity).padStart(4)}  ${JSON.stringify(c.bySeverity)}`);
  console.log(`     ${c.name}`);
  if (c.routes?.length && c.routes.length <= 3) console.log(`     routes: ${c.routes.join('  ')}`);
  if (c.flows?.length) console.log(`     flows:  ${c.flows.join(' ')}`);
  if (c.note) console.log(`     ${c.note}`);
  if (c.rootCause) console.log(`     cause:  ${c.rootCause}`);
  if (c.oneLineFix) console.log(`     fix:    ${c.oneLineFix}`);
  console.log(`     ids:    ${c.findings.map((f) => f.id).join(' ')}`);
  console.log();
}
console.log('Next: give every SEED/SRC group a rootCause and a oneLineFix, then write the report.');