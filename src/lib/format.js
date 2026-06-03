// /app/src/lib/format.js
//
// Tiny formatting + roster-meta helpers shared by every route. Pulled out
// of seven near-identical inline copies that lived inside each +page.svelte
// (fmt, fmt1, fmt2, avatarOrPh, the `team_avatar || owner_avatar` pattern,
// the `team_name ?? Roster #` fallback, etc.). Centralizing means a single
// place to tweak rounding / placeholder colors / fallback semantics.

const UI_AVATAR_BASE = 'https://ui-avatars.com/api/?background=1a1a1e&color=a1a1aa&size=80&format=svg&name=';

/**
 * Return an avatar URL if present, otherwise a deterministic placeholder
 * built from the first letter of `name`. Pages used this with subtly
 * different sizes / colors — we standardize on the dark-theme palette.
 */
export function avatarOrPh(url, name) {
  if (url) return url;
  const ch = name ? String(name)[0].toUpperCase() : 'T';
  return `${UI_AVATAR_BASE}${encodeURIComponent(ch)}`;
}

/**
 * Roster-meta is a `{ team_name, owner_name, owner_username, team_avatar,
 * owner_avatar, ... }` object. The next handful of helpers normalize the
 * various fallbacks so callers never need to remember the ?? chain.
 */
export function franchiseAvatar(meta, fallbackName) {
  if (!meta) return avatarOrPh(null, fallbackName);
  // `meta.avatar` is the flat shorthand used by computed standings rows
  // (where the upstream collapsed team_avatar/owner_avatar into one field).
  return meta.team_avatar || meta.owner_avatar || meta.avatar ||
    avatarOrPh(null, fallbackName || meta.team_name || meta.owner_name);
}

export function franchiseName(meta, fallback = '—') {
  if (!meta) return fallback;
  return meta.team_name || meta.owner_name || (meta.rosterId != null ? `Roster ${meta.rosterId}` : fallback);
}

export function ownerName(meta, fallback = '—') {
  if (!meta) return fallback;
  return meta.owner_name || meta.owner_username || fallback;
}

/**
 * Number formatters — `n` may be null / undefined / string.
 *   fmt(x)  → integer, no separators
 *   fmt1(x) → 1 decimal
 *   fmt2(x) → 2 decimals
 * `safe` versions coerce non-finite to 0.
 */
function _toNum(n) {
  const v = Number(n ?? 0);
  return isFinite(v) ? v : 0;
}
export function fmt(n)  { return Math.round(_toNum(n)).toString(); }
export function fmt1(n) { return _toNum(n).toFixed(1); }
export function fmt2(n) { return _toNum(n).toFixed(2); }

/** Compact "12-7" record formatter. */
export function fmtRecord(w, l) {
  return `${_toNum(w)}-${_toNum(l)}`;
}

/**
 * Win-pct as a 0..1 number (NOT percent). Returns 0 if no games played
 * so the caller can multiply by 100 without an NaN. The companion
 * `fmtWinPct` returns "46.2%" style strings.
 */
export function winPct(w, l) {
  const games = _toNum(w) + _toNum(l);
  return games ? _toNum(w) / games : 0;
}
export function fmtWinPct(w, l) {
  return `${(winPct(w, l) * 100).toFixed(1)}%`;
}
