<script>
	import Header from '$lib/header/Header.svelte';
	import { webVitals } from '$lib/vitals';
	import { browser } from '$app/environment';
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

<!-- accessibility: quick skip link for screen readers / keyboard users -->
<a class="skip-link" href="#content">Skip to content</a>

<Header />

<!-- main content area for skip link -->
<main id="content">
	<slot />
</main>

<footer>
	<div class="wrap footer-inner">
		<div class="left">
			<p class="org">Badger Fantasy Association</p>
			<p class="credits"><a href="https://sleeper.com/" target="_blank" rel="noreferrer">Sleeper</a></p>
		</div>

		<!-- small helper area — keep future-proof if you want to add links -->
		<div class="right" aria-hidden="true">
			<!-- intentionally empty for now (could hold social links, copyright, etc.) -->
		</div>
	</div>
</footer>

<style>
	/* Basic layout wrapper (keeps consistent width) */
	.wrap {
		max-width: 1100px;
		margin: 0 auto;
		padding: 0 1rem;
		box-sizing: border-box;
	}

	/* Skip link — visually hidden but available on focus */
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

	/* Footer */
	footer {
		background: transparent;
		margin-top: 2.5rem;
		padding: 32px 0;
	}

	.footer-inner {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 1rem;
		flex-wrap: wrap;
	}

	footer .left {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}

	footer p {
		margin: 0;
		color: var(--muted, #9fb0c4);
		font-size: 0.95rem;
	}

	footer a {
		font-weight: 700;
		color: var(--accent, #00c6d8);
		text-decoration: none;
		padding: 8px 10px;
		border-radius: 8px;
		display: inline-block;
	}
	footer a:hover,
	footer a:focus {
		text-decoration: underline;
		outline: none;
	}

	/* Right column placeholder (keeps spacing consistent) */
	footer .right {
		display: flex;
		align-items: center;
		gap: 12px;
	}

	/* Mobile-first adjustments */
	@media (max-width: 700px) {
		footer {
			padding: 20px 0;
		}

		.footer-inner {
			flex-direction: column;
			align-items: center;
			text-align: center;
		}

		footer .left {
			align-items: center;
		}

		footer .right {
			/* hide placeholder on small screens to keep footer compact */
			display: none;
		}

		footer a {
			/* slightly larger tap area on mobile */
			padding: 10px 14px;
		}
	}

	/* Slightly smaller text on very small screens */
	@media (max-width: 420px) {
		footer p {
			font-size: 0.9rem;
		}
	}

	/* Global roster styles (kept from your original file) */
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

	/* Minor responsive refinement for roster grid padding on small screens */
	@media (max-width: 520px) {
		:global(.teams) {
			padding: 0.5rem 1rem;
			gap: 1.5rem;
		}
	}
</style>
