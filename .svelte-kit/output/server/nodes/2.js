import * as universal from '../entries/pages/_page.js';

export const index = 2;
let component_cache;
export const component = async () => component_cache ??= (await import('../entries/pages/_page.svelte.js')).default;
export { universal };
export const universal_id = "src/routes/+page.js";
export const imports = ["_app/immutable/nodes/2.BOkCmSsz.js","_app/immutable/chunks/DfsLyd9G.js","_app/immutable/chunks/BDSDxmdz.js","_app/immutable/chunks/BxSQOaYs.js","_app/immutable/chunks/5RPAvU3Z.js","_app/immutable/chunks/BSCCGAI-.js","_app/immutable/chunks/D4Lq2K88.js","_app/immutable/chunks/CKLjWkrU.js","_app/immutable/chunks/BhoT7I6e.js"];
export const stylesheets = ["_app/immutable/assets/2.0H2i-VuM.css"];
export const fonts = [];
