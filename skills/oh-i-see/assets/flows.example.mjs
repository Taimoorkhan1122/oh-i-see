/**
 * flows.example.mjs — a worked example of flow specs.
 *
 * Copy to <writeZone>/flows.mjs and replace with your own journeys. The three
 * flows below are deliberately generic: an auth surface, an authenticated core
 * loop, and a settings surface with a destructive action. Adapt them to your
 * app's real screens rather than shipping them as-is.
 *
 * ## The step spec
 *
 *   id           REQUIRED. Becomes a folder name under evidence/<FLOW>/ and is
 *                the evidence path every finding points at. Treat as permanent:
 *                renaming one orphans its screenshots and breaks every finding
 *                that cites it.
 *   route        The path appended to config.baseUrl.
 *   viewports    Which of config.viewports to shoot. Defaults to the flow's.
 *   signedIn     Seed a session before boot (supabase adapter only).
 *   authOutcome  Force a non-200 auth response. See AUTH_OUTCOMES in
 *                lib/adapters/supabase.mjs: invalid_credentials, email_exists,
 *                weak_password, rate_limit, server_error.
 *   rows         { table: [row, ...] } — explicit rows beat synthesised ones.
 *   emptyTables  [table, ...] — return [] so empty states render for real.
 *   functionDelays { edgeFn: ms } — stall so a loading state can be captured.
 *   actions      Ordered interaction steps. Supported keys:
 *                  click, clickText, clickNth, fill, type, press, hover, focus,
 *                  select, wait, waitFor, expectUrl, scroll
 *                Each may carry `timeout`. A failed action is recorded, does
 *                not abort the capture, and shows up in the smoke gates — which
 *                is what you want, because "this button does nothing" is often
 *                the finding.
 *   settle       ms after load before actions. Raise it for slow data routes.
 *   settleAfter  ms after the last action before measuring. Raise it for
 *                animated or lazy-loaded content.
 *   minText      Override the blank-render threshold for this step.
 *   focusAudit   false to skip the keyboard focus walk on this step.
 *   probe        false to skip the cheap semantics probe.
 *
 * ## Writing good flows
 *
 * - Include 320px on auth and form-heavy routes. That viewport found the worst
 *   overlap and tap-target defects in the reference run.
 * - Provoke the error states deliberately. A 429 rendering "Incorrect email or
 *   password" is invisible until you ask for a 429.
 * - Walk routes you are not certain still exist. Route drift was 6 of 113
 *   findings in the reference run, and none of them came from a spec that
 *   assumed the route was fine.
 * - Send at least one flow through the whole auth ladder, because the auth
 *   surface is shared CSS and shared bugs live there.
 */

export const FLOWS = {
  F1: {
    name: 'Sign in',
    focus: 'The auth surface is shared CSS. Check width constraints, label placement and error rendering.',
    viewports: ['desktop', 'tablet', 'mobile', 'small'],
    steps: [
      {
        id: 'f1-login-empty',
        route: '/login',
        signedIn: false,
        minText: 40,
      },
      {
        id: 'f1-login-filled',
        route: '/login',
        signedIn: false,
        actions: [
          { fill: ['input[type="email"]', 'member@example.test'] },
          { fill: ['input[type="password"]', 'CorrectHorseBattery1'] },
          { wait: 300 },
        ],
      },
      {
        id: 'f1-login-bad-credentials',
        route: '/login',
        signedIn: false,
        authOutcome: 'invalid_credentials',
        actions: [
          { fill: ['input[type="email"]', 'member@example.test'] },
          { fill: ['input[type="password"]', 'WrongPassword123'] },
          { click: 'button[type="submit"]' },
          { wait: 1500 },
        ],
      },
      {
        id: 'f1-login-rate-limited',
        route: '/login',
        signedIn: false,
        authOutcome: 'rate_limit',
        actions: [
          { fill: ['input[type="email"]', 'member@example.test'] },
          { fill: ['input[type="password"]', 'CorrectHorseBattery1'] },
          { click: 'button[type="submit"]' },
          { wait: 1500 },
        ],
      },
      {
        id: 'f1-login-keyboard',
        route: '/login',
        signedIn: false,
        actions: [
          { focus: 'input[type="email"]' },
          { press: 'Tab' },
          { wait: 250 },
        ],
      },
    ],
  },

  F2: {
    name: 'Core loop — read a lesson',
    focus: 'The main thing a paying member does. Everything here is P1 if it breaks.',
    viewports: ['desktop', 'mobile'],
    steps: [
      {
        id: 'f2-lesson-first',
        route: '/classes/example/lessons/1',
        signedIn: true,
        settle: 2200,
        expectApiCalls: true,
      },
      {
        id: 'f2-lesson-scrolled',
        route: '/classes/example/lessons/1',
        signedIn: true,
        settle: 2200,
        actions: [
          { scroll: 1200 },
          { wait: 400 },
        ],
      },
      {
        id: 'f2-lesson-next-tab',
        route: '/classes/example/lessons/1',
        signedIn: true,
        settle: 2200,
        actions: [
          { clickText: 'Next up', exact: true, timeout: 6000 },
          { wait: 800 },
        ],
      },
      {
        id: 'f2-lesson-navigation',
        route: '/classes/example/lessons/1',
        signedIn: true,
        settle: 2200,
        // Expecting the URL to change. If it does not, that is a finding, and
        // the capture records it rather than silently passing.
        actions: [
          { clickText: 'Next', exact: true, timeout: 6000 },
          { wait: 1200 },
          { expectUrl: 'lessons/2', timeout: 8000 },
        ],
      },
    ],
  },

  F3: {
    name: 'Settings and a destructive action',
    focus: 'Confirmation flows. Check whether cancel is as easy to reach as confirm.',
    viewports: ['desktop', 'mobile'],
    steps: [
      {
        id: 'f3-settings',
        route: '/settings',
        signedIn: true,
        settle: 1800,
      },
      {
        id: 'f3-delete-confirm',
        route: '/settings',
        signedIn: true,
        settle: 1800,
        actions: [
          { clickText: 'Delete account', timeout: 6000 },
          { wait: 900 },
        ],
      },
      {
        id: 'f3-empty-inbox',
        route: '/inbox',
        signedIn: true,
        settle: 1800,
        // An empty state is a designed screen. Audit it like any other.
        emptyTables: ['messages', 'notifications'],
      },
      {
        id: 'f3-loading',
        route: '/inbox',
        signedIn: true,
        settle: 1800,
        functionDelays: { 'get-messages': 4000 },
      },
    ],
  },
};

export default FLOWS;
