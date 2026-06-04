// src/lib/utils/scoringLabels.js
//
// Sleeper exposes scoring settings as short keys (pts, reb, ast, ...) but
// only the keys are stable — labels and groupings are something we own
// here so the Rules page never has to guess.

/** Pretty label for one Sleeper scoring key. Falls back to the raw key. */
export function labelForScoringKey(key) {
  return LABELS[key] || key.replace(/_/g, ' ');
}

/** Bucket a key into a UI section. Used to group the Rules page table. */
export function groupForScoringKey(key) {
  if (BASICS.has(key)) return 'basics';
  if (SHOOTING.has(key)) return 'shooting';
  if (BONUSES.has(key) || key.startsWith('bonus_')) return 'bonuses';
  if (PENALTIES.has(key)) return 'penalties';
  return 'other';
}

/** Display order of the four groups. */
export const GROUP_ORDER = ['basics', 'shooting', 'bonuses', 'penalties', 'other'];

/** Pretty heading for one group. */
export const GROUP_LABELS = {
  basics: 'Box Score Basics',
  shooting: 'Shooting',
  bonuses: 'Bonuses & Milestones',
  penalties: 'Penalties',
  other: 'Other'
};

// ─── internals ──────────────────────────────────────────────────────────

const LABELS = {
  // Basics
  pts: 'Points Scored',
  reb: 'Rebound (Total)',
  oreb: 'Offensive Rebound',
  dreb: 'Defensive Rebound',
  ast: 'Assist',
  stl: 'Steal',
  blk: 'Block',
  to: 'Turnover',
  // Shooting
  fgm: 'Field Goal Made',
  fga: 'Field Goal Attempt',
  fgmi: 'Field Goal Missed',
  ftm: 'Free Throw Made',
  fta: 'Free Throw Attempt',
  ftmi: 'Free Throw Missed',
  tpm: '3-Pointer Made',
  tpa: '3-Pointer Attempt',
  tpmi: '3-Pointer Missed',
  // Penalties
  pf: 'Personal Foul',
  tf: 'Technical Foul',
  ff: 'Flagrant Foul',
  // Bonuses
  dd: 'Double-Double',
  td: 'Triple-Double',
  qd: 'Quadruple-Double',
  bonus_pt_40p: '40+ Point Game',
  bonus_pt_50p: '50+ Point Game',
  bonus_reb_20p: '20+ Rebound Game',
  bonus_ast_15p: '15+ Assist Game',
  bonus_blk_10p: '10+ Block Game',
  bonus_stl_10p: '10+ Steal Game',
  // Other
  sp: 'Game Start',
  min: 'Minute Played',
  gp: 'Game Played'
};

const BASICS = new Set(['pts', 'reb', 'oreb', 'dreb', 'ast', 'stl', 'blk', 'to']);
const SHOOTING = new Set(['fgm', 'fga', 'fgmi', 'ftm', 'fta', 'ftmi', 'tpm', 'tpa', 'tpmi']);
const BONUSES = new Set(['dd', 'td', 'qd']);
const PENALTIES = new Set(['pf', 'tf', 'ff']);
