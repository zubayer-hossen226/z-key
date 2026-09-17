/* Z Key — color-mode.js
   COLOR mode never rasterizes — export-pdf.js embeds the original PDF page
   directly (vector/text preserved) via pdf-lib's embedPdf.
   BLACK & WHITE mode needs pixels, so this module renders just the one
   page that's needed, at a resolution sized to how big it will actually
   print (not a fixed huge size), converts it to clean grayscale, and
   returns PNG bytes ready for pdf-lib to embed. Nothing is cached beyond
   what's needed — canvases are released immediately after use. */

const ColorMode = (() => {
  const PRINT_DPI = 220; // sharp enough for print, modest memory footprint
  const MAX_PIXEL_DIM = 2200; // hard ceiling per rendered page, memory safety

  function ptToPx(pt, dpi) {
    return (pt / 72) * dpi;
  }

  async function rasterizeGrayscalePng(pageIndex, slotWidthPt, slotHeightPt) {
    const state = AppState.get();
    const doc = state.pdfJsDoc;
    const page = await doc.getPage(pageIndex + 1);
    const baseViewport = page.getViewport({ scale: 1 });

    let targetWidthPx = ptToPx(slotWidthPt, PRINT_DPI);
    let targetHeightPx = ptToPx(slotHeightPt, PRINT_DPI);
    const scale = Math.min(
      targetWidthPx / baseViewport.width,
      targetHeightPx / baseViewport.height,
      MAX_PIXEL_DIM / baseViewport.width,
      MAX_PIXEL_DIM / baseViewport.height
    );
    const viewport = page.getViewport({ scale: Math.max(scale, 0.2) });

    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(viewport.width));
    canvas.height = Math.max(1, Math.round(viewport.height));
    const ctx = canvas.getContext('2d', { alpha: false });

    // White background first — PDF pages can have transparent regions.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport }).promise;

    // Manual luminance grayscale + a light contrast lift, so text/diagrams
    // stay crisp without turning the page muddy-dark.
    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const d = imgData.data;
    const contrast = 1.12;
    const midpoint = 128;
    for (let i = 0; i < d.length; i += 4) {
      const gray = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      let adjusted = (gray - midpoint) * contrast + midpoint;
      adjusted = Utils.clamp(adjusted, 0, 255);
      d[i] = adjusted;
      d[i + 1] = adjusted;
      d[i + 2] = adjusted;
    }
    ctx.putImageData(imgData, 0, 0);

    const dataUrl = canvas.toDataURL('image/png');
    const pngBytes = dataUrlToBytes(dataUrl);

    canvas.width = 0;
    canvas.height = 0;
    page.cleanup();

    return { pngBytes, width: canvas.width, height: canvas.height, aspect: viewport.width / viewport.height };
  }

  function dataUrlToBytes(dataUrl) {
    const base64 = dataUrl.split(',')[1];
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  return { rasterizeGrayscalePng };
})();
