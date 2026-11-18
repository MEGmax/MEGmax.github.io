/**
 * Finds where particles should gather in the hero: a thin band just outside
 * the letters of the HTML heading.
 *
 * The heading stays real HTML. Its words are redrawn off-screen in the same
 * font, at the positions the browser laid them out (taken from DOM Ranges, so
 * line wrapping on narrow screens is respected). That gives a mask to sample.
 * Nothing is drawn to the visible canvas.
 *
 * Returns document-space CSS px pairs: [x0, y0, x1, y1, ...].
 */
export function sampleNameHalo(el: HTMLElement, count: number): Float32Array {
  const rect = el.getBoundingClientRect();
  if (!rect.width || !rect.height || count <= 0) return new Float32Array();

  const cs = getComputedStyle(el);
  const fontSize = parseFloat(cs.fontSize);
  const band = Math.max(2.5, fontSize * 0.034);
  const pad = Math.ceil(band * 2 + 6);
  const scale = fontSize < 90 ? 2 : 1;
  const w = Math.ceil(rect.width + pad * 2);
  const h = Math.ceil(rect.height + pad * 2);

  const canvas = document.createElement('canvas');
  canvas.width = w * scale;
  canvas.height = h * scale;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return new Float32Array();
  ctx.scale(scale, scale);
  ctx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
  if ('letterSpacing' in ctx) ctx.letterSpacing = cs.letterSpacing;
  ctx.textBaseline = 'alphabetic';
  ctx.lineJoin = 'round';
  ctx.fillStyle = '#fff';
  ctx.strokeStyle = '#fff';

  // Word positions as laid out by the browser.
  const words: { text: string; x: number; y: number }[] = [];
  const range = document.createRange();
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    for (const m of (node.textContent ?? '').matchAll(/\S+/g)) {
      const start = m.index ?? 0;
      range.setStart(node, start);
      range.setEnd(node, start + m[0].length);
      const r = range.getBoundingClientRect();
      const metrics = ctx.measureText(m[0]);
      const ascent = metrics.fontBoundingBoxAscent || metrics.actualBoundingBoxAscent;
      words.push({ text: m[0], x: r.left - rect.left + pad, y: r.top - rect.top + pad + ascent });
    }
  }

  // Dilated glyphs, minus the glyphs themselves (+1px), leaves the halo band.
  ctx.lineWidth = band * 2 + 2;
  for (const wd of words) {
    ctx.strokeText(wd.text, wd.x, wd.y);
    ctx.fillText(wd.text, wd.x, wd.y);
  }
  ctx.globalCompositeOperation = 'destination-out';
  ctx.lineWidth = Math.max(2, fontSize * 0.012);
  for (const wd of words) {
    ctx.fillText(wd.text, wd.x, wd.y);
    ctx.strokeText(wd.text, wd.x, wd.y);
  }

  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const candidates: number[] = [];
  for (let i = 3; i < data.length; i += 4) if (data[i] > 140) candidates.push((i - 3) / 4);
  if (!candidates.length) return new Float32Array();

  const out = new Float32Array(count * 2);
  const left = rect.left - pad;
  const top = rect.top + scrollY - pad;
  for (let k = 0; k < count; k++) {
    const idx = candidates[(Math.random() * candidates.length) | 0];
    const cx = idx % canvas.width;
    const cy = (idx / canvas.width) | 0;
    out[k * 2] = left + (cx + Math.random()) / scale;
    out[k * 2 + 1] = top + (cy + Math.random()) / scale;
  }
  return out;
}
