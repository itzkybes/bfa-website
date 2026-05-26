import * as server from '../entries/pages/records-player/_page.server.js';

export const index = 6;
let component_cache;
export const component = async () => component_cache ??= (await import('../entries/pages/records-player/_page.svelte.js')).default;
export { server };
export const server_id = "src/routes/records-player/+page.server.js";
export const imports = ["_app/immutable/nodes/6.DOyqAzsq.js","_app/immutable/chunks/DfsLyd9G.js","_app/immutable/chunks/BDSDxmdz.js","_app/immutable/chunks/BxSQOaYs.js","_app/immutable/chunks/BSCCGAI-.js","_app/immutable/chunks/BhoT7I6e.js"];
export const stylesheets = ["_app/immutable/assets/6.DlxIs7-K.css"];
export const fonts = [];
