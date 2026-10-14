/**
 * adapters/passthrough.mjs — use the real backend.
 *
 * Selected automatically when `probe-stack.mjs` reports the API host resolves
 * and answers. Nothing is intercepted; the app talks to the real thing.
 *
 * The only thing this adapter still does is seed an auth session when config
 * supplies credentials, so signed-in steps do not require typing a password
 * ten times. If you would rather sign in for real, set `auth.seedSession: false`
 * and let the flow's actions do the typing — that path also audits the login
 * form itself, which is worth doing at least once per run.
 */

export async function attach() {
  return { passthrough: true };
}

export async function seedSession() {
  // No-op. The real session is established by the flow's own actions.
}

export default { attach, seedSession, passthrough: true };
