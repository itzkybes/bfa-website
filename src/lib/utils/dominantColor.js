// /app/src/lib/dominantColor.js
//
// Pulls the "signature color" out of a team logo image so we can theme MVP
// cards (and similar callouts) to match the manager's avatar. Pure browser-
// side; the image is loaded with `crossOrigin="anonymous"` and rasterized
// onto a tiny 32×32 canvas — we then bucket every visible pixel, throw out
// the near-black/near-white/near-gray ones, and pick the most-populated
// vivid bucket as the result.
//
// Sleeper's CDN serves both `Access-Control-Allow-Origin: *` and the actual
// JPEG bytes, so the canvas isn't tainted for these URLs in practice. We
// still wrap every step in try/catch so a privacy-mode browser or some
// future CORS change just returns `null` and the card falls back to the
// default theme.
//
// Results are memoized per-URL because the same logo shows up across many
// pages — extracting it once is plenty.

// Sleeper's CDN sends `Access-Control-Allow-Origin: *` on a cache MISS but
// Cloudflare often caches the response WITHOUT the header (since the
// initial request had no `Origin` header) — meaning a subsequent `<img
// crossOrigin="anonymous">` load gets blocked. To dodge that, we route
// Sleeper image URLs through `images.weserv.nl`, a free CORS-enabled image
// proxy that strips/normalizes headers. Non-Sleeper URLs are used as-is.
function _proxyImageUrl(url) {
  if (!url) return url;
  try {
    const m = url.match(/^https?:\/\/(sleepercdn\.com\/.+)$/i);
    if (m) return `https://images.weserv.nl/?url=${encodeURIComponent(m[1])}`;
  } catch (e) {}
  return url;
}

const _cache = new Map();
const _pending = new Map();

const FALLBACK_RGB = null;

function _quantize(r, g, b) { return `${r >> 4},${g >> 4},${b >> 4}`; }

/**
 * Resolve a dominant `rgb(r,g,b)` color for an image URL, or `null` if the
 * image can't be loaded or no vivid color exists. Results are cached.
 */
export function extractDominantColor(url) {
  if (!url) return Promise.resolve(FALLBACK_RGB);
  if (_cache.has(url)) return Promise.resolve(_cache.get(url));
  if (_pending.has(url)) return _pending.get(url);

  const p = new Promise((resolve) => {
    try {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.referrerPolicy = 'no-referrer';
      img.onload = () => {
        try {
          const size = 32;
          const canvas = document.createElement('canvas');
          canvas.width = size;
          canvas.height = size;
          const ctx = canvas.getContext('2d', { willReadFrequently: true });
          if (!ctx) return resolve(FALLBACK_RGB);
          ctx.drawImage(img, 0, 0, size, size);
          let pixels;
          try { pixels = ctx.getImageData(0, 0, size, size).data; }
          catch (e) { return resolve(FALLBACK_RGB); }

          const buckets = {};
          for (let i = 0; i < pixels.length; i += 4) {
            const r = pixels[i], g = pixels[i + 1], b = pixels[i + 2], a = pixels[i + 3];
            if (a < 200) continue;
            const lum = r * 0.2126 + g * 0.7152 + b * 0.0722;
            if (lum < 30 || lum > 230) continue;        // skip near-black + near-white
            const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
            if (mx - mn < 25) continue;                  // skip near-gray
            const k = _quantize(r, g, b);
            buckets[k] = (buckets[k] || 0) + 1;
          }

          let bestKey = null, bestCount = 0;
          for (const k in buckets) {
            if (buckets[k] > bestCount) { bestCount = buckets[k]; bestKey = k; }
          }
          if (!bestKey) return resolve(FALLBACK_RGB);

          // Un-quantize: shift back up and add a half-step to recover lost bits
          const [r4, g4, b4] = bestKey.split(',').map(Number);
          const r = (r4 << 4) | 8;
          const g = (g4 << 4) | 8;
          const b = (b4 << 4) | 8;
          resolve(`rgb(${r}, ${g}, ${b})`);
        } catch (e) {
          resolve(FALLBACK_RGB);
        }
      };
      img.onerror = () => resolve(FALLBACK_RGB);
      img.src = _proxyImageUrl(url);
    } catch (e) {
      resolve(FALLBACK_RGB);
    }
  });

  _pending.set(url, p);
  p.then((c) => { _cache.set(url, c); _pending.delete(url); });
  return p;
}

/**
 * Svelte action: `use:tintFromImg={imageUrl}` will asynchronously set
 * `--card-tint` (rgb) and `--card-tint-soft` (rgba w/ 0.18 alpha) and
 * `--card-tint-glow` (rgba w/ 0.30 alpha) on the host element once the
 * image's dominant color resolves. Falls back to a no-op if extraction
 * fails so the element's stylesheet defaults apply.
 */
export function tintFromImg(node, url) {
  let lastUrl = url;
  function apply(u) {
    extractDominantColor(u).then((rgb) => {
      if (!rgb || lastUrl !== u) return;
      // rgb is in "rgb(r, g, b)" form — split out the three numbers so we
      // can emit derived rgba() values for soft/glow surfaces.
      const m = rgb.match(/rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/);
      if (!m) return;
      const r = m[1], g = m[2], b = m[3];
      node.style.setProperty('--card-tint', rgb);
      node.style.setProperty('--card-tint-soft', `rgba(${r}, ${g}, ${b}, 0.18)`);
      node.style.setProperty('--card-tint-glow', `rgba(${r}, ${g}, ${b}, 0.32)`);
    });
  }
  apply(url);
  return {
    update(newUrl) { lastUrl = newUrl; apply(newUrl); },
    destroy() { /* no listeners to clean up */ }
  };
}
