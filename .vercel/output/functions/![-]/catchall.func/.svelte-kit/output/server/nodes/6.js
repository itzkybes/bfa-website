

export const index = 6;
let component_cache;
export const component = async () => component_cache ??= (await import('../entries/pages/records-player/_page.svelte.js')).default;
export const universal = {
  "ssr": false,
  "prerender": false
};
export const universal_id = "src/routes/records-player/+page.js";
export const imports = ["_app/immutable/nodes/6.DsAmzWHc.js","_app/immutable/chunks/DT0STw8n.js","_app/immutable/chunks/rirFhRDB.js","_app/immutable/chunks/DMD6_Ozy.js","_app/immutable/chunks/BKpfD0_n.js","_app/immutable/chunks/K6j6PKk8.js","_app/immutable/chunks/8VSVXcWJ.js","_app/immutable/chunks/Cs27meUr.js","_app/immutable/chunks/B_MfdHAj.js","_app/immutable/chunks/ioCfQEc3.js","_app/immutable/chunks/hTadKceH.js","_app/immutable/chunks/Dz2NkrF5.js"];
export const stylesheets = ["_app/immutable/assets/ErrorBoundary.WJ52EDRQ.css","_app/immutable/assets/6.Dc3Hl2GC.css"];
export const fonts = [];
