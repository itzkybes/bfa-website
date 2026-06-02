

export const index = 1;
let component_cache;
export const component = async () => component_cache ??= (await import('../entries/fallbacks/error.svelte.js')).default;
export const imports = ["_app/immutable/nodes/1.q3k2hRAS.js","_app/immutable/chunks/DT0STw8n.js","_app/immutable/chunks/rirFhRDB.js","_app/immutable/chunks/DKlG3nJI.js"];
export const stylesheets = [];
export const fonts = [];
