import { getSeasonFormat } from './seasonFormat.js';

  /**
   * Roll up every season's standings into a per-owner career snapshot:
   * championships, playoff appearances, career W-L, career PF/PA, best
   * finish, and best single-season PF, PLUS franchise-specific records.
   * Reads STRICTLY from `starters_points` for any per-player figures
   * (per project policy — `player_points` is never consulted).
   */
export function buildOwnerHubs(allSeasonResults, chain, playersMap = {}) {
    const hubs = {};
    const ownerSeasonsHandled = {};
    function ensure(uname) {
      const k = String(uname || '').toLowerCase();
      if (!k) return null;
      if (!hubs[k]) {
        hubs[k] = {
          owner_username: uname,
          championships: 0, playoffAppearances: 0, finalsAppearances: 0,
          seasonsPlayed: 0,
          careerWins: 0, careerLosses: 0, careerPF: 0, careerPA: 0,
          bestFinish: null, bestFinishSeason: null,
          bestSeasonPF: 0, bestSeasonPFSeason: null,
          bestSeasonRecord: null,
          longestWinStreak: 0, longestWinStreakSeason: null,
          longestLoseStreak: 0, longestLoseStreakSeason: null,
          bestSingleGame: null,
          bestPlayoffGame: null,
          highestWeek: null, lowestWeek: null,
          biggestBlowoutWin: null, biggestBlowoutLoss: null,
          firstSeason: null, lastSeason: null
        };
        ownerSeasonsHandled[k] = new Set();
      }
      return hubs[k];
    }

    for (let i = 0; i < allSeasonResults.length; i++) {
      const s = chain[i];
      const r = allSeasonResults[i];
      if (!r || !r.regularStandings) continue;
      const seasonLabel = s?.season ?? r.leagueSeason ?? s?.league_id;
      const rmap = r.rosterMap || {};

      for (const reg of r.regularStandings) {
        const meta = rmap[reg.rosterId] || {};
        const hub = ensure(meta.owner_username || meta.owner_name);
        if (!hub) continue;
        const k = String(hub.owner_username).toLowerCase();
        if (!ownerSeasonsHandled[k].has(seasonLabel)) {
          ownerSeasonsHandled[k].add(seasonLabel);
          hub.seasonsPlayed += 1;
        }
        const wins = Number(reg.wins ?? 0);
        const losses = Number(reg.losses ?? 0);
        const pf = Number(reg.pf ?? 0);
        const pa = Number(reg.pa ?? 0);
        hub.careerWins += wins;
        hub.careerLosses += losses;
        hub.careerPF += pf;
        hub.careerPA += pa;
        if (pf > hub.bestSeasonPF) { hub.bestSeasonPF = pf; hub.bestSeasonPFSeason = seasonLabel; }
        if (!hub.bestSeasonRecord || wins > hub.bestSeasonRecord.wins ||
            (wins === hub.bestSeasonRecord.wins && losses < hub.bestSeasonRecord.losses)) {
          hub.bestSeasonRecord = { wins, losses, season: seasonLabel };
        }
        const winStreak = Number(reg.win_streak ?? reg.winStreak ?? reg.best_win_streak ?? reg.maxWinStreak ?? 0);
        const loseStreak = Number(reg.lose_streak ?? reg.loseStreak ?? reg.worst_lose_streak ?? reg.maxLoseStreak ?? 0);
        if (winStreak > hub.longestWinStreak) { hub.longestWinStreak = winStreak; hub.longestWinStreakSeason = seasonLabel; }
        if (loseStreak > hub.longestLoseStreak) { hub.longestLoseStreak = loseStreak; hub.longestLoseStreakSeason = seasonLabel; }
        if (hub.firstSeason == null || Number(seasonLabel) < Number(hub.firstSeason)) hub.firstSeason = seasonLabel;
        if (hub.lastSeason == null || Number(seasonLabel) > Number(hub.lastSeason)) hub.lastSeason = seasonLabel;
      }

      if (Array.isArray(r.finalStandings) && r.bracketComplete) {
        for (const fs of r.finalStandings) {
          const meta = rmap[fs.rosterId] || {};
          const hub = ensure(meta.owner_username || meta.owner_name);
          if (!hub) continue;
          if (fs.isChampion) hub.championships += 1;
          if (fs.isPlayoff) hub.playoffAppearances += 1;
          if (fs.rank === 1 || fs.rank === 2) hub.finalsAppearances += 1;
          if (hub.bestFinish == null || fs.rank < hub.bestFinish) {
            hub.bestFinish = fs.rank;
            hub.bestFinishSeason = seasonLabel;
          }
        }
      }

      // Per-game records — scan collectedMatchups for every week. Regular
      // season weeks (1 → playoffStart-1) feed the franchise records that
      // are strictly regular-season (highest/lowest, blowouts, best single
      // game). Playoff weeks (playoffStart → playoffEnd) feed `bestPlayoffGame`.
      // All per-player figures read from `starters_points` ONLY.
      const collected = r.collectedMatchups || {};
      const seasonFormat = getSeasonFormat(seasonLabel);
      const playoffStart = Number(r.playoffStart) || seasonFormat?.playoffStart || 19;
      const playoffEnd = Number(r.playoffEnd) || seasonFormat?.playoffEnd || (playoffStart + 2);
      for (const wkStr of Object.keys(collected)) {
        const wk = Number(wkStr);
        if (!isFinite(wk) || wk < 1) continue;
        const isRegular = wk < playoffStart;
        const isPlayoff = wk >= playoffStart && wk <= playoffEnd;
        if (!isRegular && !isPlayoff) continue;
        const entries = collected[wkStr] || [];
        const byMatch = {};
        for (const e of entries) {
          const m = String(e.matchup_id ?? '_unk');
          if (!byMatch[m]) byMatch[m] = [];
          byMatch[m].push(e);
        }
        for (const e of entries) {
          const rid = e.roster_id ?? e.rosterId;
          if (!rid) continue;
          const meta = rmap[rid] || {};
          const hub = ensure(meta.owner_username || meta.owner_name);
          if (!hub) continue;
          const pts = Number(e.points ?? 0);

          // Regular-season-only metrics: highest/lowest week + blowouts.
          if (isRegular && pts > 0) {
            const opp = (byMatch[String(e.matchup_id)] || []).find((o) => (o.roster_id ?? o.rosterId) !== rid);
            const oppMeta = opp ? (rmap[opp.roster_id ?? opp.rosterId] || {}) : {};
            if (!hub.highestWeek || pts > hub.highestWeek.points) {
              hub.highestWeek = {
                points: pts, week: wk, season: seasonLabel,
                opponent_team: oppMeta.team_name || null,
                opponent_avatar: oppMeta.team_avatar || oppMeta.owner_avatar || null
              };
            }
            if (!hub.lowestWeek || pts < hub.lowestWeek.points) {
              hub.lowestWeek = { points: pts, week: wk, season: seasonLabel };
            }
            if (opp) {
              const oppPts = Number(opp.points ?? 0);
              const margin = pts - oppPts;
              if (margin > 0 && (!hub.biggestBlowoutWin || margin > hub.biggestBlowoutWin.margin)) {
                hub.biggestBlowoutWin = {
                  margin, my_score: pts, opp_score: oppPts,
                  opponent_team: oppMeta.team_name || null,
                  opponent_avatar: oppMeta.team_avatar || oppMeta.owner_avatar || null,
                  week: wk, season: seasonLabel
                };
              }
              if (margin < 0 && (!hub.biggestBlowoutLoss || margin < hub.biggestBlowoutLoss.margin)) {
                hub.biggestBlowoutLoss = {
                  margin, my_score: pts, opp_score: oppPts,
                  opponent_team: oppMeta.team_name || null,
                  opponent_avatar: oppMeta.team_avatar || oppMeta.owner_avatar || null,
                  week: wk, season: seasonLabel
                };
              }
            }
          }

          // Best single-game starter performance — strictly from
          // starters_points. Tracked separately for regular vs playoffs.
          const sp = e.starters_points;
          const starters = e.starters;
          if (Array.isArray(sp) && Array.isArray(starters)) {
            for (let idx = 0; idx < starters.length; idx++) {
              const pid = starters[idx];
              if (!pid) continue;
              const val = Number(sp[idx] ?? 0);
              if (!isFinite(val) || val <= 0) continue;
              if (isRegular) {
                if (!hub.bestSingleGame || val > hub.bestSingleGame.points) {
                  const p = playersMap[pid] || {};
                  hub.bestSingleGame = {
                    player_id: pid,
                    player_name: p.full_name || `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim() || pid,
                    points: val, week: wk, season: seasonLabel
                  };
                }
              } else if (isPlayoff) {
                if (!hub.bestPlayoffGame || val > hub.bestPlayoffGame.points) {
                  const p = playersMap[pid] || {};
                  hub.bestPlayoffGame = {
                    player_id: pid,
                    player_name: p.full_name || `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim() || pid,
                    points: val, week: wk, season: seasonLabel
                  };
                }
              }
            }
          }
        }
      }
    }

    for (const k of Object.keys(hubs)) {
      const h = hubs[k];
      const games = h.careerWins + h.careerLosses;
      h.winPct = games ? h.careerWins / games : 0;
    }
    return hubs;
  }
