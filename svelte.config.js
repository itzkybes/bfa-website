import adapter from '@sveltejs/adapter-vercel';

/** @type {import('@sveltejs/kit').Config} */
const config = {
  kit: {
    // Vercel's default build runtime is Node 22.x as of late 2025. Pin to
    // nodejs22.x explicitly so the adapter doesn't have to guess (and so
    // any stale adapter-auto fallback can't downgrade us to an unsupported
    // older runtime).
    adapter: adapter({
      runtime: 'nodejs22.x'
    })
  }
};

export default config;

