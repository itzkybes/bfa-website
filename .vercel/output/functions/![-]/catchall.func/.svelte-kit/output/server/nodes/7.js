import * as server from '../entries/pages/records-player/_page.server.js';

export const index = 7;
let component_cache;
export const component = async () => component_cache ??= (await import('../entries/pages/records-player/_page.svelte.js')).default;
export { server };
export const server_id = "src/routes/records-player/+page.server.js";
export const imports = ["_app/immutable/nodes/7.CvDCzrsi.js","_app/immutable/chunks/wFSdZPMz.js","_app/immutable/chunks/BDSDxmdz.js","_app/immutable/chunks/DDxaThq2.js","_app/immutable/chunks/fHSaLAo5.js","_app/immutable/chunks/CLe4UV08.js","_app/immutable/chunks/1aRFUTeY.js","_app/immutable/chunks/HEhdmvfu.js"];
export const stylesheets = ["_app/immutable/assets/7.DlxIs7-K.css"];
export const fonts = [];
