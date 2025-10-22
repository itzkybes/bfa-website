// src/routes/matchups/+page.js
export async function load({ fetch, url }) {
  const CONFIG_PATH = '/week-ranges.json';
  const forcedWeekParam = url.searchParams.get('week');
  const forcedWeek = forcedWeekParam ? parseInt(forcedWeekParam, 10) : null;
  const leagueId = url.searchParams.get('league') || import.meta.env.VITE_LEAGUE_ID || '1219816671624048640';

  // helpers (same semantics as homepage)
  function parseLocalDateYMD(ymd) {
    return new Date(ymd + 'T00:00:00');
  }

  function computeEffectiveWeekFromRanges(ranges) {
    if (forcedWeek && !isNaN(forcedWeek)) return forcedWeek;
    if (!Array.isArray(ranges) || ranges.length === 0) return 1;
    const now = new Date();

    for (let i = 0; i < ranges.length; i++) {
      const r = ranges[i];
      const start = parseLocalDateYMD(r.start);
      const end = parseLocalDateYMD(r.end);
      const endInclusive = new Date(end.getFullYear(), end.getMonth(), end.getDate(), 23, 59, 59, 999);
      if (now >= start && now <= endInclusive) {
        const rotateAt = new Date(end.getFullYear(), end.getMonth(), end.getDate(), 12, 0, 0, 0);
        rotateAt.setDate(rotateAt.getDate() + 1); // rotate the week at noon the day after
        if (now >= rotateAt) {
          const next = (i + 1 < ranges.length) ? ranges[i + 1] : null;
          return next ? next.week : r.week;
        } else {
          return r.week;
        }
      }
    }

    // If before first start, return first week
    const first = ranges[0];
    const firstStart = parseLocalDateYMD(first.start);
    if (now < firstStart) return first.week;

    // If after last rotate, return last week
    const last = ranges[ranges.length - 1];
    const lastEnd = parseLocalDateYMD(last.end);
    const lastRotateAt = new Date(lastEnd.getFullYear(), lastEnd.getMonth(), lastEnd.getDate(), 12, 0, 0, 0);
    lastRotateAt.setDate(lastRotateAt.getDate() + 1);
    if (now >= lastRotateAt) return last.week;

    // Otherwise, fallback: find last range that ended and return its week
    for (let j = ranges.length - 1; j >= 0; j--) {
      const rr = ranges[j];
      const rrEnd = parseLocalDateYMD(rr.end);
      const rrEndInclusive = new Date(rrEnd.getFullYear(), rrEnd.getMonth(), rrEnd.getDate(), 23, 59, 59, 999);
      if (now > rrEndInclusive) {
        const rotateAtPast = new Date(rrEnd.getFullYear(), rrEnd.getMonth(), rrEnd.getDate(), 12, 0, 0, 0);
        rotateAtPast.setDate(rotateAtPast.getDate() + 1);
        if (now >= rotateAtPast) {
          const nx = (j + 1 < ranges.length) ? ranges[j + 1] : null;
          return nx ? nx.week : rr.week;
        } else {
          return rr.week;
        }
      }
    }

    return first.week;
  }

  function isPlayoffRange(r) {
    if (!r) return false;
    if (r.playoff === true || r.is_playoff === true) return true;
    if (r.type && typeof r.type === 'string' && r.type.toLowerCase().includes('play')) return true;
    if (r.label && typeof r.label === 'string' && r.label.toLowerCase().includes('play')) return true;
    if (r.name && typeof r.name === 'string' && r.name.toLowerCase().includes('play')) return true;
    if (typeof r.week === 'number' && r.week > 20) return true;
    return false;
  }

  function weekDateRangeLabel(weekNum, ranges) {
    if (!Array.isArray(ranges)) return null;
    for (let i = 0; i < ranges.length; i++) {
      if (ranges[i] && Number(ranges[i].week) === Number(weekNum)) {
        const s = ranges[i].start;
        const e = ranges[i].end;
        try {
          const sd = new Date(s + 'T00:00:00');
          const ed = new Date(e + 'T00:00:00');
          const opts = { month: 'short', day: 'numeric' };
          const sdStr = sd.toLocaleDateString(undefined, opts);
          const edStr = ed.toLocaleDateString(undefined, opts);
          return sdStr + ' — ' + edStr;
        } catch (err) {
          return s + ' — ' + e;
        }
      }
    }
    return null;
  }

  // normalizeMatchups (same as homepage)
  function normalizeMatchups(raw) {
    const pairs = [];
    if (!raw) return pairs;

    if (Array.isArray(raw)) {
      const map = {};
      for (let i = 0; i < raw.length; i++) {
        const e = raw[i];
        const mid = e.matchup_id != null ? String(e.matchup_id) : null;
        if (mid) {
          if (!map[mid]) map[mid] = [];
          map[mid].push(e);
        } else if (e.opponent_roster_id != null) {
          let attached = false;
          const keys = Object.keys(map);
          for (let k = 0; k < keys.length && !attached; k++) {
            const arr = map[keys[k]];
            for (let j = 0; j < arr.length; j++) {
              if (String(arr[j].roster_id) === String(e.opponent_roster_id) || String(arr[j].roster_id) === String(e.roster_id)) {
                arr.push(e);
                attached = true;
                break;
              }
            }
          }
          if (!attached) map['p_' + i] = [e];
        } else {
          map['p_' + i] = [e];
        }
      }

      const mids = Object.keys(map);
      for (let m = 0; m < mids.length; m++) {
        const bucket = map[mids[m]];
        if (bucket.length === 2) {
          pairs.push({ matchup_id: mids[m], home: normalizeEntry(bucket[0]), away: normalizeEntry(bucket[1]) });
        } else if (bucket.length === 1) {
          pairs.push({ matchup_id: mids[m], home: normalizeEntry(bucket[0]), away: null });
        } else if (bucket.length > 2) {
          for (let s = 0; s < bucket.length; s += 2) {
            pairs.push({ matchup_id: mids[m] + '_' + s, home: normalizeEntry(bucket[s]), away: normalizeEntry(bucket[s + 1] || null) });
          }
        }
      }
    } else if (typeof raw === 'object') {
      const arrFromObj = [];
      Object.keys(raw).forEach(k => {
        const v = raw[k];
        if (v && typeof v === 'object') arrFromObj.push(v);
      });
      if (arrFromObj.length > 0) {
        const grouping = {};
        for (let ii = 0; ii < arrFromObj.length; ii++) {
          const ee = arrFromObj[ii];
          const gm = ee.matchup_id != null ? String(ee.matchup_id) : 'p_' + ii;
          if (!grouping[gm]) grouping[gm] = [];
          grouping[gm].push(ee);
        }
        const gkeys = Object.keys(grouping);
        for (let g = 0; g < gkeys.length; g++) {
          const b = grouping[gkeys[g]];
          if (b.length >= 2) {
            for (let z = 0; z < b.length; z += 2) {
              pairs.push({ matchup_id: gkeys[g] + '_' + z, home: normalizeEntry(b[z]), away: normalizeEntry(b[z + 1] || null) });
            }
          } else {
            pairs.push({ matchup_id: gkeys[g], home: normalizeEntry(b[0]), away: null });
          }
        }
      }
    }
    return pairs;

    function normalizeEntry(rawEntry) {
      if (!rawEntry) return null;
      const entry = {
        roster_id: rawEntry.roster_id != null ? rawEntry.roster_id : (rawEntry.roster || rawEntry.owner_id || null),
        points: rawEntry.points != null ? rawEntry.points : (rawEntry.points_for != null ? rawEntry.points_for : (rawEntry.starters_points != null ? rawEntry.starters_points : null)),
        matchup_id: rawEntry.matchup_id != null ? rawEntry.matchup_id : null,
        raw: rawEntry
      };
      if (rawEntry.opponent_roster_id != null) entry.opponent_roster_id = rawEntry.opponent_roster_id;
      return entry;
    }
  }

  // load weekRanges
  let weekRanges = [];
  try {
    const cfgRes = await fetch(CONFIG_PATH);
    if (cfgRes.ok) weekRanges = await cfgRes.json();
  } catch (err) {
    weekRanges = [];
  }

  // fetch data for selected week
  const effectiveWeek = computeEffectiveWeekFromRanges(weekRanges || []);
  const selectedWeek = (forcedWeek && !isNaN(forcedWeek)) ? forcedWeek : effectiveWeek;

  // build week options grouped into regular & playoffs
  function buildWeekOptions(ranges) {
    if (!Array.isArray(ranges)) return { regular: [], playoffs: [] };
    const regular = [];
    const playoffs = [];
    for (let i = 0; i < ranges.length; i++) {
      const r = ranges[i];
      const wk = Number(r.week);
      const label = (r.label || r.name || ('Week ' + wk));
      if (isPlayoffRange(r)) {
        playoffs.push({ week: wk, label });
      } else {
        regular.push({ week: wk, label });
      }
    }
    regular.sort((a,b) => a.week - b.week);
    playoffs.sort((a,b) => a.week - b.week);
    return { regular, playoffs };
  }

  const weekOptions = buildWeekOptions(weekRanges);

  // fetch matchups/rosters/users from Sleeper for selectedWeek
  let matchupsRaw = [];
  let rosters = [];
  let users = [];
  try {
    const mRes = await fetch('https://api.sleeper.app/v1/league/' + encodeURIComponent(leagueId) + '/matchups/' + selectedWeek);
    if (mRes.ok) matchupsRaw = await mRes.json();
  } catch (err) {
    matchupsRaw = [];
  }

  try {
    const rRes = await fetch('https://api.sleeper.app/v1/league/' + encodeURIComponent(leagueId) + '/rosters');
    if (rRes.ok) rosters = await rRes.json();
  } catch (err) {
    rosters = [];
  }

  try {
    const uRes = await fetch('https://api.sleeper.app/v1/league/' + encodeURIComponent(leagueId) + '/users');
    if (uRes.ok) users = await uRes.json();
  } catch (err) {
    users = [];
  }

  const matchupPairs = normalizeMatchups(matchupsRaw || []);

  return {
    matchupPairs,
    rosters,
    users,
    weekRanges,
    selectedWeek,
    weekOptions,
    weekLabel: weekDateRangeLabel(selectedWeek, weekRanges)
  };
}
