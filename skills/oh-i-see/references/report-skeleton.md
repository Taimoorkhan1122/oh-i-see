# Report skeleton

Fill this in. Every number comes from `merge.mjs` and `cluster.mjs` — quote them,
do not recount by hand. On the reference run a hand-written count said 105 when
the files held 113, because a worker had expanded its own file after the summary
was generated.

The ordering below is deliberate: **verdict first, evidence second, method last.**
Most readers stop after the verdict, and they should still have gotten what they
needed.

---

```markdown
# Visual regression — <project> — <date>

**Verdict:** <two sentences. What is broken, what is solid, what to fix first.>
**Coverage:** <N> flows · <N> captures · <N> screenshots · <N> findings
**Severity:** P0 <n> · P1 <n> · P2 <n> · P3 <n> · P4 <n>
**Backend:** <real | emulated in-flight — see Limitations>

---

## 1. Fix these first

<Tier 1: the handful of items where one change clears many findings.
Each row: the change, how many findings it clears, and the source line.>

| # | Change | Clears | Where |
|---|--------|--------|-------|
| 1 | <one line> | <n> findings | <file:line> |

<Then, for the top three, a short paragraph each: what the cause is, why the
fix is what it is, and what to check after shipping.>

## 2. What was real

<The paragraph from references/evidence-discipline.md. Say which surfaces were
genuinely captured against the running application.>

## 3. What was synthetic

<Same file. If the backend was emulated or unreachable, this paragraph is not
optional. State the mechanism, the consequence, and the rule you applied.>

## 4. Findings by severity

| Sev | Count | Where |
|-----|-------|-------|
| P0 | <n> | <route> |
| P1 | <n> | <route> |

## 5. Systemic causes

<N findings collapse into <M> root causes. Show the grouping.>

| Cause | Findings | One-line fix |
|-------|----------|--------------|
| <name> | <n> | <fix> |

```
<ASCII or Mermaid diagram of how the causes connect to surfaces.>

## 6. Per-flow detail

### <F1 — name>
**<n> findings** (<severity breakdown>), <n> captures

| id | sev | route | finding | evidence |
|----|-----|-------|---------|----------|

## 7. What looks right

<3-8 bullets you verified and found sound. This section is not padding: a report
that is only negative gets read as an attack on the codebase rather than as a
list of work, and the things you checked and cleared are evidence that the rest
of the report was looked at properly.>

## 8. Blocked and not verified

<Routes you could not capture, why, and the exact command to finish them.>

## 9. Limitations

<Environment issues that are not product defects. The reference run's only P0
belonged here: a package declared in package.json and absent from node_modules.
One false P0 costs more credibility than ten true P4s earn.>

## 10. Re-run

```bash
node scripts/probe-stack.mjs --write-zone <zone>
node scripts/capture.mjs all
node scripts/validate-findings.mjs <zone>/findings --root <zone>
node scripts/merge.mjs <zone>/findings --root <zone>
node scripts/cluster.mjs <zone>/findings --clusters clusters.mjs
```

The next run should be one command.
```

---

## Rules for the prose

**Lead with the verdict.** Not the methodology, not the tooling, not the flow
list. What is broken, what is solid, what to do first.

**Rank by impact on the journey, not by how easy a finding is to describe.** A
one-line summary can be a P1 or a P4; only the flow context decides.

**Always include "What looks right."** See above.

**One-line fixes, not remediation plans.** The report's job is to make the queue
obvious. Implementation is a separate conversation.

**Say what you did not check.** Section 8 and section 9 are what make sections 1
through 7 trustworthy. A report that never mentions its own blind spots invites
the reader to assume they are worse than they are.

## Tiering after clustering

Clustering changes the shape of the report, so re-rank once at the end:

- A cluster with a **single fix that clears several findings** is Tier 1, even
  when the individual findings were P3s. Nineteen findings explained by one
  missing token outranks nineteen separate P3s in a queue.
- A finding that exists only because of the local environment leaves the severity
  table entirely and goes in Limitations.
- A route with three findings and no shared cause is a **neglected screen**. Say
  so, because it is a different piece of work from a shared CSS bug.

## What the report may assert

**Allowed**, because a capture backs it:

> On `/classes/example/lessons/1` at 390px, `h4.lesson-card__title`
> computes to `rgb(19,19,17)` on `rgb(0,0,0)` — ratio 1.13. See
> `evidence/F6/f6-lesson-1/mobile/view.png`.

**Not allowed**, because nothing backs it:

> The lesson player feels unfinished.

**Required**, because an unstated limitation reads as a defect:

> `pdf-renderer` is declared in `package.json:76` and absent from `node_modules` on
> this machine. `/library/viewer` was therefore not audited. Run
> `npm install` and re-run flow F7.
