import * as server from '../entries/pages/matchups/_page.server.js';

export const index = 6;
let component_cache;
export const component = async () => component_cache ??= (await import('../entries/pages/matchups/_page.svelte.js')).default;
export { server };
export const server_id = "src/routes/matchups/+page.server.js";
export const imports = ["_app/immutable/nodes/6.CyZ_8O4e.js","_app/immutable/chunks/wFSdZPMz.js","_app/immutable/chunks/BDSDxmdz.js","_app/immutable/chunks/DDxaThq2.js","_app/immutable/chunks/fHSaLAo5.js","_app/immutable/chunks/CLe4UV08.js","_app/immutable/chunks/D4Lq2K88.js","_app/immutable/chunks/CKLjWkrU.js","_app/immutable/chunks/1aRFUTeY.js","_app/immutable/chunks/HEhdmvfu.js"];
export const stylesheets = ["_app/immutable/assets/6.BXm_Wpel.css"];
export const fonts = [];
