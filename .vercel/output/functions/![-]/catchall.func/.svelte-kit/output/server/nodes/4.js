import * as server from '../entries/pages/admin/generate-season-matchups/_page.server.js';

export const index = 4;
let component_cache;
export const component = async () => component_cache ??= (await import('../entries/pages/admin/generate-season-matchups/_page.svelte.js')).default;
export { server };
export const server_id = "src/routes/admin/generate-season-matchups/+page.server.js";
export const imports = ["_app/immutable/nodes/4.GlqlL76e.js","_app/immutable/chunks/wFSdZPMz.js","_app/immutable/chunks/BDSDxmdz.js","_app/immutable/chunks/DDxaThq2.js","_app/immutable/chunks/fHSaLAo5.js","_app/immutable/chunks/CLe4UV08.js","_app/immutable/chunks/1aRFUTeY.js","_app/immutable/chunks/HEhdmvfu.js"];
export const stylesheets = ["_app/immutable/assets/4.Vf24LGHt.css"];
export const fonts = [];
