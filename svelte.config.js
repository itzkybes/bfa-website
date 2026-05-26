import adapter from '@sveltejs/adapter-vercel';

/** @type {import('@sveltejs/kit').Config} */
const config = {
  kit: {
    // Explicit Vercel adapter. Node 20 is the most battle-tested LTS runtime
    // on Vercel right now (Node 22 is supported but has caused unexplained
    // FUNCTION_INVOCATION_FAILED on some projects — see sveltejs/kit issues).
    adapter: adapter({
      runtime: 'nodejs20.x'
    })
  }
};

export default config;
