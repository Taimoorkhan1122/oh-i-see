/**
 * focus-audit.mjs — walk the real tab order and see whether focus is visible.
 *
 * This lives outside the in-page engine on purpose. It has to press real keys.
 *
 * Two iterations during development:
 *   v1 checked whether a Tailwind ring CSS variable was set. Tailwind's
 *      preflight sets it on every element, so the signal read 0 findings on a
 *      page where every input genuinely has `outline: 0`.
 *   v2 diffed computed style across a programmatic `el.focus()`. That over-
 *      reports: `:focus-visible` styles only match when focus arrived by
 *      keyboard, so a correct `:focus-visible` ring looks like no ring at all.
 *      Verified by pressing Tab and watching `matches(':focus-visible')` flip.
 *   v3 (this) presses Tab for real and reads the style that a keyboard user
 *      actually gets.
 *
 * What counts as visible: any change in outline, box-shadow, border colour,
 * background, colour or text-decoration across the focused element or its
 * first three ancestors. Ancestors matter because `:focus-within` on a wrapper
 * is a legitimate and common way to style focus, and a check that only looks
 * at the control itself will miss it — or, worse, call it a defect.
 */

/**
 * Style properties the focus fingerprint watches, in camelCase for readability.
 *
 * IMPORTANT: getPropertyValue takes the CSS name, which is kebab-case.
 * Reading `getPropertyValue('outlineStyle')` returns an empty string with no
 * error, so a whole audit silently reports "nothing ever changes". Convert once
 * here rather than hand-writing kebab-case and getting it wrong later.
 */
export const DEFAULT_PROPS = [
  'outlineStyle', 'outlineWidth', 'outlineColor', 'outlineOffset',
  'boxShadow', 'borderColor', 'backgroundColor', 'color', 'textDecorationLine',
];

export const CSS_PROPS = DEFAULT_PROPS.map((p) => p.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`));

/**
 * @param {import('playwright').Page} page
 * @param {object} opts
 *   maxStops      how many Tab presses before giving up (default 40)
 *   maxDepth      ancestors to include in the fingerprint (default 4)
 *   pauseMs       settle time after each press (default 70)
 * @returns {Promise<object>}
 */
export async function auditFocusOrder(page, opts = {}) {
  const { maxStops = 40, maxDepth = 4, pauseMs = 70 } = opts;

  // Establish a known-unfocused baseline from the element itself.
  const readState = () =>
    page.evaluate(({ depth, props }) => {
      const el = document.activeElement;
      if (!el || el === document.body || el === document.documentElement) return null;

      const chain = [];
      let n = el;
      for (let i = 0; i < depth && n && n.nodeType === 1; i += 1) {
        const s = getComputedStyle(n);
        chain.push(props.map((p) => s.getPropertyValue(p)).join('|'));
        n = n.parentElement;
      }

      const s = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return {
        tag: el.tagName.toLowerCase(),
        cls: typeof el.className === 'string' ? el.className.trim().split(/\s+/).filter(Boolean).slice(0, 2) : [],
        id: el.id || '',
        text: (el.textContent || el.value || el.getAttribute('aria-label') || el.getAttribute('placeholder') || '')
          .replace(/\s+/g, ' ').trim().slice(0, 40),
        // Chromium UA default focus ring when nothing is authored.
        outline: `${s.outlineStyle} ${s.outlineWidth} ${s.outlineColor}`,
        boxShadow: s.boxShadow.slice(0, 120),
        chain,
        matchesFocusVisible: (() => { try { return el.matches(':focus-visible'); } catch { return false; } })(),
        inViewport: r.top >= -2 && r.bottom <= window.innerHeight + 2,
        w: Math.round(r.width),
        h: Math.round(r.height),
      };
    }, { depth: maxDepth, props: CSS_PROPS });

  // Baseline: unfocused fingerprint per stop is what we compare against, so we
  // re-read the same element after blurring it.
  const stops = [];
  const seen = new Set();
  let repeats = 0;

  for (let i = 0; i < maxStops; i += 1) {
    await page.keyboard.press('Tab');
    await page.waitForTimeout(pauseMs);

    const state = await readState();
    if (!state) { stops.push({ index: i, empty: true }); continue; }

    const key = `${state.tag}|${state.cls.join('.')}|${state.id}|${state.text}`;
    if (seen.has(key)) {
      repeats += 1;
      if (repeats > 3) break; // wrapped around the document
      continue;
    }
    seen.add(key);

    // Compare against the same element's unfocused fingerprint. A temporary
    // attribute is the reliable way to hold the reference across the blur.
    const focusedChain = state.chain;
    await page.evaluate(() => {
      const el = document.activeElement;
      if (el) el.setAttribute('data-ui-audit-stop', '1');
    });
    await page.evaluate(() => {
      const el = document.activeElement;
      if (el) el.setAttribute('data-ui-audit-stop', '1');
    });
    await page.evaluate(() => document.querySelector('[data-ui-audit-stop="1"]')?.blur());
    await page.waitForTimeout(40);
    const unfocusedChain = await page.evaluate(({ depth, props }) => {
      const el = document.querySelector('[data-ui-audit-stop="1"]');
      if (!el) return null;
      const chain = [];
      let n = el;
      for (let i = 0; i < depth && n && n.nodeType === 1; i += 1) {
        const s = getComputedStyle(n);
        chain.push(props.map((p) => s.getPropertyValue(p)).join('|'));
        n = n.parentElement;
      }
      return chain;
    }, { depth: maxDepth, props: CSS_PROPS });

    await page.evaluate(() => document.querySelector('[data-ui-audit-stop="1"]')?.removeAttribute('data-ui-audit-stop'));

    // Visible when ANY level of the chain differs between focused and blurred.
    // An ancestor changing counts: a :focus-within ring on a wrapper is a real,
    // deliberate focus indicator and must not be reported as a defect.
    const changed = !!unfocusedChain?.some((v, idx) => v !== focusedChain[idx]);
    stops.push({
      index: i,
      selector: [state.tag, state.cls.join('.')].filter(Boolean).join('.'),
      text: state.text,
      w: state.w,
      h: state.h,
      inViewport: state.inViewport,
      matchesFocusVisible: state.matchesFocusVisible,
      outline: state.outline,
      boxShadow: state.boxShadow,
      visible: changed,
      changedAtLevel: unfocusedChain
        ? unfocusedChain.findIndex((v, idx) => v !== focusedChain[idx])
        : -1,
    });
  }

  const noIndicator = stops.filter((s) => !s.empty && s.visible === false);
  const offscreen = stops.filter((s) => !s.empty && s.inViewport === false);
  const undersized = stops.filter((s) => !s.empty && (s.w < 44 || s.h < 44));

  return {
    stopsTested: stops.filter((s) => !s.empty).length,
    emptyStops: stops.filter((s) => s.empty).length,
    noIndicatorTotal: noIndicator.length,
    noIndicator: noIndicator.slice(0, 25),
    offscreenTotal: offscreen.length,
    offscreen: offscreen.slice(0, 15),
    undersizedTotal: undersized.length,
    undersized: undersized.slice(0, 20),
    stops: stops.filter((s) => !s.empty).slice(0, 60),
  };
}
