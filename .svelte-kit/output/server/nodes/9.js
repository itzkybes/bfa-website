import * as server from '../entries/pages/standings/_page.server.js';

export const index = 9;
let component_cache;
export const component = async () => component_cache ??= (await import('../entries/pages/standings/_page.svelte.js')).default;
export { server };
export const server_id = "src/routes/standings/+page.server.js";
export const imports = ["_app/immutable/nodes/9.BNZ8Njv7.js","_app/immutable/chunks/DfsLyd9G.js","_app/immutable/chunks/BDSDxmdz.js","_app/immutable/chunks/BxSQOaYs.js","_app/immutable/chunks/BSCCGAI-.js","_app/immutable/chunks/D4Lq2K88.js","_app/immutable/chunks/DlMwcRc1.js","_app/immutable/chunks/D-EOR8DE.js","_app/immutable/chunks/BhoT7I6e.js"];
export const stylesheets = ["_app/immutable/assets/9.gZNFl5CG.css"];
export const fonts = [];
