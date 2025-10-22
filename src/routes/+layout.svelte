<script>
	import Header from '$lib/header/Header.svelte';
	import { webVitals } from '$lib/vitals';
	import { browser } from '$app/env';           // matches your kit version
	import { page } from '$app/stores';
	import '../app.css';

	let analyticsId = import.meta.env.VERCEL_ANALYTICS_ID;

	$: if (browser && analyticsId) {
		webVitals({
			path: $page.url.pathname,
			params: $page.params,
			analyticsId
		});
	}
</script>

<a class="skip-link" href="#content">Skip to content</a>

<Header />

<main id="content">
	<slot />
</main>

<footer>
	<div class="wrap footer-inner">
		<div class="footer-left">
			<p class="org">Badger Fantasy Association</p>
			<p class="small muted">© {new Date().getFullYear()}</p>
		</div>

		<nav class="footer-nav" aria-label="Footer links">
			<a href="/" aria-label="Home">Home</a>
			<a href="/rosters" aria-label="Rosters">Rosters</a>
			<a href="/standings" aria-label="Standings">Standings</a>
			<a href="/matchups" aria-label="Matchups">Matchups</a>
			<a href="https://sleeper.com/" target="_blank" rel="noreferrer" aria-label="Open Sleeper">Sleeper</a>
			<a href="https://docs.sleeper.app/" target="_blank" rel="noreferrer" aria-label="Open Sleeper API docs">Sleeper API</a>
		</nav>
	</div>
</footer>

<style>
	/* Base wrapper */
	.wrap {
		max-width: 1100px;
		margin: 0 auto;
		padding: 0 1rem;
		box-sizing: border-box;
	}

	/* Skip link — hidden until focused */
	.skip-link {
		position: absolute;
		left: -9999px;
		top: auto;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip: rect(0 0 0 0);
		white-space: nowrap;
	}
	.skip-link:focus,
	.skip-link:active {
		position: fixed;
		left: 1rem;
		top: 1rem;
		width: auto;
		height: auto;
		padding: 8px 12px;
		background: rgba(0,0,0,0.9);
		color: #fff;
		z-index: 9999;
		border-radius: 6px;
		text-decoration: none;
	}

	main#content {
		min-height: calc(100vh - 220px); /* keeps footer from overlapping on short pages */
	}

	/* Footer layout */
	footer {
		margin-top: 2.5rem;
		padding: 28px 0;
		background: transparent;
	}

	.footer-inner {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 1rem;
		flex-wrap: wrap;
	}

	.footer-left {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}

	footer .org {
		margin: 0;
		font-weight: 800;
		color: var(--nav-text, #e6eef6);
		font-size: 1rem;
	}

	footer .small {
		margin: 0;
		color: var(--muted, #9fb0c4);
		font-size: 0.9rem;
	}

	/* Footer nav links */
	.footer-nav {
		display: flex;
		gap: 12px;
		align-items: center;
		flex-wrap: wrap;
		justify-content: flex-end;
	}

	/* Make links clearly visible and touch-friendly */
	.footer-nav a {
		display: inline-block;
		padding: 10px 14px;
		border-radius: 10px;
		text-decoration: none;
		font-weight: 800;
		color: var(--nav-text, #e6eef6);           /* high contrast */
		background: rgba(255,255,255,0.03);       /* subtle pill */
		transition: background-color 140ms ease, transform 140ms ease, color 140ms ease;
		box-shadow: 0 2px 8px rgba(2,6,10,0.15);
	}

	.footer-nav a:hover,
	.footer-nav a:focus {
		background: linear-gradient(90deg, var(--accent, #00c6d8), var(--accent-dark, #008fa6));
		color: #071122;
		transform: translateY(-2px);
		outline: none;
		text-decoration: none;
	}

	/* Make sure the external links have a subtle icon affordance (visual only) */
	.footer-nav a[target="_blank"]::after {
		content: " ↗";
		font-size: 0.85em;
		opacity: 0.9;
		margin-left: 6px;
	}

	/* Mobile first adjustments */
	@media (max-width: 700px) {
		footer {
			padding: 18px 0;
		}

		.footer-inner {
			flex-direction: column;
			align-items: center;
			text-align: center;
		}

		.footer-nav {
			justify-content: center;
			gap: 10px;
		}

		.footer-nav a {
			padding: 12px 14px;
			font-size: 0.95rem;
		}
	}

	/* Global roster styles (preserved) */
	:global(.teams) {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
		gap: 3rem;
		justify-content: center;
		padding: 1rem 2rem;
	}

	:global(.team-card) {
		background: #0f1724;
		border-radius: 12px;
		padding: 1.5rem 1.5rem 2rem 1.5rem;
		box-shadow: 0 6px 18px rgba(3, 10, 20, 0.5);
		color: #fff;
		width: 100%;
	}

	:global(.player-top .left) {
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}

	:global(.pos-head) {
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}

	:global(.pos-pill) {
		min-width: 38px;
		height: 38px;
		border-radius: 10px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		font-weight: 700;
		color: #071122;
		box-shadow: 0 2px 6px rgba(0,0,0,0.5);
		font-size: 0.85rem;
	}

	:global(.headshot) {
		width: 44px;
		height: 44px;
		border-radius: 8px;
		object-fit: cover;
		box-shadow: 0 2px 6px rgba(0,0,0,0.6);
		border: 1px solid rgba(255,255,255,0.03);
	}

	@media (max-width: 520px) {
		:global(.teams) {
			padding: 0.5rem 1rem;
			gap: 1.5rem;
		}
	}
</style>
