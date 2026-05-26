import * as server from '../entries/pages/matchups/_page.server.js';

export const index = 5;
let component_cache;
export const component = async () => component_cache ??= (await import('../entries/pages/matchups/_page.svelte.js')).default;
export { server };
export const server_id = "src/routes/matchups/+page.server.js";
export const imports = ["_app/immutable/nodes/5.BwGO1-Oi.js","_app/immutable/chunks/DfsLyd9G.js","_app/immutable/chunks/BDSDxmdz.js","_app/immutable/chunks/BxSQOaYs.js","_app/immutable/chunks/BSCCGAI-.js","_app/immutable/chunks/D4Lq2K88.js","_app/immutable/chunks/CKLjWkrU.js","_app/immutable/chunks/BhoT7I6e.js"];
export const stylesheets = ["_app/immutable/assets/5.BXm_Wpel.css"];
export const fonts = [];
