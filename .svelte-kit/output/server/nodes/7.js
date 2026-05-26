import * as server from '../entries/pages/records-team/_page.server.js';

export const index = 7;
let component_cache;
export const component = async () => component_cache ??= (await import('../entries/pages/records-team/_page.svelte.js')).default;
export { server };
export const server_id = "src/routes/records-team/+page.server.js";
export const imports = ["_app/immutable/nodes/7.9H1kG3YT.js","_app/immutable/chunks/DfsLyd9G.js","_app/immutable/chunks/BDSDxmdz.js","_app/immutable/chunks/BxSQOaYs.js","_app/immutable/chunks/BSCCGAI-.js","_app/immutable/chunks/D4Lq2K88.js","_app/immutable/chunks/DlMwcRc1.js","_app/immutable/chunks/BhoT7I6e.js"];
export const stylesheets = ["_app/immutable/assets/7.QwZ4Xn15.css"];
export const fonts = [];
