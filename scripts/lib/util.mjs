// Small shared helpers. No dependencies on purpose: anyone should be able to read this.
import fs from "node:fs";
import path from "node:path";

export const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..", "..");
export const p = (...parts) => path.join(ROOT, ...parts);

export function readText(file, enc = "utf8") { return fs.readFileSync(file, enc); }
export function writeFile(file, content) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, content); }
export function readJSON(file) { return JSON.parse(readText(file)); }
export function writeJSON(file, obj) { writeFile(file, JSON.stringify(obj, null, 2) + "\n"); }

// RFC 4180-ish CSV parser (quoted fields, escaped quotes, CRLF).
export function parseCSV(text) {
  const rows = []; let row = [], field = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; }
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = ""; if (row.some(v => v !== "")) rows.push(row); row = [];
    } else field += c;
  }
  if (field !== "" || row.length) { row.push(field); if (row.some(v => v !== "")) rows.push(row); }
  return rows;
}
// CSV to objects. Duplicate header names get a numeric suffix (name_2).
export function csvObjects(text) {
  const [head, ...rows] = parseCSV(text);
  const seen = {};
  const keys = head.map(h => { const k = h.trim(); seen[k] = (seen[k] || 0) + 1; return seen[k] > 1 ? `${k}_${seen[k]}` : k; });
  return rows.map(r => Object.fromEntries(keys.map((k, i) => [k, (r[i] ?? "").trim()])));
}
export function toCSV(rows) {
  const esc = v => { const s = String(v ?? ""); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return rows.map(r => r.map(esc).join(",")).join("\n") + "\n";
}

export const decodeEntities = s => s
  .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
  .replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n));
export const stripTags = s => decodeEntities(s.replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();

// A website value from a source list, or null. Source lists sometimes hold an email address
// in the website field; never publish those (privacy) or link to them (broken).
export function cleanWebsite(u) {
  u = String(u ?? "").trim();
  if (!u || u.includes("@") || /\s/.test(u) || !/\.[a-z]{2,}/i.test(u)) return null;
  return /^https?:\/\//i.test(u) ? u : `http://${u}`;
}

export const slug = s => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "")
  .replace(/&/g, " and ").replace(/['.]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// Dates are plain YYYY-MM-DD strings so comparisons are string comparisons.
export const iso = d => d.toISOString().slice(0, 10);
export function lastDayOfMonth(year, month1) { return iso(new Date(Date.UTC(year, month1, 0))); }
export function addMonthsEnd(isoDate, months) {
  const [y, m] = isoDate.split("-").map(Number);
  const t = m - 1 + months; const ny = y + Math.floor(t / 12); const nm = ((t % 12) + 12) % 12 + 1;
  return lastDayOfMonth(ny, nm);
}
export function mdyToISO(s) {
  const m = /^(\d{1,2})-(\d{1,2})-(\d{4})$/.exec(s.trim());
  return m ? `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}` : null;
}
export function daysBetween(a, b) { return Math.round((Date.parse(b) - Date.parse(a)) / 86400000); }
export const fmtDate = isoDate => {
  const [y, m, d] = isoDate.split("-").map(Number);
  return `${["January","February","March","April","May","June","July","August","September","October","November","December"][m - 1]} ${d}, ${y}`;
};
export function yearRange(years) {
  const ys = [...years].sort();
  if (ys.length === 1) return `fiscal year ${ys[0]}`;
  const contiguous = ys.every((y, i) => i === 0 || +y === +ys[i - 1] + 1);
  return contiguous ? `fiscal years ${ys[0]} to ${ys[ys.length - 1]}` : `fiscal years ${ys.slice(0, -1).join(", ")} and ${ys[ys.length - 1]}`;
}
export function latestDir(dir) {
  const ds = fs.readdirSync(dir).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
  if (!ds.length) throw new Error(`No dated snapshots in ${dir}`);
  return ds[ds.length - 1];
}
