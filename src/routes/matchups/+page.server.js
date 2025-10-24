// src/routes/matchups/+page.server.js
// Server load for matchups page
// - Attempts to load static override data from /early2023.json for season=2023 weeks 1..3
// - Robust fallbacks: event.fetch('/early2023.json') -> fs read -> absolute fetch
// - Returns debug messages and `earlyOverride` (null or array for the week) along with basic season/week metadata
import fs from 'fs/promises';

/**
 * Utility: try to parse JSON safely
 */
function safeParseJson(txt) {
  try {
    return JSON.parse(txt);
  } catch (e) {
    return null;
  }
}

export async function load(event) {
  const debug = []; // clear previous debug, start fresh

  const url = event.url;
  const qp = url.searchParams;
  const incomingSeason = qp.get('season') || null;
  const incomingWeek = qp.get('week') ? Number(qp.get('week')) : null;

  // Determine defaults: we'll default week to 1 if not present
  const selectedSeason = incomingSeason || '2023';
  const selectedWeek = (Number.isFinite(incomingWeek) && !Number.isNaN(incomingWeek)) ? incomingWeek : 1;

  debug.push(`Override debug: season=${selectedSeason} week=${selectedWeek}`);

  let earlyOverride = null; // will hold array of matchups for the week if found

  // We only support the early2023 override for season '2023' weeks 1..3
  const isEarly2023 = (String(selectedSeason) === '2023' && selectedWeek >= 1 && selectedWeek <= 3);
  debug.push(`isEarly2023=${isEarly2023}`);

  if (isEarly2023) {
    // Attempt 1: event.fetch('/early2023.json') — server-side fetch routed inside SvelteKit
    try {
      if (typeof event.fetch === 'function') {
        debug.push('Attempt 1: event.fetch("/early2023.json")');
        const res = await event.fetch('/early2023.json');
        if (res && res.ok) {
          const json = await res.json();
          if (json && typeof json === 'object') {
            debug.push('Attempt 1: success via event.fetch');
            const weekData = (json['2023'] && json['2023'][String(selectedWeek)]) ? json['2023'][String(selectedWeek)] : null;
            if (weekData) {
              earlyOverride = weekData;
              debug.push(`Loaded early override for week ${selectedWeek} via event.fetch`);
            } else {
              debug.push(`event.fetch returned JSON but no entry for week ${selectedWeek}`);
            }
          } else {
            debug.push('event.fetch returned non-object JSON or empty payload');
          }
        } else {
          debug.push(`event.fetch failed or returned non-OK status: ${res ? res.status : 'no-res'}`);
        }
      } else {
        debug.push('event.fetch is not a function in this context');
      }
    } catch (e) {
      debug.push(`Attempt 1 error: event.fetch("/early2023.json") threw: ${String(e && e.message ? e.message : e)}`);
    }

    // Attempt 2: try to read from disk relative to this file (useful during build / Node environments)
    if (!earlyOverride) {
      try {
        debug.push('Attempt 2: reading static/early2023.json from disk via fs');
        // Path: src/routes/matchups/+page.server.js  -> up 3 to project root -> static/early2023.json
        const staticPath = new URL('../../../static/early2023.json', import.meta.url);
        const txt = await fs.readFile(staticPath, { encoding: 'utf8' });
        const json = safeParseJson(txt);
        if (json && typeof json === 'object') {
          debug.push('Attempt 2: success reading file from disk');
          const weekData = (json['2023'] && json['2023'][String(selectedWeek)]) ? json['2023'][String(selectedWeek)] : null;
          if (weekData) {
            earlyOverride = weekData;
            debug.push(`Loaded early override for week ${selectedWeek} from disk`);
          } else {
            debug.push(`Disk JSON read succeeded but no entry for week ${selectedWeek}`);
          }
        } else {
          debug.push('Disk JSON parse failed or returned non-object');
        }
      } catch (e) {
        debug.push(`Attempt 2 error: reading static/early2023.json from disk failed: ${String(e && e.message ? e.message : e)}`);
      }
    }

    // Attempt 3: fallback to absolute fetch to the same origin (this works in many hosting setups)
    if (!earlyOverride) {
      try {
        debug.push('Attempt 3: global fetch to absolute URL for /early2023.json');
        const absUrl = new URL('/early2023.json', event.url.origin).href;
        const res2 = await fetch(absUrl);
        if (res2 && res2.ok) {
          const json = await res2.json();
          if (json && typeof json === 'object') {
            debug.push('Attempt 3: success via global fetch');
            const weekData = (json['2023'] && json['2023'][String(selectedWeek)]) ? json['2023'][String(selectedWeek)] : null;
            if (weekData) {
              earlyOverride = weekData;
              debug.push(`Loaded early override for week ${selectedWeek} via global fetch`);
            } else {
              debug.push(`global fetch returned JSON but no entry for week ${selectedWeek}`);
            }
          } else {
            debug.push('global fetch returned invalid JSON');
          }
        } else {
          debug.push(`global fetch failed or non-OK: ${res2 ? res2.status : 'no-res'}`);
        }
      } catch (e) {
        debug.push(`Attempt 3 error: global fetch failed: ${String(e && e.message ? e.message : e)}`);
      }
    }

    if (!earlyOverride) {
      debug.push('No valid early2023.json override found (all attempts failed or file missing)');
    }
  } // end isEarly2023

  // Build the rest of the page payload (minimal — adapt to your app)
  // NOTE: this loader intentionally keeps the payload small. The pages will use the earlyOverride
  // to replace computed matchups when needed.
  const payload = {
    season: selectedSeason,
    week: selectedWeek,
    isEarly2023,
    earlyOverride, // null or array of matchups for the week
    debug
  };

  return payload;
}
