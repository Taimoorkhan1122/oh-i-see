# The workflow — runbook with gates

One run, start to finish. Every phase ends in a gate you can fail, because the
expensive failure modes in this workflow are all silent: a blank screenshot, a
worker that stopped thinking, a P0 that is really a missing package.

```
PROBE ──▶ SCAFFOLD ──▶ SMOKE ──▶ FAN OUT ──▶ COLLECT ──▶ VERIFY ──▶ CLUSTER ──▶ DELIVER
  │          │           │          │           │          │          │          │
 gate       gate        gate     gate        gate       gate      gate       gate
```

Wall clock for a 10-flow run on 8 cores: ~12 minutes setup, ~90 minutes workers,
~20 minutes verify and synthesise.

---

## PROBE — 60 seconds, one command

```bash
node scripts/probe-stack.mjs --cwd . --port 8080 --write-zone docs/oh-i-see-<date>
```

**Gate — all must pass.** Exit code 1 means a blocker; do not dispatch workers.

- dev server up, or a start command you can run
- routes enumerated (> 0)
- playwright resolvable **and** a chromium build present
- write zone confirmed git-ignored — the probe prints the exact `.git/info/exclude`
  line to add if not
- **API ladder decided**

### The API ladder

This one verdict shapes everything downstream.

| Ladder | Condition | What you do | What goes in the report |
|---|---|---|---|
| 1 | API resolves and answers | Real auth, real data | Nothing special |
| 2 | Resolves, rejects anonymous (401/403 behind a CDN/protection layer) | Add the bypass header from config | "previews required a bypass header" |
| 3 | Host does not resolve (DNS blocked, VPN off, no network) | Emulate the backend in-flight | **"data emulated in-flight"** in the header, plus the rule below |

On ladder 3 the rule that keeps the report honest, and it has to be enforced
three separate times because it is the easiest thing to forget:

1. In the report header.
2. In the worker brief, as a labelling rule.
3. In the severity pass — a finding marked `fixtureInduced` may not be P0 or P1.
   `validate-findings.mjs` enforces rule 3 mechanically.

---

## SCAFFOLD — 5 minutes

Two files, both written by hand from templates. Both go in the write zone.

**`project.config.json`** — base URL, dev server command, write zone, audited
paths, API block, **canon block**, viewports, severity rubric.

The canon block is the highest-leverage five minutes of the whole run. In the
reference run, 44 of 113 findings existed only because a written canon said
"fonts are Spectral + Inter, accent is #B3532E, background is #12141A, never
pure black" and the rendered pixels disagreed. A project with no written canon
gets layout findings only.

**`flows.mjs`** — the journeys. Rules that earn their keep:

- **Stable step ids.** Step ids become folder names. Renaming one orphans its
  screenshots and breaks every evidence path in the findings.
- **Always include 320px** on auth and form-heavy flows. That viewport found the
  worst overlap and tap-target defects in the last run.
- **Provoke the error states.** Deliberately trigger a 429, a wrong password, a
  duplicate email, a short password. The worst auth defect in the last run
  (a 429 rendering "Incorrect email or password") was invisible without forcing it.
- **Walk the paths you are not sure exist.** Six route-drift findings came from
  routes the spec assumed were live.
- **Put at least one flow through the whole auth ladder**, because the auth
  surface is shared CSS and shared bugs live there.

---

## SMOKE — 2 minutes, never skip

Run the harness on exactly two steps: one signed-out, one signed-in.

This is where you find out the harness is lying to you. In the last run the smoke
run revealed that `/landing` silently redirects off-app, and that a synthetic
image fixture was generating fake "broken media" findings. Both changed the flow
definitions. Ten workers finding that simultaneously is ten wasted captures.

**Gate — all five:**

- [ ] every step wrote a non-blank `view.png`
- [ ] `textLength > 200` on content pages (small = rendered empty = bad route or bad mock)
- [ ] `brokenMedia.length === 0` (non-zero = your fixture, not the app)
- [ ] `supabaseCalls` non-empty where the page should fetch (empty = interceptor missed)
- [ ] final URL equals the requested route, or you know why it does not

---

## FAN OUT — one worker per flow

### Sizing

Wave 1 is always 5. On 8 cores, 5 concurrent Playwright drivers is the ceiling
before captures start timing out. Check `uptime` between waves; above ~10 on 8
cores, do not add workers.

### Layout, if using Herdr

One tab. Never one tab per worker — that is how you end up with 12 tabs and no
way to read any of them.

```bash
herdr tab create --workspace "$HERDR_WORKSPACE_ID" --cwd "$PWD" --label qa
# then, to add each worker: split the pane you just created
herdr pane split --pane "$PREV" --direction down --ratio 0.2 --cwd "$PWD" --no-focus
```

`--ratio` is the fraction the **split target keeps**. Splitting an
already-split pane with the default ratio collapses the pane above to zero rows,
which is exactly how two workers died mid-run last time.

Split down, not right. A 200×60 tab split right ten times gives 4-column panes
nobody can read.

### Prompting

Multi-line prompts fail silently in `opencode mini`. Write the brief to a file,
send one line:

```bash
herdr agent prompt f4 "Read $RUN/prompts/task-f4.txt and execute it now."
```

`herdr agent prompt --timeout` requires `--wait`. Without it the call errors and
nothing is sent — which looks identical to the agent ignoring you.

---

## The lead loop — while workers run

Poll every ~4 minutes. This is the part that decides whether the run is good or
wasted, and it is entirely about noticing when a worker has stopped converging.

```
┌─ worker state ──────────────────────────────────────────────────┐
│                                                                  │
│  writing files            → let it run                            │
│  analysing, < 80k tokens  → let it run                            │
│  analysing, > 100k tokens → "write the files now"                 │
│  no token movement, 2 polls→ nudge once, then "write now"          │
│  terminal shows you its findings → it is done, slot free          │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

**The "write now" intervention is not optional.** In the last run two of ten
workers passed 130k tokens still exploring and had to be told to write. The
brief carries a time box, but the brief does not override a model that has
decided to be thorough. The lead does.

---

## COLLECT — 5 minutes, mechanical

```bash
node scripts/validate-findings.mjs "$RUN/findings" --root "$RUN"
```

Hard errors block the report. Soft warnings are judgement calls:

| Warning | What it usually means |
|---|---|
| numeric claim with empty `measurement` | the number came from eyeballing — get it from `results.json` or drop the number |
| `sourceHint` not `file:line` | fine if the claim is purely visual; fine to fix |
| P0/P1 with no measurement, no source, confidence not high | usually a guess wearing a P0 |

---

## VERIFY — 15 minutes, the step people skip

Never take a worker's word for a P0. Check the three worst claims yourself:

```bash
rg '"<pkg>"' package.json                 # is the dependency declared?
ls node_modules/<pkg>                     # is it actually installed?
node -e "…find the step in results.json…" # does the capture back the claim?
```

In the last run this demoted the only P0 in the report: the document viewer error
boundary was `pdf-renderer@^6.3.289` declared in `package.json:76` and absent from
`node_modules`. An environment artefact. A capable worker happened to catch it —
because it was capable, not because it was instructed. Put this in the brief:

> Before calling anything a product defect, check whether the cause is a
> declared-but-uninstalled dependency, a missing build artefact, or a
> dev-server-only overlay. If it is, report it as environment-blocked and move on.

Also verify the counts. In the same run, `validate-findings.mjs` reported 113
findings while a summary written 30 minutes earlier said 105 — a worker had
expanded its own file after the summary was generated. Derive every number in
the report from the merged file, never from an earlier count.

---

## CLUSTER — 10 minutes, and it is the actual product

```bash
node scripts/cluster.mjs "$RUN/findings" --clusters clusters.mjs
```

Three passes: seeded regex patterns (known systemic causes), shared `sourceHint`
file (catches root causes nobody seeded — a defect with no source line is
usually a guess, a defect with the same source line is usually the same cause),
then hot routes.

Reference run, measured: **113 findings → 19 groups, 88 clustered, 80%
compression.** The ten seeds explained 67 of them.

Then do the part no script does: **give every group a root cause and a one-line
fix.** That sentence — *"fixing seven causes removes more than a third of this
report"* — is the difference between a report someone reads and a report someone
dismisses.

---

## DELIVER

Report skeleton in `references/report-skeleton.md`. Verdict first. Always include
"What looks right" — a report that is only negative gets treated as an attack on
the codebase rather than as a list of work.

End with the re-run command. The next run should be one line.

---

## Failure recovery

| Symptom | Cause | Action |
|---|---|---|
| All screenshots blank, `textLength` 0 | dev server not up | restart it, re-run smoke before re-dispatching |
| Every capture times out | machine saturated | drop to 2 workers per wave |
| Worker stops mid-turn, no token movement | harness restart killed it | check whether it wrote its files; re-prompt with "capture is complete, analyse only" |
| `brokenMedia` non-zero everywhere | your fixture images | fix the fixture, never file findings |
| Agent reports the same error over and over | loop | interrupt, read the pane, change the approach in the prompt file |
| Worker wants to edit app code | brief too weak | reinforce the write-zone rule; if it happens twice, that worker is unusable |
| Findings file fails validation on evidence paths | step id renamed after capture | restore the id, do not re-run |