import * as server from '../entries/pages/_minimal/_page.server.js';

export const index = 3;
let component_cache;
export const component = async () => component_cache ??= (await import('../entries/pages/_minimal/_page.svelte.js')).default;
export { server };
export const server_id = "src/routes/_minimal/+page.server.js";
export const imports = ["_app/immutable/nodes/3.BbsWiHh1.js","_app/immutable/chunks/wFSdZPMz.js","_app/immutable/chunks/BDSDxmdz.js","_app/immutable/chunks/DDxaThq2.js","_app/immutable/chunks/1aRFUTeY.js","_app/immutable/chunks/HEhdmvfu.js"];
export const stylesheets = [];
export const fonts = [];
