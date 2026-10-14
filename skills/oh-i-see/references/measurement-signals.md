# Measurement signals

Every signal the engine emits, what it means, and how it has been wrong.

The rule this file exists to enforce: **a measurement engine that has never been
shown to be wrong is an engine nobody understands.** Four of these shipped a
wrong answer silently during the reference run. Each entry records what it does,
what it cost, and how to prove it works on your project before trusting it.

## Where the data lives

Per capture, `evidence/<FLOW>/<step>/<viewport>/`:

| File | What |
|---|---|
| `view.png` | full-page shot, capped at `maxScreenshotHeight` |
| `view-vp.png` | viewport-only shot, always taken |

Per flow, `evidence/<FLOW>/results.json` — one entry per capture, holding
`measure`, `probe`, `focusAudit`, `shots`, `actions`, `console`, `pageErrors`,
`failedRequests`, `apiCalls`, `finalUrl`, and `smoke`.

---

## Signals that cost a wrong answer

### `lowContrast` — foreground alpha was ignored

**Was wrong.** Computed WCAG luminance on the raw `color` value and threw away
the alpha channel. `rgba(244, 241, 236, 0.35)` on near-black measured ~14:1 and
passed. That is the exact failure mode it exists to catch.

**Fix.** `resolvedBg()` walks ancestors for the nearest opaque background and
composites the stack; `flatten()` then composites the foreground over that
result before any luminance maths.

**Calibrate it.** Open one page you know has a low-contrast bug and confirm the
ratio you get matches what a contrast checker says for the same two colours.

### `noFocusRing` — needs real key presses, twice over

**Was wrong twice.** Three versions:

| Version | Method | Result |
|---|---|---|
| v1 | "is a Tailwind ring CSS variable set?" | **0 findings everywhere.** Tailwind's preflight sets `--tw-ring-shadow` on every element, so the test was always true. |
| v2 | diff computed style across a programmatic `el.focus()` | **Over-reports.** `:focus-visible` styles only match when focus arrived by keyboard, so a correct ring looked like no ring. Confirmed by pressing Tab and watching `matches(':focus-visible')` flip to `true`. |
| v3 | press real `Tab`, compare focused vs blurred fingerprint | Correct. |

**Where it lives.** `lib/focus-audit.mjs`, driven by the runner — *not* in
`measure.mjs`. It cannot run inside `page.evaluate`, because it needs real key
events. If you are tempted to add a focus signal back to the in-page engine,
read this table first.

**The trap that cost the most time.** `getPropertyValue` takes the **CSS** name.
`getPropertyValue('outlineStyle')` returns `""` with no error, so every value in
the fingerprint was empty and every comparison read "nothing changed" — which
looked exactly like a site with no focus styles anywhere. Convert to kebab-case
in one place (`CSS_PROPS`); do not hand-write it.

**Reading the output.** `visible: false` means no property changed on the
control *or any of its first three ancestors*. An ancestor changing counts,
because a `:focus-within` ring on a wrapper is a deliberate focus indicator and
must not be reported as a defect. `changedAtLevel` tells you which level moved:
`0` is the control itself, `1` is its wrapper.

**Calibrate it.** Tab through one page by hand and note which controls have a
visible ring. The audit should agree with you on every one.

### `smallTargets` — measured the bare input

**Was wrong.** Measured `<input>` directly: 22px tall, inside a 52px padded
wrapper. Five false positives per capture.

**Fix.** For bare form fields only, walk up three ancestors looking for one that
looks like a single control — a `label`, ≥12px total padding, a border, or a
background. Buttons and links are never absorbed into a padded ancestor,
because a button *is* its own tap target and inflating it would hide a real
defect.

**Calibrate it.** Confirm a bare `<input>` inside a padded wrapper reports the
wrapper's size, and that a genuinely 30px button still gets flagged.

### `clipped` — flagged `sr-only`

**Was wrong.** Every screen with a visually-hidden label produced a finding,
because those helpers are 1×1 by design.

**Fix.** `srOnly()` skips `.sr-only`, `.visually-hidden`, `clip: rect(0,0,0,0)`
and `clip-path: inset(100%)`. `text-overflow: ellipsis` with `white-space:
nowrap` is also skipped — deliberate truncation is a design decision, not a
fault. It *is* still worth flagging when the truncated string is the primary
label, so look at these by eye rather than dismissing the signal.

---

## Signals that behave

| Signal | What it reports | Trust |
|---|---|---|
| `overflow` | elements past the viewport edge, tagged with whether an ancestor scrolls | high — zero false positives across 193 reference captures |
| `hOverflow` | `documentElement.scrollWidth > clientWidth` | high — the one-page horizontal-scroll check |
| `brokenMedia` | images with `naturalWidth === 0`, iframes with no src, videos in network-error state | high, **but** non-zero across many captures means your fixture, not the app |
| `fonts` | every family/size/weight combination, by count | high |
| `offCanonFonts` | families that match no entry in `config.canon.fonts` | high — this is what turned 254 `Söhne` literals into 10 findings |
| `headings` | per-tag size and weight, so sibling drift is visible | high |
| `h1Count` / `h1Texts` | whether the page has a real heading, and what it says | high |
| `unlabelled` | buttons and links with no accessible name | high |
| `liveRegions` | `[role=alert]`, `[role=status]`, `[aria-live]` and whether visible | high — this is how you catch a 429 rendering the wrong message |
| `disabledControls` | native vs `aria-disabled`, plus opacity and `pointer-events` | medium — `aria-disabled` without styling is a judgment call |
| `positiveTabindex` | elements with `tabindex > 0`, which reorder the tab sequence | high — any hit is worth a look |
| `hScrollables` | scroll containers wider than the viewport | medium — sometimes intentional (a code block, a carousel) |
| `textLength` | total rendered characters | the blank-render check, and nothing more |

---

## Smoke gates

`capture.mjs` fails a capture when any of these fire. All five exist because
each one caught a lying harness before it could waste a worker.

| Gate | Catches |
|---|---|
| `textLength` below `minText` (default 40) | a dead route, a bad selector, a crash on boot |
| `brokenMedia.length > 0` | your fixture generating fake "broken media" findings |
| `expectApiCalls` set but none seen | the interceptor missed, or the page never fetches |
| `hOverflow` when `allowOverflow` is falsy | the responsive gate |
| `finalUrl` missing `expectUrl` | a redirect you did not know about |

**The `textLength` threshold is deliberately low.** The reference run's login
page measured **66 characters** in every state and was perfectly fine — a
sign-in form is genuinely sparse. An early version of this gate set 100 and
failed every auth capture. If you suspect a dead route, compare a step's
`textLength` against the same route's other steps rather than against a
constant.

---

## Screenshot caps

Uncapped full-page shots produced a **47MB** PNG on one long route, which is both
slow to open and unreadable to a human reviewing it.

`capture.mjs` caps at `maxScreenshotHeight` (default 6000) and always takes a
viewport-only shot alongside. When `shots.cappedAt` is set, the full-page file is
a copy of the viewport shot and `shots.docHeight` records the real page height —
so a reader is never misled about how much of the page they are looking at.

---

## Adding a signal

1. Add it to `measure.mjs` **only if** it can run inside `page.evaluate`. If it
   needs real input, it belongs in its own module driven by the runner, like
   `focus-audit.mjs`.
2. Compute it against a page where you already know the answer, in **both**
   directions — one case it must flag, one case it must not.
3. If it flags the same thing on every capture, it is measuring your fixture.
4. Record what it got wrong in this file, even if you fixed it before shipping.
   Entry 4 is the one people read.
