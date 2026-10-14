#!/usr/bin/env node
/**
 * templates.mjs — generate the worker brief and per-worker prompt files from
 * project.config.json, so the contract stays identical across workers and you
 * never re-type it.
 *
 *   node templates.mjs --config project.config.json --out <run-dir>
 *
 * Writes:
 *   <run-dir>/BRIEF.md            the shared contract
 *   <run-dir>/prompts/task-F1.txt one line per worker
 *
 * The one-line prompt matters: multi-line prompts fail silently in `opencode
 * mini`. The long brief lives in a file; the prompt is a pointer.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const configPath = path.resolve(flag('--config', 'project.config.json'));
const out = path.resolve(flag('--out', '.'));
const flowsPath = flag('--flows', null);

if (!fs.existsSync(configPath)) {
  console.error(`config not found: ${configPath}`);
  process.exit(2);
}
const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
// Where this skill lives on disk, so the brief can name an absolute path the
// worker can run without guessing where it is installed.
const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Accept either `export default {...}` or `export const FLOWS = {...}`.
let flows = null;
if (flowsPath) {
  const mod = await import(path.resolve(flowsPath));
  flows = mod.default ?? mod.FLOWS ?? Object.fromEntries(Object.entries(mod).filter(([, v]) => v && typeof v === 'object' && v.name));
}

const briefs = [];

briefs.push(`# Worker brief — ${cfg.name} visual regression

READ-ONLY visual QA on the ${cfg.name} app.
Repo: \`${cfg.repo ?? process.cwd()}\`
Target: **${cfg.baseUrl}**${cfg.devServer ? ` (already running — do not start or stop it)` : ''}

## Hard rules

1. **No code changes.** Do not edit, create or delete anything under
   ${(cfg.auditPaths ?? []).join(', ')} or any config file. Do not run
   \`git checkout\`, \`git stash\`, formatters, codegen, or a build. You are an auditor.
2. **Write only inside \`${cfg.writeZone}\`**${cfg.writeZoneNote ?? ''}. That is your only writable area.
3. Do not run the whole Playwright suite. Use the harness.
4. Do not fix anything. Report only.

## Project context you must know

### Backend availability — this decides how you read every screenshot

${cfg.api?.reachable === false
  ? `The backend is **unreachable** from this machine. GoTrue and PostgREST are emulated
in-flight by the harness. This means:

- Client-side validation, layout, typography, focus, contrast, form states, error
  states, routing and redirects are **real**.
- Server responses and row **content are synthetic**.

Before you file anything, decide whether the finding depends on what a row *says*
or on the chrome around it. Chrome findings stand. Content findings get
\`fixtureInduced: true\` and must not be P0 or P1.`
  : 'The backend is reachable. Real auth, real data.'}

### Canon — the source of truth for "expected"

| | |
|---|---|
| Display font | ${cfg.canon?.fonts?.display ?? '(not declared)'} |
| Body font | ${cfg.canon?.fonts?.body ?? '(not declared)'} |
| Accent | \`${cfg.canon?.colors?.accent ?? '?'}\` |
| Background | \`${cfg.canon?.colors?.background ?? '?'}\` |
| Muted text | \`${cfg.canon?.colors?.mutedText ?? '?'}\` |
| Forbidden | ${(cfg.canon?.forbidden ?? []).map((f) => `\`${f}\``).join(', ') || '(none)'} |

${cfg.canon?.ctaLabel ? `A defect is any screen where the rendered result contradicts the table above — not where you would have designed it differently.` : ''}

## Step 1 — capture

\`\`\`bash
node ${skillRoot}/scripts/capture.mjs <FLOW_ID> --config ${cfg.writeZone}/project.config.json
\`\`\`

If a step errors or a state did not render, fix the flow spec in
\`${cfg.writeZone}/flows.mjs\` (selectors, waits, fixture rows) — that file is
inside your write zone. Re-run until every step captures. **Never edit app code
to make a capture work.**

## Step 2 — actually look

For every capture in \`evidence/<FLOW>/results.json\`:

- **Open the screenshot with the read tool.** They are PNGs and the tool renders
  them. Do not summarise from JSON alone — overlaps, blank images and misaligned
  grids have no measurement and JSON will not show them to you.
- Cross-check the measurement fields: \`hOverflow\`, \`overflow[]\`, \`clipped[]\`,
  \`smallTargets[]\`, \`lowContrast[]\`, \`brokenMedia[]\`, \`fonts[]\`, \`headings[]\`,
  \`h1Texts\`, \`textLength\`, \`finalUrl\`, \`console[]\`, \`pageErrors[]\`,
  \`failedRequests[]\`, \`supabaseCalls[]\`.

## Step 3 — before you call anything a defect

Check whether the cause is a **declared-but-uninstalled dependency**, a **missing
build artefact**, or a **dev-server-only overlay**:

\`\`\`bash
rg '"<pkg>"' package.json && ls node_modules/<pkg>
\`\`\`

If it is the environment, report it as environment-blocked and move on. One false
P0 costs more credibility than ten true P4s earn.

## Step 4 — hunt for

**Layout** — overflow, clipped or truncated text, overlap, misaligned repeated
items, inconsistent padding between screens of one flow, fixed elements covering
content at the end of a long page.
**Responsive** — 1440 / 1024 / 390 / 320. Reflow or squash? Touch targets under
44px? Mobile nav collisions? Text that only fits because of a short fixture string?
**Typography** — a font family that is not the canon one. Heading sizes that
differ between siblings with the same role. Line-height wrong at a given size.
**Colour** — text under the AA ratio (cite the measured pair). The forbidden
colours in the table above. More than one accent on a screen.
**State** — empty, loading, error. Disabled that looks enabled and the reverse.
Validation timing and placement. Focus visibility on everything Tab reaches.
Hover and pressed states that shift layout.
**Copy and semantics** — a CTA whose label disagrees with its action. Heading
order. Duplicate labels. Icons with no accessible name. Status text with no
\`role="alert"\`.
**Runtime** — console errors, page exceptions, failed requests, surprising
redirects, a screen that renders blank.

## Severity

| | |
|---|---|
${Object.entries(cfg.severity ?? {}).map(([k, v]) => `| **${k}** | ${v} |`).join('\n')}

Rank by what a paying member would actually notice. Do not inflate.

## Output — exactly two files

1. \`${cfg.writeZone}/findings/<FLOW_ID>.json\`

\`\`\`json
{
  "flow": "F1",
  "flowName": "Log In",
  "captures": 12,
  "findings": [
    {
      "id": "F1-01",
      "category": "responsive",
      "severity": "P2",
      "route": "/login",
      "state": "empty form, mobile 390",
      "summary": "One factual sentence about what the user sees.",
      "expected": "What the canon or the rest of the app does.",
      "observed": "What this screen does, with selectors and computed values.",
      "measurement": "The number from results.json, or null.",
      "evidence": ["evidence/F1/f1-login-empty-mobile/mobile/view.png"],
      "fixtureInduced": false,
      "confidence": "high",
      "sourceHint": "src/…:123 (only if you actually read it)"
    }
  ]
}
\`\`\`

2. \`${cfg.writeZone}/findings/<FLOW_ID>.md\` — short human report:

\`\`\`markdown
# F1 — Log In
**Captures:** 12 (routes: …)
**Verdict:** one line

## Findings
| id | sev | where | finding | evidence |
|----|-----|-------|---------|----------|

## What looks right
<3-6 bullets you verified and found sound>

## Blocked / not verified
<what you could not capture, and why>
\`\`\`

"State" is not optional — a route is not a location. The same route fails
differently at "empty form" and at "invalid credentials".

## Finish

Reply with **only** this, under 200 words:

\`\`\`
F<n> — <name>: <N> findings (P0:<n> P1:<n> P2:<n> P3:<n> P4:<n>), <N> captures, <N> blocked.
Top: <severity> <one line> — <route>
     <severity> <one line> — <route>
     <severity> <one line> — <route>
Files: ${cfg.writeZone}/findings/F<n>.json, F<n>.md
\`\`\`

Never paste the report into chat. Never claim you verified something you did not open.
`);

fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'BRIEF.md'), briefs.join('\n'));
fs.mkdirSync(path.join(out, 'prompts'), { recursive: true });

if (flows) {
  for (const [id, flow] of Object.entries(flows)) {
    const name = `f${id.replace(/\D/g, '')}`;
    const extra = flow.focus ? `\nFocus for this flow: ${flow.focus}\n` : '';
    fs.writeFileSync(
      path.join(out, 'prompts', `task-${name}.txt`),
      `You are worker ${name}. Read ${out}/BRIEF.md first and follow it exactly, including every hard rule.\n\n` +
      `Your flow: ${id} (${flow.name}).${extra}\n` +
      `Rules that matter most right now:\n` +
      `- READ-ONLY. Never edit anything under ${(cfg.auditPaths ?? []).join(', ')} or config. Your only writable area is ${cfg.writeZone}/.\n` +
      `- ${cfg.baseUrl} is already running. Do not start or stop it.\n` +
      `- If a step fails to capture, fix the spec in ${cfg.writeZone}/flows.mjs — never app code.\n` +
      `- Actually open every screenshot with the read tool. Do not report from JSON alone.\n` +
      `- Check for declared-but-uninstalled dependencies before filing a defect.\n` +
      `- Write findings/${id}.json and findings/${id}.md only.\n\n` +
      `Start now: run the capture for ${id}, then analyse every screenshot and measurement.\n`,
    );
    console.log(`  prompts/task-${name}.txt  →  ${id} ${flow.name}`);
  }
}

console.log(`BRIEF.md written (${briefs.join('\n').split('\n').length} lines) to ${out}`);
console.log('Reminder: send workers a ONE-LINE prompt. Multi-line prompts fail silently in `opencode mini`.');