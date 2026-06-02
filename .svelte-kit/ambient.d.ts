
// this file is generated — do not edit it


/// <reference types="@sveltejs/kit" />

/**
 * This module provides access to environment variables that are injected _statically_ into your bundle at build time and are limited to _private_ access.
 * 
 * |         | Runtime                                                                    | Build time                                                               |
 * | ------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
 * | Private | [`$env/dynamic/private`](https://svelte.dev/docs/kit/$env-dynamic-private) | [`$env/static/private`](https://svelte.dev/docs/kit/$env-static-private) |
 * | Public  | [`$env/dynamic/public`](https://svelte.dev/docs/kit/$env-dynamic-public)   | [`$env/static/public`](https://svelte.dev/docs/kit/$env-static-public)   |
 * 
 * Static environment variables are [loaded by Vite](https://vitejs.dev/guide/env-and-mode.html#env-files) from `.env` files and `process.env` at build time and then statically injected into your bundle at build time, enabling optimisations like dead code elimination.
 * 
 * **_Private_ access:**
 * 
 * - This module cannot be imported into client-side code
 * - This module only includes variables that _do not_ begin with [`config.kit.env.publicPrefix`](https://svelte.dev/docs/kit/configuration#env) _and do_ start with [`config.kit.env.privatePrefix`](https://svelte.dev/docs/kit/configuration#env) (if configured)
 * 
 * For example, given the following build time environment:
 * 
 * ```env
 * ENVIRONMENT=production
 * PUBLIC_BASE_URL=http://site.com
 * ```
 * 
 * With the default `publicPrefix` and `privatePrefix`:
 * 
 * ```ts
 * import { ENVIRONMENT, PUBLIC_BASE_URL } from '$env/static/private';
 * 
 * console.log(ENVIRONMENT); // => "production"
 * console.log(PUBLIC_BASE_URL); // => throws error during build
 * ```
 * 
 * The above values will be the same _even if_ different values for `ENVIRONMENT` or `PUBLIC_BASE_URL` are set at runtime, as they are statically replaced in your code with their build time values.
 */
declare module '$env/static/private' {
	export const KUBERNETES_SERVICE_PORT: string;
	export const NGROK_AUTHTOKEN: string;
	export const KUBERNETES_PORT: string;
	export const npm_package_devDependencies__sveltejs_adapter_vercel: string;
	export const npm_config_version_commit_hooks: string;
	export const npm_config_user_agent: string;
	export const CHROME_PATH: string;
	export const NODE_VERSION: string;
	export const PUPPETEER_SKIP_CHROMIUM_DOWNLOAD: string;
	export const npm_config_bin_links: string;
	export const HOSTNAME: string;
	export const npm_node_execpath: string;
	export const npm_package_devDependencies_vite: string;
	export const npm_package_devDependencies__sveltejs_vite_plugin_svelte: string;
	export const npm_config_init_version: string;
	export const SHLVL: string;
	export const HOME: string;
	export const OLDPWD: string;
	export const PLAYWRIGHT_CHROME_EXECUTABLE_PATH: string;
	export const monitor_polling_interval: string;
	export const PYTHONUNBUFFERED: string;
	export const run_id: string;
	export const npm_package_engines_node: string;
	export const npm_config_init_license: string;
	export const PUPPETEER_EXECUTABLE_PATH: string;
	export const GPG_KEY: string;
	export const YARN_WRAP_OUTPUT: string;
	export const npm_package_devDependencies_svelte_check: string;
	export const npm_config_version_tag_prefix: string;
	export const job_id: string;
	export const npm_package_scripts_check: string;
	export const PYTHON_SHA256: string;
	export const preview_endpoint: string;
	export const npm_package_description: string;
	export const npm_package_devDependencies_typescript: string;
	export const npm_package_readmeFilename: string;
	export const npm_package_devDependencies_prettier: string;
	export const npm_package_scripts_dev: string;
	export const npm_package_type: string;
	export const _: string;
	export const npm_package_scripts_check_watch: string;
	export const npm_package_private: string;
	export const npm_package_devDependencies__types_cookie: string;
	export const npm_package_scripts_lint: string;
	export const npm_config_registry: string;
	export const PLUGIN_VENV_PATH: string;
	export const KUBERNETES_PORT_443_TCP_ADDR: string;
	export const npm_config_ignore_scripts: string;
	export const PATH: string;
	export const NODE: string;
	export const NEXT_TELEMETRY_DISABLED: string;
	export const npm_package_name: string;
	export const STRIPE_API_KEY: string;
	export const PLAYWRIGHT_BROWSERS_PATH: string;
	export const KUBERNETES_PORT_443_TCP_PORT: string;
	export const KUBERNETES_PORT_443_TCP_PROTO: string;
	export const LANG: string;
	export const UV_COMPILE_BYTECODE: string;
	export const npm_lifecycle_script: string;
	export const code_server_password: string;
	export const DEBIAN_FRONTEND: string;
	export const npm_package_devDependencies__sveltejs_kit: string;
	export const npm_config_version_git_message: string;
	export const npm_lifecycle_event: string;
	export const npm_package_version: string;
	export const PYTHON_VERSION: string;
	export const npm_config_argv: string;
	export const npm_package_dependencies_cookie: string;
	export const npm_package_devDependencies_svelte: string;
	export const npm_package_scripts_build: string;
	export const npm_config_version_git_tag: string;
	export const npm_config_version_git_sign: string;
	export const KUBERNETES_SERVICE_PORT_HTTPS: string;
	export const KUBERNETES_PORT_443_TCP: string;
	export const npm_config_strict_ssl: string;
	export const VIRTUAL_ENV: string;
	export const npm_package_scripts_format: string;
	export const PWD: string;
	export const ENABLE_RELOAD: string;
	export const KUBERNETES_SERVICE_HOST: string;
	export const npm_execpath: string;
	export const base_url: string;
	export const npm_package_dependencies__fontsource_fira_mono: string;
	export const npm_config_save_prefix: string;
	export const npm_config_ignore_optional: string;
	export const integration_proxy_url: string;
	export const npm_package_devDependencies_prettier_plugin_svelte: string;
	export const npm_package_scripts_preview: string;
	export const PIP_NO_INPUT: string;
	export const npm_package_dependencies_web_vitals: string;
	export const INIT_CWD: string;
	export const NODE_ENV: string;
}

/**
 * This module provides access to environment variables that are injected _statically_ into your bundle at build time and are _publicly_ accessible.
 * 
 * |         | Runtime                                                                    | Build time                                                               |
 * | ------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
 * | Private | [`$env/dynamic/private`](https://svelte.dev/docs/kit/$env-dynamic-private) | [`$env/static/private`](https://svelte.dev/docs/kit/$env-static-private) |
 * | Public  | [`$env/dynamic/public`](https://svelte.dev/docs/kit/$env-dynamic-public)   | [`$env/static/public`](https://svelte.dev/docs/kit/$env-static-public)   |
 * 
 * Static environment variables are [loaded by Vite](https://vitejs.dev/guide/env-and-mode.html#env-files) from `.env` files and `process.env` at build time and then statically injected into your bundle at build time, enabling optimisations like dead code elimination.
 * 
 * **_Public_ access:**
 * 
 * - This module _can_ be imported into client-side code
 * - **Only** variables that begin with [`config.kit.env.publicPrefix`](https://svelte.dev/docs/kit/configuration#env) (which defaults to `PUBLIC_`) are included
 * 
 * For example, given the following build time environment:
 * 
 * ```env
 * ENVIRONMENT=production
 * PUBLIC_BASE_URL=http://site.com
 * ```
 * 
 * With the default `publicPrefix` and `privatePrefix`:
 * 
 * ```ts
 * import { ENVIRONMENT, PUBLIC_BASE_URL } from '$env/static/public';
 * 
 * console.log(ENVIRONMENT); // => throws error during build
 * console.log(PUBLIC_BASE_URL); // => "http://site.com"
 * ```
 * 
 * The above values will be the same _even if_ different values for `ENVIRONMENT` or `PUBLIC_BASE_URL` are set at runtime, as they are statically replaced in your code with their build time values.
 */
declare module '$env/static/public' {
	
}

/**
 * This module provides access to environment variables set _dynamically_ at runtime and that are limited to _private_ access.
 * 
 * |         | Runtime                                                                    | Build time                                                               |
 * | ------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
 * | Private | [`$env/dynamic/private`](https://svelte.dev/docs/kit/$env-dynamic-private) | [`$env/static/private`](https://svelte.dev/docs/kit/$env-static-private) |
 * | Public  | [`$env/dynamic/public`](https://svelte.dev/docs/kit/$env-dynamic-public)   | [`$env/static/public`](https://svelte.dev/docs/kit/$env-static-public)   |
 * 
 * Dynamic environment variables are defined by the platform you're running on. For example if you're using [`adapter-node`](https://github.com/sveltejs/kit/tree/main/packages/adapter-node) (or running [`vite preview`](https://svelte.dev/docs/kit/cli)), this is equivalent to `process.env`.
 * 
 * **_Private_ access:**
 * 
 * - This module cannot be imported into client-side code
 * - This module includes variables that _do not_ begin with [`config.kit.env.publicPrefix`](https://svelte.dev/docs/kit/configuration#env) _and do_ start with [`config.kit.env.privatePrefix`](https://svelte.dev/docs/kit/configuration#env) (if configured)
 * 
 * > [!NOTE] In `dev`, `$env/dynamic` includes environment variables from `.env`. In `prod`, this behavior will depend on your adapter.
 * 
 * > [!NOTE] To get correct types, environment variables referenced in your code should be declared (for example in an `.env` file), even if they don't have a value until the app is deployed:
 * >
 * > ```env
 * > MY_FEATURE_FLAG=
 * > ```
 * >
 * > You can override `.env` values from the command line like so:
 * >
 * > ```sh
 * > MY_FEATURE_FLAG="enabled" npm run dev
 * > ```
 * 
 * For example, given the following runtime environment:
 * 
 * ```env
 * ENVIRONMENT=production
 * PUBLIC_BASE_URL=http://site.com
 * ```
 * 
 * With the default `publicPrefix` and `privatePrefix`:
 * 
 * ```ts
 * import { env } from '$env/dynamic/private';
 * 
 * console.log(env.ENVIRONMENT); // => "production"
 * console.log(env.PUBLIC_BASE_URL); // => undefined
 * ```
 */
declare module '$env/dynamic/private' {
	export const env: {
		KUBERNETES_SERVICE_PORT: string;
		NGROK_AUTHTOKEN: string;
		KUBERNETES_PORT: string;
		npm_package_devDependencies__sveltejs_adapter_vercel: string;
		npm_config_version_commit_hooks: string;
		npm_config_user_agent: string;
		CHROME_PATH: string;
		NODE_VERSION: string;
		PUPPETEER_SKIP_CHROMIUM_DOWNLOAD: string;
		npm_config_bin_links: string;
		HOSTNAME: string;
		npm_node_execpath: string;
		npm_package_devDependencies_vite: string;
		npm_package_devDependencies__sveltejs_vite_plugin_svelte: string;
		npm_config_init_version: string;
		SHLVL: string;
		HOME: string;
		OLDPWD: string;
		PLAYWRIGHT_CHROME_EXECUTABLE_PATH: string;
		monitor_polling_interval: string;
		PYTHONUNBUFFERED: string;
		run_id: string;
		npm_package_engines_node: string;
		npm_config_init_license: string;
		PUPPETEER_EXECUTABLE_PATH: string;
		GPG_KEY: string;
		YARN_WRAP_OUTPUT: string;
		npm_package_devDependencies_svelte_check: string;
		npm_config_version_tag_prefix: string;
		job_id: string;
		npm_package_scripts_check: string;
		PYTHON_SHA256: string;
		preview_endpoint: string;
		npm_package_description: string;
		npm_package_devDependencies_typescript: string;
		npm_package_readmeFilename: string;
		npm_package_devDependencies_prettier: string;
		npm_package_scripts_dev: string;
		npm_package_type: string;
		_: string;
		npm_package_scripts_check_watch: string;
		npm_package_private: string;
		npm_package_devDependencies__types_cookie: string;
		npm_package_scripts_lint: string;
		npm_config_registry: string;
		PLUGIN_VENV_PATH: string;
		KUBERNETES_PORT_443_TCP_ADDR: string;
		npm_config_ignore_scripts: string;
		PATH: string;
		NODE: string;
		NEXT_TELEMETRY_DISABLED: string;
		npm_package_name: string;
		STRIPE_API_KEY: string;
		PLAYWRIGHT_BROWSERS_PATH: string;
		KUBERNETES_PORT_443_TCP_PORT: string;
		KUBERNETES_PORT_443_TCP_PROTO: string;
		LANG: string;
		UV_COMPILE_BYTECODE: string;
		npm_lifecycle_script: string;
		code_server_password: string;
		DEBIAN_FRONTEND: string;
		npm_package_devDependencies__sveltejs_kit: string;
		npm_config_version_git_message: string;
		npm_lifecycle_event: string;
		npm_package_version: string;
		PYTHON_VERSION: string;
		npm_config_argv: string;
		npm_package_dependencies_cookie: string;
		npm_package_devDependencies_svelte: string;
		npm_package_scripts_build: string;
		npm_config_version_git_tag: string;
		npm_config_version_git_sign: string;
		KUBERNETES_SERVICE_PORT_HTTPS: string;
		KUBERNETES_PORT_443_TCP: string;
		npm_config_strict_ssl: string;
		VIRTUAL_ENV: string;
		npm_package_scripts_format: string;
		PWD: string;
		ENABLE_RELOAD: string;
		KUBERNETES_SERVICE_HOST: string;
		npm_execpath: string;
		base_url: string;
		npm_package_dependencies__fontsource_fira_mono: string;
		npm_config_save_prefix: string;
		npm_config_ignore_optional: string;
		integration_proxy_url: string;
		npm_package_devDependencies_prettier_plugin_svelte: string;
		npm_package_scripts_preview: string;
		PIP_NO_INPUT: string;
		npm_package_dependencies_web_vitals: string;
		INIT_CWD: string;
		NODE_ENV: string;
		[key: `PUBLIC_${string}`]: undefined;
		[key: `${string}`]: string | undefined;
	}
}

/**
 * This module provides access to environment variables set _dynamically_ at runtime and that are _publicly_ accessible.
 * 
 * |         | Runtime                                                                    | Build time                                                               |
 * | ------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
 * | Private | [`$env/dynamic/private`](https://svelte.dev/docs/kit/$env-dynamic-private) | [`$env/static/private`](https://svelte.dev/docs/kit/$env-static-private) |
 * | Public  | [`$env/dynamic/public`](https://svelte.dev/docs/kit/$env-dynamic-public)   | [`$env/static/public`](https://svelte.dev/docs/kit/$env-static-public)   |
 * 
 * Dynamic environment variables are defined by the platform you're running on. For example if you're using [`adapter-node`](https://github.com/sveltejs/kit/tree/main/packages/adapter-node) (or running [`vite preview`](https://svelte.dev/docs/kit/cli)), this is equivalent to `process.env`.
 * 
 * **_Public_ access:**
 * 
 * - This module _can_ be imported into client-side code
 * - **Only** variables that begin with [`config.kit.env.publicPrefix`](https://svelte.dev/docs/kit/configuration#env) (which defaults to `PUBLIC_`) are included
 * 
 * > [!NOTE] In `dev`, `$env/dynamic` includes environment variables from `.env`. In `prod`, this behavior will depend on your adapter.
 * 
 * > [!NOTE] To get correct types, environment variables referenced in your code should be declared (for example in an `.env` file), even if they don't have a value until the app is deployed:
 * >
 * > ```env
 * > MY_FEATURE_FLAG=
 * > ```
 * >
 * > You can override `.env` values from the command line like so:
 * >
 * > ```sh
 * > MY_FEATURE_FLAG="enabled" npm run dev
 * > ```
 * 
 * For example, given the following runtime environment:
 * 
 * ```env
 * ENVIRONMENT=production
 * PUBLIC_BASE_URL=http://example.com
 * ```
 * 
 * With the default `publicPrefix` and `privatePrefix`:
 * 
 * ```ts
 * import { env } from '$env/dynamic/public';
 * console.log(env.ENVIRONMENT); // => undefined, not public
 * console.log(env.PUBLIC_BASE_URL); // => "http://example.com"
 * ```
 * 
 * ```
 * 
 * ```
 */
declare module '$env/dynamic/public' {
	export const env: {
		[key: `PUBLIC_${string}`]: string | undefined;
	}
}
