/**
 * measure.mjs — the in-page measurement engine.
 *
 * This module is passed to `page.evaluate`, so it must be a single
 * self-contained function expression with no imports and no closure over
 * anything. `export const MEASURE = () => { ... }` is serialised by
 * Playwright and re-parsed in the browser.
 *
 * Every signal here has a calibration story. Two of them shipped a wrong
 * answer silently during the reference run and are fixed here; both failures
 * are documented inline, because a measurement engine that has never been shown
 * to be wrong is an engine nobody understands.
 */

export const MEASURE = () => {
  const de = document.documentElement;
  const vw = de.clientWidth;
  const vh = de.clientHeight;
  const cfg = (window.__UI_AUDIT__ || {});

  // ── helpers ───────────────────────────────────────────────────────────
  /** A short, copy-pasteable path to an element. Depth-capped so it stays readable. */
  const sel = (el) => {
    const parts = [];
    let n = el;
    let depth = 0;
    while (n && n.nodeType === 1 && depth < 4) {
      let s = n.tagName.toLowerCase();
      if (n.id) { parts.push(`#${n.id}`); break; }
      const cls = (typeof n.className === 'string' ? n.className : '')
        .trim().split(/\s+/).filter(Boolean).slice(0, 2).join('.');
      if (cls) s += `.${cls}`;
      const testid = n.getAttribute('data-testid');
      if (testid) { parts.push(`${s}[data-testid=${testid}]`); break; }
      parts.push(s);
      n = n.parentElement;
      depth += 1;
    }
    return parts.join(' > ');
  };

  const cs = (el) => getComputedStyle(el);
  const round = (n) => Math.round(n);

  const visible = (el) => {
    const s = cs(el);
    if (s.display === 'none' || s.visibility === 'hidden' || parseFloat(s.opacity) === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };

  const text = (el, n = 60) =>
    ((el.textContent || el.innerText || el.value || el.getAttribute?.('aria-label') || '') || '')
      .replace(/\s+/g, ' ').trim().slice(0, n);

  const all = Array.from(document.querySelectorAll('body *'));
  const INTERACTIVE =
    'a[href], button, input:not([type="hidden"]), select, textarea, ' +
    '[role="button"], [role="tab"], [role="menuitem"], [onclick], summary';

  // ── colour maths ──────────────────────────────────────────────────────
  const parseColor = (c) => {
    if (!c) return null;
    const m = c.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const p = m[1].split(/[,/]/).map((x) => parseFloat(x));
    if (p.length < 3 || p.some((n) => Number.isNaN(n))) return null;
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 && !Number.isNaN(p[3]) ? p[3] : 1 };
  };

  /**
   * Nearest ancestor background that is actually opaque enough to read text on.
   * Returns the composited colour so callers never have to think about alpha.
   */
  const resolvedBg = (el) => {
    const layers = [];
    let n = el;
    while (n && n.nodeType === 1) {
      const c = parseColor(cs(n).backgroundColor);
      if (c && c.a > 0) layers.push(c);
      if (c && c.a >= 0.999) break;
      n = n.parentElement;
    }
    const root = parseColor(cs(de).backgroundColor);
    if (root && root.a > 0) layers.push(root);
    if (!layers.length) return { r: 255, g: 255, b: 255, a: 1 };

    // Composite from the bottom up: the last opaque layer is the base.
    let out = layers[layers.length - 1];
    for (let i = layers.length - 2; i >= 0; i -= 1) {
      const top = layers[i];
      out = {
        r: top.r * top.a + out.r * (1 - top.a),
        g: top.g * top.a + out.g * (1 - top.a),
        b: top.b * top.a + out.b * (1 - top.a),
        a: 1,
      };
    }
    return out;
  };

  /** Composite a possibly-translucent foreground over its background. */
  const flatten = (fg, bg) => {
    if (fg.a >= 0.999) return { r: fg.r, g: fg.g, b: fg.b };
    return {
      r: fg.r * fg.a + bg.r * (1 - fg.a),
      g: fg.g * fg.a + bg.g * (1 - fg.a),
      b: fg.b * fg.a + bg.b * (1 - fg.a),
    };
  };

  const lum = ({ r, g, b }) => {
    const f = (v) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };

  const contrast = (a, b) => {
    const L1 = lum(a), L2 = lum(b);
    return (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
  };

  const rgbStr = ({ r, g, b }) => `rgb(${round(r)}, ${round(g)}, ${round(b)})`;

  const srOnly = (el) =>
    !!el.closest('.sr-only, .visually-hidden') ||
    cs(el).clip === 'rect(0px, 0px, 0px, 0px)' ||
    cs(el).clipPath === 'inset(100%)';

  // ── 1. horizontal overflow ────────────────────────────────────────────
  const overflow = [];
  for (const el of all) {
    if (!visible(el) || srOnly(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.right <= vw + 1 && r.left >= -1) continue;
    let p = el, inScroller = false;
    while (p && p !== document.body) {
      const pcs = cs(p);
      if (pcs.overflowX === 'auto' || pcs.overflowX === 'scroll') { inScroller = true; break; }
      p = p.parentElement;
    }
    overflow.push({
      selector: sel(el),
      left: round(r.left), right: round(r.right), width: round(r.width),
      position: cs(el).position,
      text: text(el),
      insideScroller: inScroller,
    });
  }

  // ── 2. clipped text ───────────────────────────────────────────────────
  // reference bug: every screen with an .sr-only label produced a finding.
  // Those helpers are 1x1 by design and are now skipped above via srOnly().
  const clipped = [];
  for (const el of all) {
    if (!visible(el) || srOnly(el)) continue;
    if (el.children.length > 0 && !text(el, 1)) continue;
    const s = cs(el);
    const dy = el.scrollHeight - el.clientHeight;
    const dx = el.scrollWidth - el.clientWidth;
    if (el.clientHeight === 0 || el.clientWidth === 0) continue;
    const clipsY = s.overflowY === 'hidden' || s.overflowY === 'clip';
    const clipsX = s.overflowX === 'hidden' || s.overflowX === 'clip';
    const scrollsY = s.overflowY === 'auto' || s.overflowY === 'scroll';
    const scrollsX = s.overflowX === 'auto' || s.overflowX === 'scroll';
    const byY = clipsY && !scrollsY && dy > 2;
    const byX = clipsX && !scrollsX && dx > 2;
    // `nowrap` + ellipsis is a deliberate truncation, not a fault.
    const deliberateEllipsis = byX && s.textOverflow === 'ellipsis' && s.whiteSpace === 'nowrap';
    if ((byY || (byX && !deliberateEllipsis))) {
      clipped.push({
        selector: sel(el),
        overflow: `${s.overflowX}/${s.overflowY}`,
        dx, dy,
        clientW: el.clientWidth, clientH: el.clientHeight,
        scrollW: el.scrollWidth, scrollH: el.scrollHeight,
        lineHeight: s.lineHeight,
        text: text(el, 80),
      });
    }
  }

  // ── 3. tap targets ────────────────────────────────────────────────────
  // reference bug: measured the bare <input> (22px tall inside a 52px padded
  // wrapper) and produced five false positives per capture. Bare form fields
  // are styled by their wrapper, so we walk up for one. Buttons and links are
  // their own tap target and are never absorbed into a padded ancestor.
  const effectiveBox = (el) => {
    const own = el.getBoundingClientRect();
    const bareField = ['INPUT', 'SELECT', 'TEXTAREA'].includes(el.tagName);
    if (!bareField) return own;
    let n = el.parentElement;
    let depth = 0;
    while (n && n !== document.body && depth < 3) {
      const s = cs(n);
      const pad =
        parseFloat(s.paddingTop) + parseFloat(s.paddingBottom) +
        parseFloat(s.paddingLeft) + parseFloat(s.paddingRight);
      const r = n.getBoundingClientRect();
      const looksLikeOneControl =
        n.matches('label') || pad >= 12 ||
        s.borderTopWidth !== '0px' ||
        (s.backgroundColor !== 'rgba(0, 0, 0, 0)' && s.backgroundColor !== 'transparent');
      if (looksLikeOneControl && r.width > 0 && r.height > 0 && r.width <= own.width * 1.35) return r;
      n = n.parentElement;
      depth += 1;
    }
    return own;
  };

  const MIN_TARGET = cfg.minTapTarget || 44;
  const smallTargets = [];
  for (const el of Array.from(document.querySelectorAll(INTERACTIVE))) {
    if (!visible(el) || srOnly(el)) continue;
    const own = el.getBoundingClientRect();
    if (own.width === 0 || own.height === 0) continue;
    const r = effectiveBox(el);
    if (r.width < MIN_TARGET || r.height < MIN_TARGET) {
      smallTargets.push({
        selector: sel(el),
        w: round(r.width), h: round(r.height),
        ownW: round(own.width), ownH: round(own.height),
        tag: el.tagName.toLowerCase(),
        text: text(el, 40),
      });
    }
  }

  // ── 4. broken media ───────────────────────────────────────────────────
  // If this is non-zero across many captures, suspect your own fixture.
  const brokenMedia = [];
  for (const el of Array.from(document.querySelectorAll('img, video, source, iframe'))) {
    const r = el.getBoundingClientRect();
    const hasBox = r.width > 0 && r.height > 0;
    if (el.tagName === 'IMG' && (!el.complete || el.naturalWidth === 0)) {
      brokenMedia.push({ selector: sel(el), src: (el.currentSrc || el.src || '').slice(0, 160), hasBox, alt: el.alt });
    } else if (el.tagName === 'IFRAME' && !el.src) {
      brokenMedia.push({ selector: sel(el), src: '', hasBox });
    } else if (el.tagName === 'VIDEO' && el.networkState === 3 && hasBox) {
      brokenMedia.push({ selector: sel(el), src: (el.currentSrc || '').slice(0, 160), hasBox, kind: 'video-network-error' });
    }
  }

  // ── 5. typography inventory ───────────────────────────────────────────
  const fonts = {};
  const headingScale = {};
  const textNodes = all.filter((el) => {
    if (!visible(el) || srOnly(el)) return false;
    return Array.from(el.childNodes).some((n) => n.nodeType === 3 && (n.textContent || '').trim());
  });

  for (const el of textNodes) {
    const s = cs(el);
    const fam = s.fontFamily.split(',')[0].replace(/["']/g, '').trim();
    const key = `${fam} @ ${s.fontSize}/${s.lineHeight} w${s.fontWeight}`;
    fonts[key] = (fonts[key] || 0) + 1;
  }
  const canonFamilies = cfg.canonFonts || [];
  const offCanon = new Set();
  for (const el of textNodes) {
    const fam = cs(el).fontFamily.split(',')[0].replace(/["']/g, '').trim();
    if (fam && !canonFamilies.some((c) => fam.toLowerCase().includes(String(c).toLowerCase().split(' ')[0]))) {
      offCanon.add(fam);
    }
  }

  for (const tag of ['h1', 'h2', 'h3', 'h4', 'h5', 'h6']) {
    for (const el of Array.from(document.querySelectorAll(tag))) {
      if (!visible(el)) continue;
      const s = cs(el);
      const k = `${tag}: ${s.fontSize} / ${s.lineHeight} w${s.fontWeight} ${s.fontFamily.split(',')[0].replace(/["']/g, '').trim()}`;
      headingScale[k] = (headingScale[k] || 0) + 1;
    }
  }

  // ── 6. contrast ───────────────────────────────────────────────────────
  // reference bug: computed luminance on the raw foreground colour and
  // ignored alpha, so rgba(244,241,236,0.35) on near-black measured 14:1 and
  // passed. Fixed: flatten the foreground over its resolved background first.
  const lowContrast = [];
  const seenPairs = new Set();
  for (const el of textNodes.slice(0, 800)) {
    const s = cs(el);
    const fgRaw = parseColor(s.color);
    if (!fgRaw) continue;
    const bg = resolvedBg(el);
    const fg = flatten(fgRaw, bg);
    const ratio = contrast(fg, bg);
    const px = parseFloat(s.fontSize);
    const weight = parseInt(s.fontWeight, 10) || 400;
    const isLarge = px >= 24 || (px >= 18.66 && weight >= 700);
    const required = isLarge ? 3 : 4.5;
    if (ratio >= required) continue;
    const key = `${s.color}|${s.fontSize}|w${s.fontWeight}`;
    if (seenPairs.has(key)) continue;
    seenPairs.add(key);
    lowContrast.push({
      selector: sel(el),
      declaredColor: s.color,
      effectiveColor: rgbStr(fg),
      bg: rgbStr(bg),
      fontSize: s.fontSize, weight: s.fontWeight,
      ratio: Math.round(ratio * 100) / 100,
      required,
      text: text(el, 50),
    });
  }

  // ── 7. focus visibility — NOT measured here ───────────────────────────
  // Focus cannot be audited from inside a page.evaluate: it needs real key
  // presses, because `:focus-visible` only matches when focus arrived by
  // keyboard. See lib/focus-audit.mjs, which the runner calls instead.
  // Reference history, kept because the temptation to re-add it is high:
  //   v1 — "does a Tailwind ring var exist"  → 0 findings everywhere (useless)
  //   v2 — diff style across `el.focus()`   → over-reports, misses :focus-visible

  // ── 8. full-width scrollers wider than the viewport ───────────────────
  const hScrollables = [];
  for (const el of all) {
    if (!visible(el)) continue;
    const s = cs(el);
    if (s.overflowX !== 'auto' && s.overflowX !== 'scroll') continue;
    const r = el.getBoundingClientRect();
    if (r.width > vw + 1) {
      hScrollables.push({ selector: sel(el), width: round(r.width), vw, scrollW: el.scrollWidth });
    }
  }

  // ── 9. semantics ──────────────────────────────────────────────────────
  const unlabelled = [];
  for (const el of Array.from(document.querySelectorAll('button, a[href], [role="button"]'))) {
    if (!visible(el)) continue;
    const name = text(el, 40) || el.getAttribute('aria-label') || el.getAttribute('title');
    if (!name) unlabelled.push({ selector: sel(el), tag: el.tagName.toLowerCase() });
  }

  return {
    url: location.href,
    title: document.title,
    vw, vh,
    docScrollW: de.scrollWidth,
    docScrollH: de.scrollHeight,
    hOverflow: de.scrollWidth > vw + 1,
    bodyBg: cs(document.body).backgroundColor,
    htmlBg: cs(de).backgroundColor,

    textLength: (document.body.innerText || '').replace(/\s+/g, ' ').trim().length,
    elementCount: all.length,

    h1Count: document.querySelectorAll('h1').length,
    h1Texts: Array.from(document.querySelectorAll('h1')).map((h) => text(h, 90)),
    headingScale,

    overflow: overflow.slice(0, 40), overflowTotal: overflow.length,
    clipped: clipped.slice(0, 40), clippedTotal: clipped.length,
    smallTargets: smallTargets.slice(0, 40), smallTargetsTotal: smallTargets.length,
    brokenMedia,
    fonts: Object.entries(fonts).sort((a, b) => b[1] - a[1]).slice(0, 30),
    offCanonFonts: [...offCanon],
    lowContrast: lowContrast.slice(0, 30), lowContrastTotal: lowContrast.length,
    unlabelled: unlabelled.slice(0, 20), unlabelledTotal: unlabelled.length,
    hScrollables: hScrollables.slice(0, 10),
  };
};

/**
 * A second, cheap in-page probe run after actions that interact.
 * Reports the things that only exist once something has happened: live regions,
 * disabled-looking-but-enabled controls, validation messages, and the focus
 * order. Kept separate from MEASURE so the expensive pass runs once.
 */
export const PROBE = () => {
  const de = document.documentElement;
  const live = Array.from(document.querySelectorAll('[role="alert"], [role="status"], [aria-live]'))
    .map((el) => ({
      selector: el.tagName.toLowerCase() + (el.className ? `.${String(el.className).split(/\s+/)[0]}` : ''),
      role: el.getAttribute('role'),
      ariaLive: el.getAttribute('aria-live'),
      text: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80),
      visible: !!(el.getBoundingClientRect().width && el.getBoundingClientRect().height),
    }));

  const focusables = Array.from(
    document.querySelectorAll('a[href], button, input:not([type="hidden"]), select, textarea, [tabindex]'),
  ).filter((el) => !el.disabled && el.getBoundingClientRect().width > 0);
  const positiveTabindex = focusables.filter((el) => parseInt(el.getAttribute('tabindex') || '0', 10) > 0);

  const disabled = Array.from(document.querySelectorAll('button, [role="button"], a[aria-disabled="true"]'))
    .map((el) => {
      const s = getComputedStyle(el);
      return {
        selector: el.tagName.toLowerCase() + (el.className ? `.${String(el.className).split(/\s+/)[0]}` : ''),
        ariaDisabled: el.getAttribute('aria-disabled'),
        native: el.disabled === true,
        opacity: s.opacity,
        pointerEvents: s.pointerEvents,
        text: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 50),
      };
    })
    .filter((d) => d.native || d.ariaDisabled === 'true');

  return {
    url: location.href,
    liveRegions: live,
    liveRegionTotal: live.length,
    focusableCount: focusables.length,
    positiveTabindex: positiveTabindex.map((el) => el.tagName.toLowerCase() + ':' + (el.textContent || '').trim().slice(0, 30)),
    disabledControls: disabled.slice(0, 25),
    disabledTotal: disabled.length,
    hasMain: !!document.querySelector('main, [role="main"]'),
    hasNav: !!document.querySelector('nav, [role="navigation"]'),
    lang: de.lang || '(none)',
  };
};
