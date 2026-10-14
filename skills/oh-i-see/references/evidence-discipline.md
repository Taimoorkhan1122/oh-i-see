# Evidence-backed reporting

A finding is a claim. This is what makes the claim checkable.

## The chain

Every row in the final report traces back through fixed links. If any link is
missing, the finding does not ship.

```
  claim        "Next-up titles render near-black on black"
     │
     ├─▶ MEASUREMENT   ratio 1.13, colour rgb(19,19,17) on rgb(0,0,0)   ← recomputable
     │
     ├─▶ EVIDENCE      evidence/F6/f6-lesson-1/desktop/view.png          ← openable, and the file must exist
     │
     ├─▶ CAPTURE       evidence/F6/results.json → f6-lesson-1 · desktop   ← the raw record
     │
     ├─▶ SOURCE        src/styles/theme.css:4904 (.lesson-card__title — no color declared)
     │
     └─▶ VERDICT       environment, or product?                           ← the only judgement in the chain
```

`validate-findings.mjs` mechanically checks every link except the last. The last
one is yours.

## The finding schema

The schema below is not what the original brief specified — the workers filled
the gaps in on their own and produced a better shape. Use theirs.

```jsonc
{
  "id": "F6-01",                  // stable: <FLOW>-<NN>, never reused
  "category": "color",            // typography|spacing|alignment|color|hierarchy|
                                  // component|theme|responsive|interaction|copy|
                                  // runtime|state|layout|geometry|route|a11y
  "severity": "P1",
  "route": "/classes/example/lessons/1",
  "state": "player, Next up tab, desktop 1440 and mobile 390",
  "summary": "One factual sentence. What a user sees, not what the code does.",
  "expected": "What the rest of the app or the written canon does.",
  "observed": "What this screen does, with selectors and computed values.",
  "measurement": "ratio 1.13 (required 4.5) for h4.lesson-card__title, rgb(19,19,17) on rgb(0,0,0)",
  "evidence": ["evidence/F6/f6-lesson-1/desktop/view.png"],
  "fixtureInduced": false,
  "confidence": "high",
  "sourceHint": "src/styles/theme.css:4904 (.lesson-card__title — no color declared)"
}
```

### What each field is for

`state` is the one people forget and it is the one that makes a finding
reproducible. A route alone is not a location — the same route is a different
screen at "empty form" and at "invalid credentials", and they fail differently.

`expected` is where the canon lives. Without it a finding is a preference. With
it, it is a deviation from something the project already wrote down. This single
field is what turned "the login page is quite wide" into "the login form has no
max-width, which the canon specifies" — a fix rather than an opinion.

`observed` carries selectors and computed values so the finding survives the
screenshot being lost.

## Severity — calibrated to what a paying member notices

| | Meaning | Reference example |
|---|---|---|
| **P0** | Flow is broken. The user cannot complete it. | — (the one P0 was demoted; see below) |
| **P1** | Major defect on a core step of the flow | The player has no next/previous control |
| **P2** | Clearly visible defect | Oxblood body text at 1.57:1 |
| **P3** | Real but minor | A 36px back button |
| **P4** | Polish nit | A missing `role="alert"` |

Rank by impact on the journey, not by how easy it is to describe. A one-line
summary can be a P1 or a P4; only the flow context decides.

## The three rules that keep a report trustworthy

These are worth more than every measurement in the harness.

### 1. Environment problems are not product defects

The single P0 in the reference run was a whole route rendering an error
boundary. Root cause, three commands:

```bash
rg '"pdf-renderer"' package.json     # → "pdf-renderer": "^6.3.289"   declared
ls node_modules/pdf-renderer         # → absent                      not installed
# vite: Failed to resolve import "pdf-renderer/legacy/build/pdf.mjs"
```

The report demoted it to an environment note and kept only the real residue — a
chunk-load failure drops the user into a bare error boundary with no retry.

Put this check in the brief. A capable model will sometimes catch it. It is not
guaranteed, and one false P0 costs more credibility than ten true P4s earn.

### 2. Fixture-induced findings never outrank real ones

When the backend is unreachable, rows are synthetic. Layout, typography,
contrast, focus and routing findings hold — they are about the chrome, not the
content. Anything that depends on what a row *says* does not.

The validator enforces the ceiling: a `fixtureInduced` finding may not be P0 or P1.

### 3. Derive every number from the merged file

113 findings, not the 105 an earlier count reported — a worker had expanded its
own file after the summary was written. Generate the merged file, the severity
table and the cluster summary in one pass, and let the report quote it. Numbers
typed by hand drift.

## Severity recount after clustering

Clustering changes the shape of the report, so re-rank once at the end:

- A cluster with a **single fix that clears several findings** is a Tier 2 item,
  even when the individual findings were P3s. Nineteen findings explained by one
  missing token outranks nineteen separate P3s in a queue.
- A finding that only exists because of the local environment is out of the
  severity table entirely. It goes in a limitations section.
- A route with three findings and no shared cause is a **neglected screen** —
  say so, because it is a different piece of work from a shared CSS bug.

## What the report is allowed to assert

**Allowed**, because a capture backs it:

> On `/classes/example/lessons/1` at 390px, `h4.lesson-card__title`
> computes to `rgb(19,19,17)` on `rgb(0,0,0)` — ratio 1.13. See
> `evidence/F6/f6-lesson-1/mobile/view.png`.

**Not allowed**, because nothing backs it:

> The lesson player feels unfinished.

**Required**, because a limitation that is not stated reads as a defect:

> `pdf-renderer` is declared in `package.json:76` and absent from `node_modules` on
> this machine. `/library/viewer` was therefore not audited. Run
> `npm install` and re-run flow F7.

## Two paragraphs that must appear in every report

### What was real

> Client-side validation, layout, typography, focus, contrast, form states, error
> states, routing and redirect behaviour were captured against the running
> application. Every finding carries a screenshot path and, where applicable, a
> measurement from the DOM.

### What was synthetic

> `*.supabase.co` does not resolve from this machine — NXDOMAIN on 8.8.8.8,
> 1.1.1.1 and 9.9.9.9. GoTrue and PostgREST were emulated in-flight. Row data is
> synthetic. Any finding that depends on the content of a row is marked
> `fixtureInduced` and excluded from severity ranking. Findings about layout,
> spacing, contrast, focus and routing are unaffected.

A report that omits the second paragraph is overstating its own confidence, and
whoever reads it will find that out on their own. Say it first, not last.

## Harness signals and their known failure modes

Ship none of these unfixed. Both of the first two silently produced wrong
answers during the reference run.

| Signal | Failure mode seen | Fix |
|---|---|---|
| `noFocusRing` | Tailwind's universal `--tw-ring-shadow` makes every element read as "has a ring" | Read the ring vars and treat `box-shadow: none` with a ring var set as "has ring"; add a `:focus-visible` probe |
| `lowContrast` | Ignores foreground alpha — `rgba(...,0.35)` on near-black measured as passing | Composite the foreground over the resolved background before computing luminance |
| `smallTargets` | Measured the bare `<input>` (22px) and produced five false positives per capture | Walk to the nearest padding/bearing ancestor, but only for bare fields — never absorb a button |
| `clipped` | Flagged every `sr-only` label, which is a 1×1 clip rect by design | Skip `.sr-only` and `clip-path` helpers |
| fullPage shots | Unbounded; one flow produced 47MB | Cap at ~6000px and also take a viewport-only shot |

The general lesson: **a measurement engine that has never been shown to be wrong
is an engine you do not yet understand.** Every signal gets calibrated against a
case where you already know the answer.