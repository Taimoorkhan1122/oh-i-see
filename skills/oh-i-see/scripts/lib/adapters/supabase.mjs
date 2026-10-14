/**
 * adapters/supabase.mjs — in-flight emulation of GoTrue + PostgREST.
 *
 * This exists for one reason: when the API host does not resolve from your
 * network, the SPA still renders, but every fetch fails and every page looks
 * broken for reasons that have nothing to do with the app. Emulating the
 * smallest slice of the backend that the UI actually reads turns "the whole
 * app is down" into "the chrome is auditable, the row content is not".
 *
 * What survives emulation: layout, typography, colour, contrast, focus,
 * routing, redirects, form validation, error-state rendering, empty states.
 * What does not: anything that depends on what a row *says*. Findings in that
 * second group must be marked fixtureInduced — see references/evidence-discipline.md.
 *
 * Ported and generalised from the reference run. If your backend is not
 * Supabase, write a sibling adapter with the same two exports.
 */

const b64url = (obj) =>
  Buffer.from(JSON.stringify(obj)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export function makeJwt(user, expSeconds = 60 * 60 * 24 * 7) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'HS256', typ: 'JWT' };
  const payload = {
    sub: user.id,
    aud: 'authenticated',
    role: 'authenticated',
    email: user.email,
    session_id: '00000000-0000-4000-8000-000000000001',
    iat: now,
    exp: now + expSeconds,
    is_anonymous: false,
    app_metadata: user.app_metadata ?? { provider: 'email', providers: ['email'] },
    user_metadata: user.user_metadata ?? {},
    amr: [{ method: 'password', timestamp: now }],
  };
  return `${b64url(header)}.${b64url(payload)}.${b64url({ sig: 'mock' })}`;
}

export function makeUser(overrides = {}) {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    aud: 'authenticated',
    role: 'authenticated',
    email: 'auditor@project.test',
    email_confirmed_at: '2026-01-01T00:00:00.000Z',
    phone: '',
    confirmed_at: '2026-01-01T00:00:00.000Z',
    last_sign_in_at: '2026-10-01T09:00:00.000Z',
    app_metadata: { provider: 'email', providers: ['email'], role: 'student' },
    user_metadata: { full_name: 'Sam Rivera' },
    identities: [],
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

export function makeSession(user = makeUser()) {
  const nowS = Math.floor(Date.now() / 1000);
  const expires_at = nowS + 60 * 60 * 24 * 7;
  return {
    access_token: makeJwt(user),
    token_type: 'bearer',
    expires_in: expires_at - nowS,
    expires_at,
    refresh_token: 'mock-refresh-token',
    user,
  };
}

// ── Synthetic PostgREST rows ─────────────────────────────────────────────
// Unknown tables get plausible rows built from the requested `select=` list so
// pages render with content instead of reading as falsely empty. Honour `eq()`
// filters so detail pages get the row they asked for.

const UUID = '22222222-2222-4222-8222-222222222222';
const NOW = '2026-10-01T12:00:00.000Z';
const USER_ID = '11111111-1111-4111-8111-111111111111';

const PLACEHOLDER_IMG =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="900">' +
      '<rect width="600" height="900" fill="#26261f"/><rect width="600" height="420" fill="#3a2a22"/>' +
      '<text x="300" y="470" fill="#8b8378" font-size="34" font-family="sans-serif" text-anchor="middle">fixture</text></svg>',
  );

const LONG_TEXT =
  'Long-form fixture copy so wrapping, line-height and rhythm can be judged against realistic lengths. ' +
  'A single short word hides every overflow and every awkward rag that a real sentence would expose.';

export const VALUE_BY_COLUMN = {
  id: UUID,
  uuid: UUID,
  user_id: USER_ID,
  auth_user_id: USER_ID,
  student_id: USER_ID,
  member_id: USER_ID,
  educator_id: '33333333-3333-4333-8333-333333333333',
  owner_id: USER_ID,
  course_id: '44444444-4444-4444-8444-444444444444',
  class_id: '44444444-4444-4444-8444-444444444444',
  cohort_id: '55555555-5555-4555-8555-555555555555',
  slug: 'fixture-slug',
  status: 'active',
  role: 'student',
  email: 'auditor@project.test',
  email_confirmed_at: NOW,
  full_name: 'Sam Rivera',
  display_name: 'Sam Rivera',
  name: 'Sam Rivera',
  handle: 'samrivera',
  title: 'Founder',
  headline: 'Brand strategist and creator',
  bio: 'Ships brand systems for creators. Writes about positioning, naming and creative systems.',
  description: LONG_TEXT,
  summary: 'Build the system once. Reuse it everywhere.',
  subtitle: 'Build the system once. Reuse it everywhere.',
  body: LONG_TEXT,
  content: LONG_TEXT,
  text: LONG_TEXT,
  note: 'Shipped the naming pass. It got shorter every round, which was the point.',
  notes: 'Shipped the naming pass. It got shorter every round, which was the point.',
  answer: 'A system that does not survive a launch is decoration, not a system.',
  reflection: 'A system that does not survive a launch is decoration, not a system.',
  prompt: 'What did you ship this week, and what did it teach you?',
  prompt_text: 'What did you ship this week, and what did it teach you?',
  question: 'What did you ship this week, and what did it teach you?',
  message: 'Love this framing — the naming pass changed my whole positioning doc.',
  lesson_count: 12,
  lessons_count: 12,
  duration_minutes: 45,
  duration_seconds: 1800,
  watched_seconds: 840,
  last_position: 840,
  progress: 42,
  progress_percent: 42,
  percent: 42,
  completed: true,
  is_complete: true,
  completed_at: NOW,
  enrolled_at: NOW,
  started_at: NOW,
  is_visible: true,
  is_published: true,
  published: true,
  published_at: NOW,
  featured: true,
  is_active: true,
  active: true,
  free: false,
  price_cents: 19700,
  amount_cents: 19700,
  amount: 197,
  price: 197,
  credits: 12,
  xp: 850,
  points: 850,
  score: 88,
  rank: 1,
  level: 4,
  streak: 7,
  streak_days: 7,
  longest_streak: 21,
  day: 1,
  week: 3,
  position: 1,
  display_order: 1,
  sort_order: 1,
  order: 1,
  month: '2026-10-01',
  year: 2026,
  date: '2026-10-01',
  entry_date: '2026-10-01',
  due_at: '2026-10-15T12:00:00.000Z',
  expires_at: '2027-10-01T12:00:00.000Z',
  last_message_at: NOW,
  last_watched_at: NOW,
  thumbnail_url: PLACEHOLDER_IMG,
  image_url: PLACEHOLDER_IMG,
  cover_url: PLACEHOLDER_IMG,
  photo_url: PLACEHOLDER_IMG,
  avatar_url: PLACEHOLDER_IMG,
  poster_url: PLACEHOLDER_IMG,
  video_url: 'https://player.vimeo.com/video/1',
  trailer_url: 'https://player.vimeo.com/video/1',
  url: 'https://example.test/',
  href: 'https://example.test/',
  certificate_number: 'CERT-2026-0001',
  certificateNumber: 'CERT-2026-0001',
  course_title: 'Fixture Class',
  creator_name: 'Fixture Educator',
  teaches: 'Fixture Class',
  teaches_label: 'Teaches Fixture Class',
  mood: 'Focus',
  category: 'Brand',
  categories: ['Brand', 'Content'],
  tags: ['brand', 'positioning'],
  section: 'Foundation',
  module: 'Foundation',
  module_title: 'Foundation',
  chapter: 'Foundation',
  label: 'Week 1',
  cohort_name: 'Spring Cohort',
  students_count: 412,
  referral_code: 'REF-2026',
  invite_code: 'INVITE-2026',
  session_id: '00000000-0000-4000-8000-000000000001',
  ip_address: '203.0.113.10',
  user_agent: 'Mozilla/5.0',
  platform: 'web',
  device: 'desktop',
  timezone: 'America/New_York',
  locale: 'en-US',
  currency: 'usd',
  plan: 'Pro',
  plan_name: 'Pro',
  interval: 'month',
  billing_period: 'monthly',
  total: 197,
  signups_enabled: true,
  onboarding_complete: true,
  onboarded: true,
  has_completed_onboarding: true,
  is_liked: false,
  liked: false,
  is_saved: false,
  saved: false,
  is_bookmarked: false,
  locked: false,
  optional: false,
  required: false,
  read: false,
};

function columnValue(col, filters, index) {
  // An eq() filter on this exact column wins, so detail pages resolve.
  for (const [key, raw] of Object.entries(filters)) {
    if (col !== key) continue;
    const vals = String(raw).replace(/^eq\./, '').split(',');
    return vals[index % vals.length];
  }
  if (Object.prototype.hasOwnProperty.call(VALUE_BY_COLUMN, col)) {
    const v = VALUE_BY_COLUMN[col];
    return Array.isArray(v) ? v[index % v.length] : v;
  }
  if (/_at$|^date$|_date$|_on$/.test(col)) return NOW;
  if (/_id$/.test(col)) return UUID;
  if (/^(is_|has_|can_|should_)/.test(col)) return false;
  if (/(^|_)count$|total$/.test(col)) return 12;
  if (/minutes|_sec|_seconds|_ms/.test(col)) return 45;
  if (/percent|_pct/.test(col)) return 42;
  if (/_order$|^order$/.test(col)) return index + 1;
  if (/url$|_link$/.test(col)) return 'https://example.test/';
  if (/text|note|body|content|description|answer|reflection|prompt|question|message|bio/.test(col)) return LONG_TEXT;
  if (/_at$|_on$/.test(col)) return NOW;
  return 'fixture';
}

export function synthRows(table, url) {
  const select = (url.searchParams.get('select') || '*').trim();
  const cols = select === '*' ? ['id', 'title', 'created_at'] : select.split(',').map((c) => c.trim()).filter(Boolean);
  const filters = {};
  for (const [k, v] of url.searchParams.entries()) {
    if (/^(select|order|limit|offset|apikey|on_conflict|prefer|columns)$/.test(k)) continue;
    filters[k] = v;
  }
  // Collections read as more real with more rows; detail pages need one.
  const requested = parseInt(url.searchParams.get('limit') || '', 10);
  const n = Number.isFinite(requested) ? requested : /s|list|collection/.test(table) ? 3 : 2;
  const rows = [];
  for (let i = 0; i < n; i += 1) {
    const row = {};
    for (const col of cols) row[col] = columnValue(col, filters, i);
    if (!('id' in row)) row.id = UUID;
    rows.push(row);
  }
  return rows;
}

/** Extra non-200 auth outcomes a flow can request by name. */
export const AUTH_OUTCOMES = {
  success: null,
  invalid_credentials: { status: 400, body: { error: 'invalid_grant', error_description: 'Invalid login credentials' } },
  email_exists: { status: 422, body: { error: 'email_exists', error_description: 'User already registered' } },
  weak_password: {
    status: 422,
    body: { error: 'weak_password', error_description: 'Password should be at least 8 characters.', weak_password: { reasons: ['length'] } },
  },
  rate_limit: { status: 429, body: { error: 'over_request_rate_limit', message: 'Too many requests' } },
  server_error: { status: 500, body: { error: 'server_error', message: 'Internal error' } },
};

/**
 * Attach the mock to a Playwright context.
 *
 * opts.authOutcome  see AUTH_OUTCOMES
 * opts.rows         { table: [row, ...] } — explicit rows win over synthesis
 * opts.functions    { edgeFunctionName: responseBody }
 * opts.functionDelays { edgeFunctionName: ms } — stall to capture loading states
 * opts.emptyTables  [table, ...] — return [] so empty states render
 */
export async function attach(context, opts = {}) {
  const {
    authOutcome = 'success',
    rows = {},
    emptyTables = [],
    functionDelays = {},
    functions = {},
    blockRealtime = true,
    user: userOverride,
    hostPattern = '**/*.supabase.co/**',
  } = opts;

  const user = userOverride ?? makeUser();
  const session = makeSession(user);
  const forced = AUTH_OUTCOMES[authOutcome] ?? null;

  await context.route(hostPattern, async (route) => {
    const req = route.request();
    let url;
    try { url = new URL(req.url()); } catch { return route.continue(); }
    const path = url.pathname;
    const json = (status, body) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

    // ── GoTrue ──
    if (path.endsWith('/auth/v1/token')) {
      if (forced && url.searchParams.get('grant_type') !== 'refresh_token') return json(forced.status, forced.body);
      return json(200, session);
    }
    if (path.endsWith('/auth/v1/signup')) {
      if (forced) return json(forced.status, forced.body);
      return json(200, { user: { ...user, email: 'newcomer@project.test' }, session: null });
    }
    if (path.endsWith('/auth/v1/user')) {
      if (req.method() === 'DELETE') return json(200, {});
      const auth = req.headers().authorization ?? '';
      if (!auth || auth.includes('publishable') || auth.trim().endsWith('=')) {
        return json(401, { error: 'invalid_token', message: 'Invalid claim: missing sub claim' });
      }
      return json(200, user);
    }
    if (path.endsWith('/auth/v1/verify')) return json(200, session);
    if (path.endsWith('/auth/v1/recover')) return json(200, {});
    if (path.endsWith('/auth/v1/logout')) return json(204, {});
    if (path.includes('/auth/v1/')) return json(200, {});

    // ── PostgREST ──
    if (path.includes('/rest/v1/')) {
      const table = path.split('/rest/v1/')[1].split('/')[0];
      if (emptyTables.includes(table)) {
        return req.headers().accept?.includes('pgrst.object')
          ? json(406, { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned', details: null, hint: null })
          : json(200, []);
      }
      const data = Object.prototype.hasOwnProperty.call(rows, table) ? rows[table] : synthRows(table, url);
      if (req.headers().accept?.includes('pgrst.object')) {
        if (!data.length) {
          return json(406, { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned', details: null, hint: null });
        }
        return json(200, data[0]);
      }
      if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(req.method())) return json(201, data[0] ?? {});
      return json(200, data);
    }
    if (path.includes('/rpc/')) return json(200, []);
    if (path.includes('/storage/v1/')) return json(200, {});
    if (path.includes('/functions/v1/')) {
      const fn = path.split('/functions/v1/')[1].replace(/\/$/, '');
      if (functionDelays[fn]) await new Promise((r) => setTimeout(r, functionDelays[fn]));
      if (Object.prototype.hasOwnProperty.call(functions, fn)) return json(200, functions[fn]);
      return json(200, { ok: true, data: [] });
    }
    if (path.includes('/realtime/v1/')) {
      return blockRealtime ? route.abort('failed') : route.fulfill({ status: 200, contentType: 'text/plain', body: 'ok' });
    }
    return json(200, {});
  });

  // Realtime is a websocket. Fail it fast and quietly so it does not hold a
  // capture open for the full timeout on every single step.
  await context.route('wss://*.supabase.co/**', (route) => route.abort('failed')).catch(() => {});

  return { user, session };
}

/**
 * Seed an auth session into localStorage before the app boots.
 * `storageKey` comes from config; Supabase's convention is `sb-<ref>-auth-token`.
 */
export async function seedSession(context, storageKey, session, extra = {}) {
  await context.addInitScript(
    ([key, value, kv]) => {
      try {
        window.localStorage.setItem(key, value);
        for (const [k, v] of Object.entries(kv)) window.localStorage.setItem(k, v);
      } catch {}
    },
    [storageKey, JSON.stringify(session), extra],
  );
}

export default { attach, seedSession, makeUser, makeSession, makeJwt, synthRows, AUTH_OUTCOMES };
