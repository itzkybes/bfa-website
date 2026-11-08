// src/lib/utils/format.js
//
// Small display helpers shared by the route pages. Pure functions only —
// no API calls, no component state.

/**
 * Format a number with a fixed count of decimals. Rounds first, then pads,
 * and returns an em dash for anything that isn't a finite number.
 *
 * @param {unknown} value
 * @param {number} [places=1]
 * @returns {string}
 */
export function formatNumber(value, places = 1) {
  const n = Number(value);
  if (!isFinite(n)) return '—';
  const factor = 10 ** places;
  return (Math.round(n * factor) / factor).toFixed(places);
}

/**
 * Return `url` when present, otherwise a generated single-letter placeholder
 * avatar built from the first character of `name`.
 *
 * @param {string | null | undefined} url
 * @param {string | null | undefined} name
 * @param {string} [fallbackChar='T'] Letter used when `name` is empty.
 * @returns {string}
 */
export function avatarOrPlaceholder(url, name, fallbackChar = 'T') {
  if (url) return url;
  const ch = name ? String(name)[0].toUpperCase() : fallbackChar;
  return `https://ui-avatars.com/api/?name=${encodeURIComponent(ch)}&background=1a1a1e&color=a1a1aa&size=56&format=svg`;
}

/**
 * Best available display name for a player id, looked up in the Sleeper
 * `/players/nba` map. Falls back to the raw id so the UI never renders blank.
 *
 * @param {Record<string, any>} playersMap
 * @param {string | number | null | undefined} pid
 * @returns {string}
 */
export function playerDisplayName(playersMap, pid) {
  if (!pid) return '';
  const p = playersMap?.[pid];
  if (!p) return String(pid);
  return p.full_name || `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim() || String(pid);
}
