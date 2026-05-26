import { r as root } from "./root.js";
import "./environment.js";
let public_env = {};
function set_private_env(environment) {
}
function set_public_env(environment) {
  public_env = environment;
}
let read_implementation = null;
function set_read_implementation(fn) {
  read_implementation = fn;
}
function set_manifest(_) {
}
const options = {
  app_template_contains_nonce: false,
  async: false,
  csp: { "mode": "auto", "directives": { "upgrade-insecure-requests": false, "block-all-mixed-content": false }, "reportOnly": { "upgrade-insecure-requests": false, "block-all-mixed-content": false } },
  csrf_check_origin: true,
  csrf_trusted_origins: [],
  embedded: false,
  env_public_prefix: "PUBLIC_",
  env_private_prefix: "",
  hash_routing: false,
  hooks: null,
  // added lazily, via `get_hooks`
  preload_strategy: "modulepreload",
  root,
  service_worker: false,
  service_worker_options: void 0,
  server_error_boundaries: false,
  templates: {
    app: ({ head, body, assets, nonce, env }) => '<!DOCTYPE html>\n<html lang="en">\n  <head>\n    <meta charset="utf-8" />\n    <meta name="viewport" content="width=device-width, initial-scale=1" />\n\n    <!-- Primary Meta Tags -->\n    <title>Badger Fantasy Association | Fantasy Basketball League</title>\n    <meta name="title" content="Badger Fantasy Association | Fantasy Basketball League" />\n    <meta\n      name="description"\n      content="Official home of the Badger Fantasy Association — track rosters, standings, matchups, records, and player stats for our fantasy basketball league powered by Sleeper."\n    />\n    <meta\n      name="keywords"\n      content="fantasy basketball, BFA, Badger Fantasy, sleeper league, fantasy sports, basketball stats, NBA fantasy"\n    />\n    <meta name="author" content="Badger Fantasy Association" />\n\n    <!-- Favicon -->\n    <link rel="icon" href="' + assets + '/bfa-logo.png" />\n    <link rel="apple-touch-icon" href="' + assets + '/bfa-logo.png" />\n\n    <!-- Open Graph -->\n    <meta property="og:type" content="website" />\n    <meta property="og:url" content="https://bfa-website.vercel.app/" />\n    <meta property="og:title" content="Badger Fantasy Association | Fantasy Basketball League" />\n    <meta\n      property="og:description"\n      content="Track rosters, standings, matchups and player stats for our fantasy basketball league powered by Sleeper."\n    />\n    <meta property="og:image" content="' + assets + '/bfa-logo.png" />\n    <meta property="og:site_name" content="Badger Fantasy Association" />\n\n    <!-- Twitter Card -->\n    <meta name="twitter:card" content="summary_large_image" />\n    <meta name="twitter:title" content="Badger Fantasy Association | Fantasy Basketball League" />\n    <meta\n      name="twitter:description"\n      content="Track rosters, standings, matchups and player stats for our fantasy basketball league powered by Sleeper."\n    />\n    <meta name="twitter:image" content="' + assets + '/bfa-logo.png" />\n\n    <!-- Theme & SEO -->\n    <meta name="theme-color" content="#07070d" />\n    <meta name="robots" content="index, follow" />\n    <link rel="canonical" href="https://bfa-website.vercel.app/" />\n\n    <!-- Fonts: Bebas Neue (display) + Outfit (body). Strictly NO Inter/Roboto. -->\n    <link rel="preconnect" href="https://fonts.googleapis.com" />\n    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />\n    <link\n      href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Outfit:wght@300;400;500;600;700;800;900&display=swap"\n      rel="stylesheet"\n    />\n\n    <!-- Structured Data -->\n    <script type="application/ld+json">\n      {\n        "@context": "https://schema.org",\n        "@type": "SportsOrganization",\n        "name": "Badger Fantasy Association",\n        "description": "Fantasy Basketball League powered by Sleeper",\n        "url": "https://bfa-website.vercel.app/",\n        "logo": "' + assets + '/bfa-logo.png",\n        "sport": "Basketball"\n      }\n    <\/script>\n\n    ' + head + '\n  </head>\n  <body data-sveltekit-preload-data="hover">\n    <div style="display:contents">' + body + "</div>\n  </body>\n</html>\n",
    error: ({ status, message }) => '<!doctype html>\n<html lang="en">\n	<head>\n		<meta charset="utf-8" />\n		<title>' + message + `</title>

		<style>
			body {
				--bg: white;
				--fg: #222;
				--divider: #ccc;
				background: var(--bg);
				color: var(--fg);
				font-family:
					system-ui,
					-apple-system,
					BlinkMacSystemFont,
					'Segoe UI',
					Roboto,
					Oxygen,
					Ubuntu,
					Cantarell,
					'Open Sans',
					'Helvetica Neue',
					sans-serif;
				display: flex;
				align-items: center;
				justify-content: center;
				height: 100vh;
				margin: 0;
			}

			.error {
				display: flex;
				align-items: center;
				max-width: 32rem;
				margin: 0 1rem;
			}

			.status {
				font-weight: 200;
				font-size: 3rem;
				line-height: 1;
				position: relative;
				top: -0.05rem;
			}

			.message {
				border-left: 1px solid var(--divider);
				padding: 0 0 0 1rem;
				margin: 0 0 0 1rem;
				min-height: 2.5rem;
				display: flex;
				align-items: center;
			}

			.message h1 {
				font-weight: 400;
				font-size: 1em;
				margin: 0;
			}

			@media (prefers-color-scheme: dark) {
				body {
					--bg: #222;
					--fg: #ddd;
					--divider: #666;
				}
			}
		</style>
	</head>
	<body>
		<div class="error">
			<span class="status">` + status + '</span>\n			<div class="message">\n				<h1>' + message + "</h1>\n			</div>\n		</div>\n	</body>\n</html>\n"
  },
  version_hash: "1bd6ra4"
};
async function get_hooks() {
  let handle;
  let handleFetch;
  let handleError;
  let handleValidationError;
  let init;
  let reroute;
  let transport;
  ({ reroute, transport } = await import("../entries/hooks.universal.js"));
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
export {
  set_private_env as a,
  set_public_env as b,
  set_read_implementation as c,
  get_hooks as g,
  options as o,
  public_env as p,
  read_implementation as r,
  set_manifest as s
};
