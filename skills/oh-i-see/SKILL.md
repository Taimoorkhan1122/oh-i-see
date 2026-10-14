---
name: oh-i-see
license: MIT
compatibility: Requires Node.js 18+, a running dev server for the app under audit, and network access. `probe-stack.mjs` shells out to `curl` and `dig`; the capture engine needs Playwright with a Chromium build (the skill installs Playwright, run `npx playwright install chromium` once). Works on macOS, Linux and Windows. `rg` (ripgrep) is used in the verification step.
metadata:
  version: "1.0.0"
description: Run an evidence-backed visual regression audit of a web app — drive real user journeys with Playwright, screenshot every state at every breakpoint, measure contrast/focus/tap-targets/overflow/typography, then produce a findings report where every claim carries a screenshot path and a recomputable number. Use this whenever the user asks for a visual audit, UI QA, visual regression, design review, "check the UI", "find UI bugs", "look for layout/contrast/focus problems", "does this look right on mobile", or wants a bug report about how a flow looks or behaves — even if they don't say the word "audit". Also use it when a user asks to check several screens or a whole journey at once, when they want responsive/mobile checked, or when they want to know what to fix first. Triggers on "visual regression", "UI audit", "design QA", "screenshot every state", "check contrast", "a11y pass", "responsive check", "walk the signup flow and find issues".
---

# Oh I See

Finds small UI faults across a set of user journeys and produces a report where
**every finding carries an openable screenshot and a recomputable number**.

The thing that makes this different from eyeballing screenshots is the last
clause. A finding that says "the login form is too wide" is an opinion. A
finding that says "`.auth-form` at `src/styles/theme.css:412` has no max-width;
at 1440px the field spans 1404px against a 380px reference on the sibling form"
is a ticket. The audit is built to produce the second kind.

## Why fan out at all

One journey is one screenshot set and one page of analysis — do that inline, it
is faster. Fan out when there are **four or more flows**, or when the user asked
for a sweep of the app. Each worker takes one flow, reads its own screenshots,
and writes its own findings file; you merge, verify, and cluster.

The reference run: 10 flows, 193 captures, 221 screenshots, 113 findings, and
**41 of those 113 turned out to be the same seven root causes seen from different
angles**. That collapse is the deliverable. A pile of 113 findings is a list; a
pile of 7 root causes with one-line fixes is a plan.

## The rules that decide whether the run is good

**Read-only.** No code changes. The audit lives in a git-ignored write zone; the
app and its config are not yours to touch. If a step fails to capture, fix the
flow spec — never app code. That boundary is what makes it safe to run against
production.

**Actually open the screenshots.** Workers are given JSON with contrast ratios and
overflow offenders, and JSON cannot show them an overlap, a blank image, or a
misaligned grid. A worker that reports from JSON alone produces a plausible,
useless, confident report.

**Never claim you checked something you did not open.**

**Say what is synthetic, up front.** If the backend could not be reached, row
data is fabricated. That belongs in the report header, not in a footnote,
because a reader who does not know will trust the wrong findings.

## Phases

Each phase ends in a gate you can fail. Every expensive failure mode here is
silent — a blank screenshot, a worker that stopped thinking, a P0 that is really
a missing package — so the gates are the point, not the ceremony.

```
PROBE ──▶ SCAFFOLD ──▶ SMOKE ──▶ FAN OUT ──▶ COLLECT ──▶ VERIFY ──▶ CLUSTER ──▶ DELIVER
```

Full runbook with gates, sizing, the worker loop and a failure-recovery table:
**`references/workflow.md`**. Read it before starting a run.

### 1. Probe — one command, 60 seconds

```bash
node scripts/probe-stack.mjs --cwd <repo> --port <port> --write-zone <zone>
```

Finds the framework, the dev server, the route list, Playwright, whether the
write zone is git-ignored, and — most importantly — **which rung of the API
ladder you are on**:

| Ladder | Condition | What it means for the run |
|---|---|---|
| 1 | API resolves and answers | real auth, real data |
| 2 | Resolves, rejects anonymous | add the bypass header from config |
| 3 | Host does not resolve | emulate the backend in-flight; findings about row *content* get marked `fixtureInduced` |

On ladder 3 the caveat must be enforced in **three** places, because it is the
easiest thing to forget: the report header, the worker brief, and the severity
pass. The validator enforces the third one mechanically.

### 2. Scaffold — 5 minutes

Copy `assets/project.config.example.json` and `assets/flows.example.mjs` into the
write zone and edit them.

**The canon block is the highest-leverage five minutes of the run.** It is where
"expected" comes from. On the reference run, 44 of 113 findings existed only
because the project had already written down its own rules — fonts, accent
colour, background — and the rendered pixels disagreed. A project with no written
canon gets layout findings and nothing else.

### 3. Smoke — 2 minutes, never skip

```bash
node scripts/capture.mjs all --smoke
```

Two steps: one signed-out, one signed-in. This is where you find out the harness
is lying. On the reference run the smoke test revealed that `/landing` silently
redirects off-app and that a synthetic image fixture was manufacturing fake
"broken media" findings. Both changed the flow definitions. Ten workers finding
that at the same time is ten wasted captures.

### 4. Fan out — one worker per flow

```bash
node scripts/templates.mjs --config <zone>/project.config.json --out <zone> --flows <zone>/flows.mjs
```

Writes `BRIEF.md` and one prompt file per worker. **Send a one-line prompt that
points at the file** — multi-line prompts fail silently in `opencode mini`:

```bash
herdr agent prompt f4 "Read $ZONE/prompts/task-f4.txt and execute it now."
```

Wave 1 is 5 workers. On 8 cores, 5 concurrent Playwright drivers is the ceiling
before captures start timing out. Watch load between waves.

### 5. Collect, verify, cluster

```bash
node scripts/validate-findings.mjs <zone>/findings --root <zone>
node scripts/merge.mjs <zone>/findings --root <zone>
node scripts/cluster.mjs <zone>/findings --clusters clusters.mjs
```

`validate-findings.mjs` is the evidence gate — it rejects any finding whose
screenshot does not exist, whose severity is invalid, or which claims a
measurement it does not carry. On the reference run: **113 findings, 0 errors**,
100% with openable evidence, 66% with a measurement, 88% with a source locator.

`cluster.mjs` does three passes — seeded patterns, shared `sourceHint` file, hot
routes. Reference result: **113 findings → 19 groups, 88 clustered, 80%
compression.**

### 6. Deliver

`references/report-skeleton.md`. Verdict first. Always include "What looks
right" — a report that is only negative gets read as an attack on the codebase.

## Verifying before you believe it

Never take a worker's word for a P0. Three commands settle most of them:

```bash
rg '"<pkg>"' package.json && ls node_modules/<pkg>
```

On the reference run this demoted the only P0 in the report: a whole route
rendering an error boundary, caused by a package declared in `package.json:76`
and absent from `node_modules`. An environment artefact.

Also check the counts. `merge.mjs` exists because a hand-written summary said
105 findings when the files held 113 — a worker had expanded its own file after
the summary was generated. Let `merge.mjs` produce every number the report
quotes.

## Finding shape

```jsonc
{
  "id": "F6-01",                  // <FLOW>-<NN>, never reused
  "category": "color",
  "severity": "P1",
  "route": "/classes/example/lessons/1",
  "state": "player, Next up tab, desktop 1440 and mobile 390",
  "summary": "One factual sentence. What a user sees, not what the code does.",
  "expected": "What the rest of the app or the written canon does.",
  "observed": "What this screen does, with selectors and computed values.",
  "measurement": "ratio 1.13 (required 4.5) for h4.lesson-card__title, rgb(19,19,17) on rgb(0,0,0)",
  "evidence": ["evidence/F6/f6-lesson-1/mobile/view.png"],
  "fixtureInduced": false,
  "confidence": "high",
  "sourceHint": "src/styles/theme.css:3904 (.lesson-card__title — no color declared)"
}
```

`state` is the field people skip and the one that makes a finding reproducible. A
route alone is not a location — the same route is a different screen at "empty
form" and at "invalid credentials", and they fail differently.

`expected` is where the canon lives. Without it a finding is a preference. With
it, it is a deviation from something the project already wrote down — which is
what turns "the login page is quite wide" into a fix.

The chain every finding has to satisfy:

```
claim ─▶ MEASUREMENT (recomputable) ─▶ EVIDENCE (file must exist)
      ─▶ CAPTURE (raw record)       ─▶ SOURCE (file:line)
      ─▶ VERDICT (environment, or product?)   ← the only judgement in the chain
```

The validator checks every link but the last. The last one is yours.
Full rules, severity calibration and the two mandatory report paragraphs:
**`references/evidence-discipline.md`**.

## Backend adapters

`scripts/lib/adapters/` — `supabase.mjs` (in-flight GoTrue + PostgREST
emulation, ported and generalised), `passthrough.mjs` (real backend),
`index.mjs` (selector). Config picks one.

A third backend needs one new file exporting `attach(context, opts)` and
`seedSession(context, key, session)`, plus a line in `ADAPTERS`. Everything else
in the skill is backend-agnostic.

The Supabase adapter's `authOutcome` lets a flow force a real error state —
`invalid_credentials`, `email_exists`, `weak_password`, `rate_limit`,
`server_error` — which is how you surface "a 429 renders *Incorrect email or
password*", a defect that is completely invisible until you ask for a 429.

## The measurement engine

`scripts/lib/measure.mjs` runs inside the page; `scripts/lib/focus-audit.mjs`
runs from the runner because it needs real key presses.

Four signals shipped a wrong answer silently during the reference run, and all
four are documented with what they cost:

| Signal | Was | Now |
|---|---|---|
| `lowContrast` | ignored foreground alpha — `rgba(...,0.35)` measured as passing | composites over the resolved background |
| `noFocusRing` | "is a Tailwind ring var set" → always true, measured nothing | presses real Tab, diffs focused vs blurred |
| `smallTargets` | measured the bare `<input>` (22px) inside a 52px wrapper | walks up for the wrapper, but never for buttons |
| `clipped` | flagged every `.sr-only` label | skips screen-reader helpers and deliberate ellipsis |

One trap worth knowing: `getPropertyValue` takes the **kebab-case** CSS name.
`getPropertyValue('outlineStyle')` returns `""` with no error, which made an
entire focus audit report "nothing ever changes".

What every signal measures, how to calibrate it, and what to do before adding a
new one: **`references/measurement-signals.md`**.

## Files

```
scripts/
  probe-stack.mjs        recon: framework, routes, API ladder, blockers
  capture.mjs            the engine + CLI — `node capture.mjs all`
  merge.mjs              every number the report is allowed to quote
  validate-findings.mjs  the evidence gate
  cluster.mjs            N findings → M root causes
  templates.mjs          BRIEF.md + one prompt per worker
  lib/
    measure.mjs          in-page signals
    focus-audit.mjs      keyboard-driven focus walk
    adapters/            supabase · passthrough · selector
references/
  workflow.md            runbook, gates, worker loop, recovery table
  evidence-discipline.md the finding schema, severity, the chain
  measurement-signals.md every signal, its failure modes, calibration
  report-skeleton.md     the report template
assets/
  project.config.example.json
  flows.example.mjs
  clusters.example.mjs
```

## Working with a codebase you do not know

A few hours of reconnaissance pays for itself, but you do not need to read the
app before you start. Do this instead, in the first ten minutes:

1. Find the route table — `src/App.tsx` for React Router, `app/**/page.tsx` for
   Next App Router, `routes.ts` or `router.tsx` for a framework router. Pick
   journeys off it directly.
2. Find the design tokens — a `tailwind.config`, a `:root` block, a theme file.
   That is the canon.
3. `git grep` the accent hex and the font family names. Literal hexes and literal
   `fontFamily` strings scattered through components are where the brand
   violations live. On the reference run: 254 literal brand-font uses against 78
   uses of the body-font token.
4. Check `node_modules` for anything declared in `package.json` but missing —
   those become false P0s if you let them.

Then write the flows from the route table, not from a product description. The
journeys a user actually takes are usually not the ones the docs describe.
