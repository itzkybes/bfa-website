

export const index = 5;
let component_cache;
export const component = async () => component_cache ??= (await import('../entries/pages/matchups/_page.svelte.js')).default;
export const universal = {
  "ssr": false,
  "prerender": false
};
export const universal_id = "src/routes/matchups/+page.js";
export const imports = ["_app/immutable/nodes/5.BsRnVt6y.js","_app/immutable/chunks/DT0STw8n.js","_app/immutable/chunks/rirFhRDB.js","_app/immutable/chunks/DMD6_Ozy.js","_app/immutable/chunks/BKpfD0_n.js","_app/immutable/chunks/BxnC4H1K.js","_app/immutable/chunks/D0R1YlRJ.js","_app/immutable/chunks/K6j6PKk8.js","_app/immutable/chunks/DkRdpYNh.js","_app/immutable/chunks/DKlG3nJI.js","_app/immutable/chunks/wrzB25xg.js","_app/immutable/chunks/ioCfQEc3.js","_app/immutable/chunks/hTadKceH.js","_app/immutable/chunks/BRt7h0Sm.js"];
export const stylesheets = ["_app/immutable/assets/ErrorBoundary.WJ52EDRQ.css","_app/immutable/assets/5.BXm_Wpel.css"];
export const fonts = [];
