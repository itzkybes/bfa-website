import * as server from '../entries/pages/rosters/_page.server.js';

export const index = 8;
let component_cache;
export const component = async () => component_cache ??= (await import('../entries/pages/rosters/_page.svelte.js')).default;
export { server };
export const server_id = "src/routes/rosters/+page.server.js";
export const imports = ["_app/immutable/nodes/8.ChLL2LDz.js","_app/immutable/chunks/DfsLyd9G.js","_app/immutable/chunks/BDSDxmdz.js","_app/immutable/chunks/BxSQOaYs.js","_app/immutable/chunks/5RPAvU3Z.js","_app/immutable/chunks/BSCCGAI-.js","_app/immutable/chunks/D4Lq2K88.js","_app/immutable/chunks/CKLjWkrU.js","_app/immutable/chunks/BhoT7I6e.js"];
export const stylesheets = ["_app/immutable/assets/8.Be3Zlro-.css"];
export const fonts = [];
