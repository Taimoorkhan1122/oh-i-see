/**
 * adapters/index.mjs — pick an adapter from config.
 *
 * A third-party backend needs one new file with two exports (`attach`,
 * `seedSession`) and a line in ADAPTERS. Everything else in the skill is
 * backend-agnostic, so this is the only place that has to change.
 */

import * as supabase from './supabase.mjs';
import * as passthrough from './passthrough.mjs';

const ADAPTERS = {
  supabase,
  passthrough,
};

/**
 * @param {object} config  project.config.json
 * @returns {{name: string, impl: object}}
 */
export function pickAdapter(config) {
  const declared = config.api?.adapter;
  const implied = config.api?.reachable === false ? 'supabase' : 'passthrough';
  const name = declared || implied;

  if (!ADAPTERS[name]) {
    const known = Object.keys(ADAPTERS).join(', ');
    throw new Error(
      `unknown backend adapter "${name}" (known: ${known}). ` +
        `Add scripts/lib/adapters/${name}.mjs exporting attach() and seedSession().`,
    );
  }
  return { name, impl: ADAPTERS[name] };
}

/** Storage key the app reads its session from, or null for a passthrough run. */
export function storageKey(config) {
  return config.api?.storageKey || null;
}

export { ADAPTERS };
