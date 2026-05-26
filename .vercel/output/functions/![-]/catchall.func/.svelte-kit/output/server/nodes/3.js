

export const index = 3;
let component_cache;
export const component = async () => component_cache ??= (await import('../entries/pages/admin/generate-season-matchups/_page.svelte.js')).default;
export const universal = {
  "ssr": false,
  "prerender": false
};
export const universal_id = "src/routes/admin/generate-season-matchups/+page.js";
export const imports = ["_app/immutable/nodes/3.DxyLo09D.js","_app/immutable/chunks/DT0STw8n.js","_app/immutable/chunks/rirFhRDB.js","_app/immutable/chunks/DMD6_Ozy.js","_app/immutable/chunks/BKpfD0_n.js","_app/immutable/chunks/sSlrw8y5.js","_app/immutable/chunks/C5WyGLd2.js","_app/immutable/chunks/wrzB25xg.js","_app/immutable/chunks/ioCfQEc3.js","_app/immutable/chunks/hTadKceH.js","_app/immutable/chunks/W4yEOYLd.js"];
export const stylesheets = ["_app/immutable/assets/ErrorBoundary.WJ52EDRQ.css","_app/immutable/assets/3.Vf24LGHt.css"];
export const fonts = [];
