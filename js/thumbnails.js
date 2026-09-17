/* Z Key — thumbnails.js
   Renders low-resolution page thumbnails on demand (never all at once),
   caches a bounded number of them, and evicts the oldest when the cache
   grows too large. Used both by the Add/Remove Pages grid (small, lazy,
   IntersectionObserver-driven) and by Preview (slightly larger, on demand). */

const Thumbnails = (() => {
  const cache = new Map(); // key: `${pageIndex}:${targetWidth}` -> dataURL
  const inFlight = new Map();
  const MAX_CACHE_ENTRIES = 60;

  async function render(pageIndex, targetWidth = 220) {
    const key = `${pageIndex}:${targetWidth}`;
    if (cache.has(key)) {
      // refresh recency
      const val = cache.get(key);
      cache.delete(key);
      cache.set(key, val);
      return val;
    }
    if (inFlight.has(key)) return inFlight.get(key);

    const promise = (async () => {
      const state = AppState.get();
      const doc = state.pdfJsDoc;
      if (!doc) throw new Error('No PDF loaded');

      const page = await doc.getPage(pageIndex + 1);
      const baseViewport = page.getViewport({ scale: 1 });
      const scale = targetWidth / baseViewport.width;
      const viewport = page.getViewport({ scale });

      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(viewport.width));
      canvas.height = Math.max(1, Math.round(viewport.height));
      const ctx = canvas.getContext('2d', { alpha: false });

      await page.render({ canvasContext: ctx, viewport }).promise;
      const dataUrl = canvas.toDataURL('image/jpeg', 0.82);

      // Explicit cleanup — release canvas + pdf.js page render resources.
      canvas.width = 0;
      canvas.height = 0;
      page.cleanup();

      setInCache(key, dataUrl);
      return dataUrl;
    })();

    inFlight.set(key, promise);
    try {
      return await promise;
    } finally {
      inFlight.delete(key);
    }
  }

  function setInCache(key, value) {
    cache.set(key, value);
    if (cache.size > MAX_CACHE_ENTRIES) {
      const oldestKey = cache.keys().next().value;
      cache.delete(oldestKey);
    }
  }

  function clear() {
    cache.clear();
    inFlight.clear();
  }

  // Attaches a lazy-loading <img> inside `container` for the given source
  // page, using IntersectionObserver so only visible cards render.
  function attachLazy(container, pageIndex, targetWidth = 220) {
    const skeleton = document.createElement('div');
    skeleton.className = 'page-thumb-skeleton';
    container.appendChild(skeleton);

    const load = () => {
      render(pageIndex, targetWidth)
        .then((dataUrl) => {
          if (!container.isConnected) return;
          const img = document.createElement('img');
          img.src = dataUrl;
          img.alt = `Page ${pageIndex + 1}`;
          img.loading = 'lazy';
          container.innerHTML = '';
          container.appendChild(img);
        })
        .catch(() => {
          if (!container.isConnected) return;
          container.innerHTML = '<span style="font-size:11px;color:var(--c-text-muted)">Preview unavailable</span>';
        });
    };

    if ('IntersectionObserver' in window) {
      const observer = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            observer.disconnect();
            load();
          }
        });
      }, { rootMargin: '200px' });
      observer.observe(container);
    } else {
      load();
    }
  }

  return { render, attachLazy, clear };
})();
