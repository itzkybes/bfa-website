import * as server from '../entries/pages/honor-hall/_page.server.js';

export const index = 4;
let component_cache;
export const component = async () => component_cache ??= (await import('../entries/pages/honor-hall/_page.svelte.js')).default;
export { server };
export const server_id = "src/routes/honor-hall/+page.server.js";
export const imports = ["_app/immutable/nodes/4.CGQeUihW.js","_app/immutable/chunks/DfsLyd9G.js","_app/immutable/chunks/BDSDxmdz.js","_app/immutable/chunks/BxSQOaYs.js","_app/immutable/chunks/BSCCGAI-.js","_app/immutable/chunks/D4Lq2K88.js","_app/immutable/chunks/BhoT7I6e.js"];
export const stylesheets = ["_app/immutable/assets/4.BJ7mi084.css"];
export const fonts = [];
