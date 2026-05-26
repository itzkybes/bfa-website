import { sveltekit } from '@sveltejs/kit/vite';

/** @type {import('vite').UserConfig} */
const config = {
  plugins: [sveltekit()],
  define: {
    'import.meta.env.VERCEL_ANALYTICS_ID': JSON.stringify(process.env.VERCEL_ANALYTICS_ID)
  },
  server: {
    host: '0.0.0.0',
    port: 3000,
    strictPort: true,
    // Allow preview hosts (Emergent preview env + any *.vercel.app etc.).
    // `true` accepts every host header — fine for dev/preview, NOT used in prod (Vercel ignores this).
    allowedHosts: true
  },
  preview: {
    host: '0.0.0.0',
    port: 3000,
    strictPort: true,
    allowedHosts: true
  }
};

export default config;
