/**
 * clusters.mjs — project-specific cluster seeds.
 *
 * Write this AFTER the first run of a project, by reading the findings that
 * the source-file pass grouped together. Each seed is a known systemic cause
 * you expect to see again. Delete any that never match.
 *
 *   match     regex, tested against summary + expected + observed (lowercased)
 *   minHits   below this the seed is ignored, so a one-off does not become a "cluster"
 *   rootCause what one change actually is
 *   oneLineFix the edit, in one line
 */
export default [
  {
    id: 'S1-accent-as-body-text',
    name: 'Accent colour used as body text',
    match: 'oxblood|accent.{0,20}(text|contrast)|#B3532E',
    minHits: 2,
    rootCause: 'The accent hex is a surface colour, applied as a foreground colour on the dark shell.',
    oneLineFix: 'Add an accessible accent-text token (>= 4.5:1 on the dark background) and route accent microcopy through it.',
  },
  {
    id: 'S2-font-canon-not-shipped',
    name: 'Canon fonts not the fonts that render',
    match: 'sohne\|söhne|font canon|canonical? font|inter never',
    minHits: 2,
    rootCause: 'Inline fontFamily literals bypass the design tokens, so the canon fonts never reach the screen.',
    oneLineFix: 'Replace the literal declarations with the font tokens; add a lint rule that rejects raw fontFamily strings.',
  },
  {
    id: 'S3-shell-pure-black',
    name: 'Pure black where the canon specifies near-black',
    match: '#000000|pure #000|pure black',
    minHits: 2,
    rootCause: 'The shell paints pure black before the page wrapper paints the canon colour; any gap shows pure black.',
    oneLineFix: 'Set the shell background to the canon colour, not pure black.',
  },
  {
    id: 'S4-focus-ring-removed',
    name: 'Focus indicator removed',
    match: 'no focus indicator|focus ring|outline: 0|keyboard user cannot',
    minHits: 1,
    rootCause: 'outline: 0 on the control with no replacement focus style on any ancestor.',
    oneLineFix: 'Add a :focus / :focus-visible style. Do not remove the outline without a replacement.',
  },
  {
    id: 'S5-auth-form-unconstrained',
    name: 'Form with no max-width',
    match: 'no max-width|edge-to-edge|maxwidth',
    minHits: 2,
    rootCause: 'The form container has padding but no max-width, so it stretches to the viewport at desktop.',
    oneLineFix: 'Add a max-width and centre the form container.',
  },
  {
    id: 'S6-no-heading-element',
    name: 'Visible title with no heading element',
    match: 'no h1|no heading element|h1Count 0|without a single <h1>|missing h1',
    minHits: 2,
    rootCause: 'Page titles are rendered as span or p, so the document has no heading outline.',
    oneLineFix: 'Use a real heading element for the page title.',
  },
  {
    id: 'S7-status-not-announced',
    name: 'Status or error text not announced',
    match: 'role="alert"|aria-live|not announced|screen reader',
    minHits: 1,
    rootCause: 'Error and success messages are plain elements with no live region.',
    oneLineFix: 'Wrap status text in a live region (role="alert" for errors, aria-live="polite" for success).',
  },
  {
    id: 'S8-tap-target-under-44',
    name: 'Touch target under 44px',
    match: 'tap target|44px|under 44|44x44',
    minHits: 2,
    rootCause: 'Controls sized for pointer input; below the minimum touch target on mobile.',
    oneLineFix: 'Raise the control or its hit area to at least 44x44.',
  },
  {
    id: 'S9-dead-route',
    name: 'Route redirects or no longer exists',
    match: 'redirect|no longer exist|dead-ends|dead end',
    minHits: 2,
    rootCause: 'Routes and their callers drifted apart.',
    oneLineFix: 'Either restore the route or update the links that still point at it.',
  },
  {
    id: 'S10-cta-label-mismatch',
    name: 'CTA label disagrees with its action',
    match: 'Get started\|CTA label|label disagrees|mislabelled',
    minHits: 1,
    rootCause: 'Marketing copy was reused on a screen whose action differs.',
    oneLineFix: 'Make the CTA name the action it performs.',
  },
];