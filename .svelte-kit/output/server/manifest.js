export const manifest = (() => {
function __memo(fn) {
	let value;
	return () => value ??= (value = fn());
}

return {
	appDir: "_app",
	appPath: "_app",
	assets: new Set(["bfa-logo.png","early2023.json","robots.txt","season_matchups/2022.json","season_matchups/2023.json","season_matchups/2024.json","svelte-welcome.webp","week-ranges.json"]),
	mimeTypes: {".png":"image/png",".json":"application/json",".txt":"text/plain",".webp":"image/webp"},
	_: {
		client: {start:"_app/immutable/entry/start.CiHDU-6t.js",app:"_app/immutable/entry/app.Cfa3LAlM.js",imports:["_app/immutable/entry/start.CiHDU-6t.js","_app/immutable/chunks/DSv5oulv.js","_app/immutable/chunks/BDSDxmdz.js","_app/immutable/chunks/5RPAvU3Z.js","_app/immutable/entry/app.Cfa3LAlM.js","_app/immutable/chunks/BDSDxmdz.js","_app/immutable/chunks/wFSdZPMz.js","_app/immutable/chunks/5RPAvU3Z.js","_app/immutable/chunks/fHSaLAo5.js","_app/immutable/chunks/D-EOR8DE.js","_app/immutable/chunks/1aRFUTeY.js","_app/immutable/chunks/HEhdmvfu.js"],stylesheets:[],fonts:[],uses_env_dynamic_public:false},
		nodes: [
			__memo(() => import('./nodes/0.js')),
			__memo(() => import('./nodes/1.js')),
			__memo(() => import('./nodes/3.js')),
			__memo(() => import('./nodes/4.js')),
			__memo(() => import('./nodes/5.js')),
			__memo(() => import('./nodes/6.js')),
			__memo(() => import('./nodes/7.js')),
			__memo(() => import('./nodes/8.js')),
			__memo(() => import('./nodes/9.js')),
			__memo(() => import('./nodes/10.js'))
		],
		remotes: {
			
		},
		routes: [
			{
				id: "/_diag",
				pattern: /^\/_diag\/?$/,
				params: [],
				page: null,
				endpoint: __memo(() => import('./entries/endpoints/_diag/_server.js'))
			},
			{
				id: "/_minimal",
				pattern: /^\/_minimal\/?$/,
				params: [],
				page: { layouts: [0,], errors: [1,], leaf: 2 },
				endpoint: null
			},
			{
				id: "/admin/generate-season-matchups",
				pattern: /^\/admin\/generate-season-matchups\/?$/,
				params: [],
				page: { layouts: [0,], errors: [1,], leaf: 3 },
				endpoint: null
			},
			{
				id: "/honor-hall",
				pattern: /^\/honor-hall\/?$/,
				params: [],
				page: { layouts: [0,], errors: [1,], leaf: 4 },
				endpoint: null
			},
			{
				id: "/matchups",
				pattern: /^\/matchups\/?$/,
				params: [],
				page: { layouts: [0,], errors: [1,], leaf: 5 },
				endpoint: null
			},
			{
				id: "/records-player",
				pattern: /^\/records-player\/?$/,
				params: [],
				page: { layouts: [0,], errors: [1,], leaf: 6 },
				endpoint: null
			},
			{
				id: "/records-team",
				pattern: /^\/records-team\/?$/,
				params: [],
				page: { layouts: [0,], errors: [1,], leaf: 7 },
				endpoint: null
			},
			{
				id: "/rosters",
				pattern: /^\/rosters\/?$/,
				params: [],
				page: { layouts: [0,], errors: [1,], leaf: 8 },
				endpoint: null
			},
			{
				id: "/standings",
				pattern: /^\/standings\/?$/,
				params: [],
				page: { layouts: [0,], errors: [1,], leaf: 9 },
				endpoint: null
			}
		],
		prerendered_routes: new Set(["/"]),
		matchers: async () => {
			
			return {  };
		},
		server_assets: {}
	}
}
})();
