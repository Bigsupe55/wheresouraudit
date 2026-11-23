// Share images (1200 x 630 PNG) for link previews. Drawn as SVG, turned into PNG by resvg with the bundled
// Source Serif 4 font (SIL Open Font License, assets/fonts/LICENSE.md), so output is the same on every machine.
import { Resvg } from "@resvg/resvg-js";
import { p } from "./util.mjs";

const FONTS = [p("assets", "fonts", "SourceSerif4-Regular.ttf"), p("assets", "fonts", "SourceSerif4-Bold.ttf")];
const OPTS = { font: { fontFiles: FONTS, loadSystemFonts: false, defaultFontFamily: "Source Serif 4" } };
const COLORS = { bad: "#a3261b", warn: "#8a5200", good: "#1d6b3a", none: "#5f6672" };
const BG = { bad: "#fbeceb", warn: "#fdf3e3", good: "#e9f5ee", none: "#eef0f3" };
const x = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[c]));

// Measure real text width with the same font and renderer (cached per string, size and weight).
const cache = new Map();
function width(text, size, bold) {
  const k = `${size}|${bold ? 1 : 0}|${text}`;
  if (!cache.has(k)) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="4000" height="${size * 2}"><text x="0" y="${size * 1.5}" font-size="${size}" font-family="Source Serif 4"${bold ? ' font-weight="700"' : ""}>${x(text)}</text></svg>`;
    const box = new Resvg(svg, OPTS).getBBox();
    cache.set(k, box ? box.width : text.length * size * 0.5);
  }
  return cache.get(k);
}
function wrap(text, size, maxWidth, bold) {
  const lines = []; let line = "";
  for (const w of String(text).split(/\s+/).filter(Boolean)) {
    const tryLine = line ? `${line} ${w}` : w;
    if (!line || width(tryLine, size, bold) <= maxWidth) line = tryLine;
    else { lines.push(line); line = w; }
  }
  if (line) lines.push(line);
  return lines;
}

export function shareSVG({ title, subtitle, pill, cls = "none", footer }) {
  const W = 1200, H = 630, L = 92, MAXW = W - L - 80;
  const top = pill ? 186 : 140, bottom = H - 118; // text must end above the divider at H - 92
  // Try title and subtitle sizes from large to small until both fit in the space.
  let layout = null;
  for (const ts of [76, 68, 60, 54, 48]) {
    const tl = wrap(title, ts, MAXW, true);
    if (tl.length > 2) continue;
    for (const ss of [46, 42, 38, 34, 30]) {
      const sl = subtitle ? wrap(subtitle, ss, MAXW, false) : [];
      const h = tl.length * ts * 1.12 + (sl.length ? 26 + sl.length * ss * 1.25 : 0);
      if (sl.length <= 3 && top + h <= bottom) { layout = { ts, tl, ss, sl }; break; }
    }
    if (layout) break;
  }
  if (!layout) { // last resort: smallest sizes, cut extra lines
    const tl = wrap(title, 48, MAXW, true).slice(0, 2), sl = wrap(subtitle || "", 30, MAXW, false).slice(0, 2);
    layout = { ts: 48, tl, ss: 30, sl };
  }
  let y = top;
  const tl = layout.tl.map(line => { y += layout.ts * 1.12; return `<text x="${L}" y="${y.toFixed(0)}" font-size="${layout.ts}" font-weight="700" fill="#1b1d21">${x(line)}</text>`; }).join("");
  if (layout.sl.length) y += 26;
  const sl = layout.sl.map(line => { y += layout.ss * 1.25; return `<text x="${L}" y="${y.toFixed(0)}" font-size="${layout.ss}" fill="#1b1d21">${x(line)}</text>`; }).join("");
  const pillW = pill ? Math.ceil(width(pill, 27, true) + 44) : 0;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="Source Serif 4">
<rect width="${W}" height="${H}" fill="#fbfaf7"/>
<rect x="0" y="0" width="22" height="${H}" fill="${COLORS[cls]}"/>
<text x="${L}" y="104" font-size="42" font-weight="700" fill="#1b1d21">Where's Our Audit?</text>
${pill ? `<rect x="${L}" y="126" width="${pillW}" height="44" rx="22" fill="${BG[cls]}"/><text x="${L + 22}" y="157" font-size="27" font-weight="700" fill="${COLORS[cls]}">${x(pill)}</text>` : ""}
${tl}${sl}
<line x1="${L}" y1="${H - 92}" x2="${W - 80}" y2="${H - 92}" stroke="#dcd8cf" stroke-width="2"/>
<text x="${L}" y="${H - 48}" font-size="27" fill="#5d6470">${x(footer)}</text>
</svg>`;
}

export function renderPNG(svg) {
  return new Resvg(svg, { ...OPTS, fitTo: { mode: "width", value: 1200 } }).render().asPng();
}
