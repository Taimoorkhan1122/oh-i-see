# oh-i-see

An agent skill. It audits the user interface of a web application.

The skill drives a browser with Playwright. It walks the journeys that a user takes. It captures a screenshot of each state at each breakpoint. It measures contrast, focus rings, tap targets, overflow, and typography. It writes a report.

Each finding in the report names an openable screenshot. Each finding also names a number that a reader can compute again. The skill rejects a finding that has no evidence.

## Why this exists

Most UI reviews produce opinions. A reviewer reads a screenshot and writes "the form is too wide". The reader cannot check this. The skill produces a ticket instead:

> `.auth-form` at `src/styles/theme.css:412` has no `max-width`. At 1440px the field spans 1404px, against 380px on the sibling form.

The reference run produced 113 findings. Clustering reduced them to seven root causes. Forty-one findings were the same seven causes, seen from different angles. The seven causes are the work.

## Requirements

- Node.js 18 or later.
- Git.
- curl.
- dig.
- ripgrep (`rg`).
- A dev server for the application under audit.
- Network access.

The skill installs Playwright. You install the Chromium build once. See [Install](#install).

macOS, Linux, and Windows are supported.

## Install

```bash
git clone https://github.com/<owner>/oh-i-see.git
cd oh-i-see
npm install
npx playwright install chromium
```

The final command downloads about 100 MB. It runs once.

### Install the skill

Copy the skill directory to the skills folder of your agent.

```bash
cp -R skills/oh-i-see ~/.claude/skills/
```

The directory name and the `name` field in `SKILL.md` are the same string. The [Agent Skills specification](https://agentskills.io/specification) requires this match. Tools that load skills from a directory reject a mismatch.

Agents that read skills from a repository can use the repository URL instead:

```bash
npx skills add Taimoorkhan1122/oh-i-see
```

### Verify the install

```bash
node skills/oh-i-see/scripts/lib/check-browser.mjs
```

The command prints `✓ chromium available` when the install is correct.

## Quick start

Run the following commands against a running dev server. Replace `<repo>` and `<port>` with your values. Set `<zone>` to a folder for run output.

```bash
SKILL=skills/oh-i-see

node $SKILL/scripts/probe-stack.mjs --cwd <repo> --port <port> --write-zone <zone>
```

The probe prints the framework, the routes, the Playwright status, and the API ladder. It exits with code 1 if a blocker exists. Do not continue when it fails.

Copy the example files into the write zone, then edit them.

```bash
cp $SKILL/assets/project.config.example.json <zone>/project.config.json
cp $SKILL/assets/flows.example.mjs          <zone>/flows.mjs
```

Write the flows. Read `assets/flows.example.mjs` for the step spec. Choose the journeys from your route table, not from product documentation.

Run the smoke test. Never skip this step.

```bash
node $SKILL/scripts/capture.mjs all --smoke --config <zone>/project.config.json --zone <zone>
```

The smoke test captures two steps. It checks the render, the overflow, the media, and the redirect. Fix every gate failure before you continue.

Generate the worker briefs.

```bash
node $SKILL/scripts/templates.mjs --config <zone>/project.config.json --out <zone> --flows <zone>/flows.mjs
```

This writes `<zone>/BRIEF.md` and one prompt file per flow. Send each worker a one-line prompt that names the file for that worker. Multi-line prompts can fail silently in some harnesses.

Validate, merge, and cluster.

```bash
node $SKILL/scripts/validate-findings.mjs <zone>/findings --root <zone>
node $SKILL/scripts/merge.mjs             <zone>/findings --root <zone>
node $SKILL/scripts/cluster.mjs           <zone>/findings --clusters clusters.mjs
```

Then write the report. Use `references/report-skeleton.md` as the template.

## The phases

| Phase | Purpose | Gate |
|---|---|---|
| Probe | Detect the stack and the API ladder | No blockers |
| Scaffold | Write the config and the flows | Canon block is filled in |
| Smoke | Prove the harness is honest | No gate failures |
| Fan out | One worker per flow | Every step captured |
| Collect | Validate the evidence | Zero errors |
| Verify | Check the severe findings | Each P0 survives |
| Cluster | Group the findings into causes | Each group has a fix |
| Deliver | Write the report | Verdict is first |

Read `skills/oh-i-see/references/workflow.md` for the full runbook.

## Configuration

`project.config.json` holds the run parameters.

| Field | Purpose |
|---|---|
| `baseUrl` | Root URL of the running application |
| `writeZone` | The only folder the audit writes to |
| `auditPaths` | Paths the audit must not change |
| `api` | Backend host, kind, and reachability |
| `canon` | The design rules the project already states |
| `viewports` | Breakpoints to capture |
| `severity` | The rubric for P0 through P4 |

### The canon block

This block is the most important part of the file.

The canon states the fonts, the accent colour, the background, and the colours that the project forbids. The measured pixels then disagree with the canon. The disagreement is the finding.

A project without a written canon produces layout findings only.

### The write zone

The audit is read-only. The write zone is its only output folder.

The skill asks Git whether the zone is ignored. If the zone is not ignored, the probe prints the line to add to `.git/info/exclude`. This keeps the output out of history without changing `.gitignore`.

## Output

```text
<zone>/
  evidence/
    <FLOW>/
      <step-id>/<viewport>/view.png       full-page capture
      <step-id>/<viewport>/view-vp.png    viewport capture
      results.json                       measurements and runtime state
    capture-run.json                     gate failures and totals
  findings/
    <FLOW>.json                          the machine-readable findings
    <FLOW>.md                            the short human report
  all-findings.json                      the merged set
```

Step IDs are folder names. A finding cites them as evidence paths. Treat a step ID as permanent. Renaming one orphans the screenshots and breaks the findings that cite them.

## Backend adapters

The skill ships three adapters. The `api.kind` field selects one.

| Adapter | Behaviour |
|---|---|
| `supabase` | Emulates GoTrue and PostgREST in flight |
| `passthrough` | Uses the real backend |

On the Supabase adapter, the `authOutcome` step field forces a real error response. Supported values are `invalid_credentials`, `email_exists`, `weak_password`, `rate_limit`, and `server_error`. This is how you surface a defect such as a 429 page that shows the message "Incorrect email or password".

### The API ladder

The probe decides which rung the run is on.

| Ladder | Condition | Effect |
|---|---|---|
| 1 | The API answers | Real auth and real data |
| 2 | The API rejects anonymous requests | The run adds a bypass header |
| 3 | The host does not resolve | The run emulates the backend |

On ladder three, row data is synthetic. The report header must say so. Findings that depend on row content are marked `fixtureInduced`. The validator rejects a `fixtureInduced` finding at P0 or P1.

## Troubleshooting

| Symptom | Cause | Action |
|---|---|---|
| `Playwright not found` | No install | Run `npm install` in the repository root |
| `Chromium is missing` | No browser build | Run `npx playwright install chromium` |
| Every screenshot is blank | The dev server is down | Start it, then run the smoke test again |
| Captures time out | The machine is saturated | Reduce the workers per wave to two |
| `brokenMedia` is not zero | Your fixture images | Fix the fixture. Do not file findings |
| The evidence path does not resolve | A step ID changed after the capture | Restore the ID. Do not re-capture |
| The write zone is not ignored | The zone is not in Git's exclude list | Add the line that the probe prints |

## Validation

The reference library validates the skill metadata and the naming rules.

```bash
npx skills-ref validate ./skills/oh-i-see
```

## License

MIT. See [LICENSE](LICENSE).
