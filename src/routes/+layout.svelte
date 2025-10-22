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

<Header />

<slot />

<footer>
	<div class="wrap">
		<div class="left">
			<p>Badger Fantasy Association</p>
			<p>
				<a href="https://sleeper.com/" target="_blank" rel="noreferrer">Sleeper</a>
			</p>
		</div>
	</div>
</footer>

<!-- Combined styles: original footer/layout + global roster styles -->
<style>
	.wrap {
		max-width: 1100px;
		margin: 0 auto;
	}

	footer {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 40px;
	}

	footer a {
		font-weight: bold;
		color: #00c6d8;
		text-decoration: none;
	}

	footer a:hover {
		text-decoration: underline;
	}

	@media (min-width: 480px) {
		footer {
			padding: 40px 0;
		}
	}

	/* Global roster styles injected to ensure roster component styling is present on all pages */
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
		box-shadow: 0 2px 6px rgba(0, 0, 0, 0.5);
		font-size: 0.85rem;
	}

	:global(.headshot) {
		width: 44px;
		height: 44px;
		border-radius: 8px;
		object-fit: cover;
		box-shadow: 0 2px 6px rgba(0, 0, 0, 0.6);
		border: 1px solid rgba(255, 255, 255, 0.03);
	}
</style>
