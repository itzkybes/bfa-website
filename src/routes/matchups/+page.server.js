// --- OVERRIDE: early2023.json for season 2023 weeks 1-3 ---
// Clear previous debug messages as requested so only override debug is returned.
messages = [];

try {
  const useSeason = String(selectedSeasonParam ?? '').trim();
  const useWeek = Number(selectedWeek);
  const isEarly2023 = (useSeason === '2023' && [1, 2, 3].includes(useWeek));

  messages.push(`Override debug: season=${useSeason} week=${useWeek} isEarly2023=${isEarly2023}`);

  if (isEarly2023) {
    let ovJson = null;

    // 1) Try a build-time import (preferred) — this behaves like referencing /bfa-logo.png from static
    try {
      // Path from this file (src/routes/matchups/+page.server.js) to repo root: '../../../../static/early2023.json'
      // Adjust path if your early2023.json is elsewhere (e.g., 'public' instead of 'static').
      const imported = await import('../../../../static/early2023.json');
      ovJson = imported && (imported.default ?? imported);
      messages.push('Loaded early2023.json via build-time import (static asset).');
    } catch (impErr) {
      messages.push('Build-time import failed: ' + (impErr && impErr.message ? impErr.message : String(impErr)));
      // fallback to disk candidates (tryLoadEarlyJsonCandidates)
      try {
        ovJson = await tryLoadEarlyJsonCandidates(messages);
        if (ovJson) messages.push('Loaded early2023.json via disk fallback.');
      } catch (fbErr) {
        messages.push('Disk fallback while loading early2023.json failed: ' + (fbErr && fbErr.message ? fbErr.message : String(fbErr)));
      }
    }

    // If still no JSON, report and do not override
    if (!ovJson) {
      messages.push('No valid early2023.json found (import + disk attempts failed or produced invalid JSON).');
    } else {
      // Ensure structure exists and map into matchupsRows
      const seasonKey = '2023';
      const wkKey = String(useWeek);
      if (ovJson[seasonKey] && Array.isArray(ovJson[seasonKey][wkKey])) {
        const overrides = ovJson[seasonKey][wkKey];
        messages.push(`early2023.json contains ${overrides.length} entries for ${seasonKey} week ${wkKey}. Applying override...`);
        const mapped = overrides.map((m, idx) => {
          const tA = m.teamA || {};
          const tB = m.teamB || {};
          const ownerA = tA.ownerName ?? tA.owner_name ?? null;
          const ownerB = tB.ownerName ?? tB.owner_name ?? null;
          return {
            week: useWeek,
            season: useSeason,
            participantsCount: 2,
            teamA: {
              rosterId: null,
              name: (typeof tA.name === 'string') ? tA.name : (tA.team_name || ''),
              ownerName: ownerA,
              avatar: tA.avatar ?? null,
              points: safeNum(m.teamAScore ?? m.homeScore ?? (tA.score ?? NaN)),
              matchup_id: m.matchupId ?? m.matchup_id ?? `hardcoded-2023-${useWeek}-${idx}`
            },
            teamB: {
              rosterId: null,
              name: (typeof tB.name === 'string') ? tB.name : (tB.team_name || ''),
              ownerName: ownerB,
              avatar: tB.avatar ?? null,
              points: safeNum(m.teamBScore ?? m.awayScore ?? (tB.score ?? NaN)),
              matchup_id: m.matchupId ?? m.matchup_id ?? `hardcoded-2023-${useWeek}-${idx}`
            },
            matchupId: m.matchupId ?? m.matchup_id ?? `hardcoded-2023-${useWeek}-${idx}`
          };
        });

        matchupsRows = mapped;
        messages.push(`Applied early2023 override: ${mapped.length} matchups replaced for season ${useSeason} week ${useWeek}`);
      } else {
        messages.push(`early2023.json parsed but missing expected key '2023' or week '${wkKey}'. Top-level keys: ${Object.keys(ovJson).slice(0,50).join(', ')}`);
      }
    }
  } else {
    messages.push('Override conditions not met — not applying early2023.json (season/week mismatch).');
  }
} catch (ovErr) {
  messages.push('Unexpected error during override processing: ' + (ovErr && ovErr.message ? ovErr.message : String(ovErr)));
  console.error('early2023 override error', ovErr);
}
