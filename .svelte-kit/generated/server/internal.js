
import root from '../root.js';
import { set_building, set_prerendering } from '__sveltekit/environment';
import { set_assets } from '$app/paths/internal/server';
import { set_manifest, set_read_implementation } from '__sveltekit/server';
import { set_private_env, set_public_env } from '../../../node_modules/@sveltejs/kit/src/runtime/shared-server.js';

export const options = {
	app_template_contains_nonce: false,
	async: false,
	csp: {"mode":"auto","directives":{"upgrade-insecure-requests":false,"block-all-mixed-content":false},"reportOnly":{"upgrade-insecure-requests":false,"block-all-mixed-content":false}},
	csrf_check_origin: true,
	csrf_trusted_origins: [],
	embedded: false,
	env_public_prefix: 'PUBLIC_',
	env_private_prefix: '',
	hash_routing: false,
	hooks: null, // added lazily, via `get_hooks`
	preload_strategy: "modulepreload",
	root,
	service_worker: false,
	service_worker_options: undefined,
	server_error_boundaries: false,
	templates: {
		app: ({ head, body, assets, nonce, env }) => "<!DOCTYPE html>\n<html lang=\"en\">\n  <head>\n    <meta charset=\"utf-8\" />\n    <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\" />\n\n    <!-- Primary Meta Tags -->\n    <title>Badger Fantasy Association | Fantasy Basketball League</title>\n    <meta name=\"title\" content=\"Badger Fantasy Association | Fantasy Basketball League\" />\n    <meta\n      name=\"description\"\n      content=\"Official home of the Badger Fantasy Association — track rosters, standings, matchups, records, and player stats for our fantasy basketball league powered by Sleeper.\"\n    />\n    <meta\n      name=\"keywords\"\n      content=\"fantasy basketball, BFA, Badger Fantasy, sleeper league, fantasy sports, basketball stats, NBA fantasy\"\n    />\n    <meta name=\"author\" content=\"Badger Fantasy Association\" />\n\n    <!-- Favicon -->\n    <link rel=\"icon\" href=\"" + assets + "/bfa-logo.png\" />\n    <link rel=\"apple-touch-icon\" href=\"" + assets + "/bfa-logo.png\" />\n\n    <!-- Open Graph -->\n    <meta property=\"og:type\" content=\"website\" />\n    <meta property=\"og:url\" content=\"https://bfa-website.vercel.app/\" />\n    <meta property=\"og:title\" content=\"Badger Fantasy Association | Fantasy Basketball League\" />\n    <meta\n      property=\"og:description\"\n      content=\"Track rosters, standings, matchups and player stats for our fantasy basketball league powered by Sleeper.\"\n    />\n    <meta property=\"og:image\" content=\"" + assets + "/bfa-logo.png\" />\n    <meta property=\"og:site_name\" content=\"Badger Fantasy Association\" />\n\n    <!-- Twitter Card -->\n    <meta name=\"twitter:card\" content=\"summary_large_image\" />\n    <meta name=\"twitter:title\" content=\"Badger Fantasy Association | Fantasy Basketball League\" />\n    <meta\n      name=\"twitter:description\"\n      content=\"Track rosters, standings, matchups and player stats for our fantasy basketball league powered by Sleeper.\"\n    />\n    <meta name=\"twitter:image\" content=\"" + assets + "/bfa-logo.png\" />\n\n    <!-- Theme & SEO -->\n    <meta name=\"theme-color\" content=\"#07070d\" />\n    <meta name=\"robots\" content=\"index, follow\" />\n    <link rel=\"canonical\" href=\"https://bfa-website.vercel.app/\" />\n\n    <!-- Fonts: Bebas Neue (display) + Outfit (body). Strictly NO Inter/Roboto. -->\n    <link rel=\"preconnect\" href=\"https://fonts.googleapis.com\" />\n    <link rel=\"preconnect\" href=\"https://fonts.gstatic.com\" crossorigin />\n    <link\n      href=\"https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Outfit:wght@300;400;500;600;700;800;900&display=swap\"\n      rel=\"stylesheet\"\n    />\n\n    <!-- Structured Data -->\n    <script type=\"application/ld+json\">\n      {\n        \"@context\": \"https://schema.org\",\n        \"@type\": \"SportsOrganization\",\n        \"name\": \"Badger Fantasy Association\",\n        \"description\": \"Fantasy Basketball League powered by Sleeper\",\n        \"url\": \"https://bfa-website.vercel.app/\",\n        \"logo\": \"" + assets + "/bfa-logo.png\",\n        \"sport\": \"Basketball\"\n      }\n    </script>\n\n    " + head + "\n  </head>\n  <body data-sveltekit-preload-data=\"hover\">\n    <div style=\"display:contents\">" + body + "</div>\n  </body>\n</html>\n",
		error: ({ status, message }) => "<!doctype html>\n<html lang=\"en\">\n\t<head>\n\t\t<meta charset=\"utf-8\" />\n\t\t<title>" + message + "</title>\n\n\t\t<style>\n\t\t\tbody {\n\t\t\t\t--bg: white;\n\t\t\t\t--fg: #222;\n\t\t\t\t--divider: #ccc;\n\t\t\t\tbackground: var(--bg);\n\t\t\t\tcolor: var(--fg);\n\t\t\t\tfont-family:\n\t\t\t\t\tsystem-ui,\n\t\t\t\t\t-apple-system,\n\t\t\t\t\tBlinkMacSystemFont,\n\t\t\t\t\t'Segoe UI',\n\t\t\t\t\tRoboto,\n\t\t\t\t\tOxygen,\n\t\t\t\t\tUbuntu,\n\t\t\t\t\tCantarell,\n\t\t\t\t\t'Open Sans',\n\t\t\t\t\t'Helvetica Neue',\n\t\t\t\t\tsans-serif;\n\t\t\t\tdisplay: flex;\n\t\t\t\talign-items: center;\n\t\t\t\tjustify-content: center;\n\t\t\t\theight: 100vh;\n\t\t\t\tmargin: 0;\n\t\t\t}\n\n\t\t\t.error {\n\t\t\t\tdisplay: flex;\n\t\t\t\talign-items: center;\n\t\t\t\tmax-width: 32rem;\n\t\t\t\tmargin: 0 1rem;\n\t\t\t}\n\n\t\t\t.status {\n\t\t\t\tfont-weight: 200;\n\t\t\t\tfont-size: 3rem;\n\t\t\t\tline-height: 1;\n\t\t\t\tposition: relative;\n\t\t\t\ttop: -0.05rem;\n\t\t\t}\n\n\t\t\t.message {\n\t\t\t\tborder-left: 1px solid var(--divider);\n\t\t\t\tpadding: 0 0 0 1rem;\n\t\t\t\tmargin: 0 0 0 1rem;\n\t\t\t\tmin-height: 2.5rem;\n\t\t\t\tdisplay: flex;\n\t\t\t\talign-items: center;\n\t\t\t}\n\n\t\t\t.message h1 {\n\t\t\t\tfont-weight: 400;\n\t\t\t\tfont-size: 1em;\n\t\t\t\tmargin: 0;\n\t\t\t}\n\n\t\t\t@media (prefers-color-scheme: dark) {\n\t\t\t\tbody {\n\t\t\t\t\t--bg: #222;\n\t\t\t\t\t--fg: #ddd;\n\t\t\t\t\t--divider: #666;\n\t\t\t\t}\n\t\t\t}\n\t\t</style>\n\t</head>\n\t<body>\n\t\t<div class=\"error\">\n\t\t\t<span class=\"status\">" + status + "</span>\n\t\t\t<div class=\"message\">\n\t\t\t\t<h1>" + message + "</h1>\n\t\t\t</div>\n\t\t</div>\n\t</body>\n</html>\n"
	},
	version_hash: "nlmpgb"
};

export async function get_hooks() {
	let handle;
	let handleFetch;
	let handleError;
	let handleValidationError;
	let init;
	

	let reroute;
	let transport;
	({ reroute, transport } = await import("../../../src/hooks.js"));

	return {
		handle,
		handleFetch,
		handleError,
		handleValidationError,
		init,
		reroute,
		transport
	};
}

export { set_assets, set_building, set_manifest, set_prerendering, set_private_env, set_public_env, set_read_implementation };
