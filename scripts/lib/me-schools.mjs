// Maine school administrative units (RSUs, MSADs, CSDs) as status-only pages.
// The state audit goes to the Maine Department of Education by December 30 (20-A M.R.S. s.6051), but DOE
// publishes no list of audits received, so these pages show the federal single audit status (FAC) only.
// Municipal school units report inside their town's audit (s.6051(7)) and get no page of their own.
// Matching FAC filers to units uses exact keys only: RSU or MSAD number, or the CSD's exact name.
import fs from "node:fs";
import { p, readText, csvObjects, slug } from "./util.mjs";

const TYPE_LABEL = { "Regional School Unit (RSU)": "Regional school unit", "Maine School Administrative District (SAD)": "School administrative district", "Consolidated School District (CSD)": "Consolidated school district" };
const numKeys = s => {
  const t = s.toUpperCase().replace(/[.#]/g, " ").replace(/\bNO\b/g, " ").replace(/\s+/g, " ");
  const keys = [];
  for (const m of t.matchAll(/\b(RSU|REGIONAL SCHOOL UNIT)\s*(\d+)\b/g)) keys.push(`rsu${+m[2]}`);
  // "Administrative", "Administration" and the misspelling "Adminstrative" all occur in federal filings.
  for (const m of t.matchAll(/\b(MSAD|M S A D|SAD|SCHOOL ADMIN\w* DISTRICT)\s*(\d+)\b/g)) keys.push(`msad${+m[2]}`);
  return keys;
};
const csdKey = s => s.toLowerCase().replace(/\(.*?\)/g, "").replace(/\b(csd|consolidated school district|community school district)\b/g, "").replace(/[^a-z0-9]/g, "");

export function maineSchools(fedRecords) {
  const file = p("data", "reference", "me-school-units.csv");
  if (!fs.existsSync(file)) return { units: [], usedFed: new Set() };
  const units = csvObjects(readText(file)).filter(u => TYPE_LABEL[u.type]);
  const byKey = new Map();
  for (const u of units) {
    const keys = u.type.includes("CSD") ? [`csd${csdKey(u.name)}`] : numKeys(u.name);
    for (const k of keys) byKey.set(k, byKey.has(k) && byKey.get(k) !== u ? null : u); // null: ambiguous, never attach
  }
  const fedFor = new Map(), usedFed = new Set();
  for (const r of fedRecords.filter(r => r.state === "ME" && !r.fips)) {
    const keys = [...new Set([...numKeys(r.name), ...(/csd|consolidated school|community school/i.test(r.name) ? [`csd${csdKey(r.name)}`] : [])])];
    const hits = [...new Set(keys.map(k => byKey.get(k)).filter(Boolean))];
    if (hits.length === 1) { if (!fedFor.has(hits[0].doe_id)) fedFor.set(hits[0].doe_id, []); fedFor.get(hits[0].doe_id).push(r); usedFed.add(r); }
  }
  // A unit can have more than one federal record (for example after a tax-id change). The newest one
  // gives the status and flags; the years of all of them are shown.
  const newest = list => list.slice().sort((a, b) => (b.years.at(-1)?.fy || "").localeCompare(a.years.at(-1)?.fy || ""))[0];
  const used = new Set();
  const out = units.map(u => {
    let s = slug(u.name.replace(/\(.*?\)/g, "")); while (used.has(s)) s += "-x"; used.add(s);
    const list = fedFor.get(u.doe_id) || [];
    const fed = list.length ? { ...newest(list), years: Object.values(Object.fromEntries(list.flatMap(r => r.years).sort((a, b) => (a.accepted || "").localeCompare(b.accepted || "")).map(y => [y.fy, y]))).sort((a, b) => a.fy.localeCompare(b.fy)) } : null;
    return { unit: u, slug: s, typeLabel: TYPE_LABEL[u.type], fed, fedNames: list.map(r => r.name) };
  });
  return { units: out, usedFed };
}
