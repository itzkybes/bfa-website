import * as server from '../entries/pages/admin/generate-season-matchups/_page.server.js';

export const index = 3;
let component_cache;
export const component = async () => component_cache ??= (await import('../entries/pages/admin/generate-season-matchups/_page.svelte.js')).default;
export { server };
export const server_id = "src/routes/admin/generate-season-matchups/+page.server.js";
export const imports = ["_app/immutable/nodes/3.cMA2s8wY.js","_app/immutable/chunks/DfsLyd9G.js","_app/immutable/chunks/BDSDxmdz.js","_app/immutable/chunks/BxSQOaYs.js","_app/immutable/chunks/BSCCGAI-.js","_app/immutable/chunks/BhoT7I6e.js"];
export const stylesheets = ["_app/immutable/assets/3.Vf24LGHt.css"];
export const fonts = [];
