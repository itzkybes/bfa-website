import adapter from '@sveltejs/adapter-vercel';

/** @type {import('@sveltejs/kit').Config} */
const config = {
  kit: {
    // Explicit Vercel adapter with Node 22 runtime — fixes the
    // "Unsupported Node.js version" build error on Vercel.
    adapter: adapter({
      runtime: 'nodejs22.x'
    })
  }
};

export default config;
