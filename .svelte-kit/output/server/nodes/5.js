import * as server from '../entries/pages/honor-hall/_page.server.js';

export const index = 5;
let component_cache;
export const component = async () => component_cache ??= (await import('../entries/pages/honor-hall/_page.svelte.js')).default;
export { server };
export const server_id = "src/routes/honor-hall/+page.server.js";
export const imports = ["_app/immutable/nodes/5.Cdmma5n8.js","_app/immutable/chunks/wFSdZPMz.js","_app/immutable/chunks/BDSDxmdz.js","_app/immutable/chunks/DDxaThq2.js","_app/immutable/chunks/fHSaLAo5.js","_app/immutable/chunks/CLe4UV08.js","_app/immutable/chunks/D4Lq2K88.js","_app/immutable/chunks/1aRFUTeY.js","_app/immutable/chunks/HEhdmvfu.js"];
export const stylesheets = ["_app/immutable/assets/5.BJ7mi084.css"];
export const fonts = [];
