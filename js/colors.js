// Color helpers. Pure — no DOM. Used to apply per-entity official colors
// (scraped from Wikidata P462 → P465) to the win banner accent and confetti
// without breaking text contrast.

// Parse "#RRGGBB" → [r,g,b] (0-255). Tolerates short "#RGB". Returns null on
// anything we don't understand so callers can fall back cleanly.
export function parseHex(s) {
  if (typeof s !== "string") return null;
  const m = s.trim().match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!m) return null;
  let hex = m[1];
  if (hex.length === 3) hex = hex.split("").map((c) => c + c).join("");
  return [
    parseInt(hex.slice(0, 2), 16),
    parseInt(hex.slice(2, 4), 16),
    parseInt(hex.slice(4, 6), 16),
  ];
}

// Relative luminance per WCAG. 0 = black, 1 = white.
export function luminance(rgb) {
  if (!rgb) return 0.5;
  const [r, g, b] = rgb.map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

// Expand a small palette (1–2 hex colors) into a wider one by adding light
// and dark variants. Keeps confetti looking varied even when only one color
// is on file. Identity for palettes of size ≥3.
export function expandPalette(palette) {
  if (!palette || palette.length === 0) return null;
  if (palette.length >= 3) return palette.slice();
  const out = palette.slice();
  for (const c of palette) {
    const rgb = parseHex(c);
    if (!rgb) continue;
    out.push(rgbToHex(mix(rgb, [255, 255, 255], 0.4))); // lighter
    out.push(rgbToHex(mix(rgb, [0, 0, 0], 0.35)));      // darker
  }
  return out;
}

function mix(a, b, t) {
  return [
    Math.round(a[0] * (1 - t) + b[0] * t),
    Math.round(a[1] * (1 - t) + b[1] * t),
    Math.round(a[2] * (1 - t) + b[2] * t),
  ];
}

function toHex2(n) {
  return Math.max(0, Math.min(255, n | 0)).toString(16).padStart(2, "0");
}
export function rgbToHex(rgb) {
  return "#" + rgb.map(toHex2).join("").toUpperCase();
}

// Pick the strongest accent color for the banner border / glow. Prefers a
// color with mid-range luminance (avoids near-white/black which look washed
// out as a glow). Returns a hex string or null when the palette is empty.
export function accentColor(palette) {
  if (!palette || palette.length === 0) return null;
  // Score each color: distance from luminance 0.5 (closer = better, but
  // saturated darks/lights both fine; we just penalize the extremes).
  let best = null, bestScore = -Infinity;
  for (const c of palette) {
    const rgb = parseHex(c);
    if (!rgb) continue;
    const L = luminance(rgb);
    const score = 1 - Math.abs(L - 0.45) * 1.4;
    if (score > bestScore) { bestScore = score; best = c; }
  }
  return best;
}
