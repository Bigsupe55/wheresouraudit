// Reference: current Florida city mayors (name and title only) for the "Who's responsible" panel.
// OUTPUT IS UNCONFIRMED: Wikidata mayors can be stale (spot-check 2026-11-24: Cape Coral was out of date).
// It writes candidates to data/review/ (not published). A name goes on the site only after a person confirms it.
// Sources, both CC0:
//   1. Open States people data, data/fl/municipalities (https://github.com/openstates/people)
//   2. Wikidata: Florida cities/towns/villages with P6 head of government that has no end time (P582)
// Rules: Open States rows are kept unless their term end_date has passed. Wikidata rows need a start
// date (P580) of 2018 or later. A city where the two sources name different people (or one says the
// term ended while the other still lists the same person) keeps neither and is listed as a conflict.
// Only names and roles are kept: never phones, emails, addresses or party.
// Usage: node scripts/reference/make-fl-mayors.mjs
import { p, readJSON, writeFile, toCSV, iso } from "../lib/util.mjs";

const UA = "WheresOurAudit/0.1 (+https://wheresouraudit.pages.dev)";
const TODAY = iso(new Date());
const OS_API = "https://api.github.com/repos/openstates/people/contents/data/fl/municipalities";
const OS_RAW = "https://raw.githubusercontent.com/openstates/people/main/data/fl";
const OS_BLOB = "https://github.com/openstates/people/blob/main/data/fl/municipalities";
const SPARQL = "https://query.wikidata.org/sparql";

async function get(url, accept) {
  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA, ...(accept ? { Accept: accept } : {}) } });
      if (res.ok) return res;
      if (res.status < 500 && res.status !== 429) throw new Error(`HTTP ${res.status} ${url}`);
    } catch (e) { if (i === 2) throw e; }
    await new Promise(r => setTimeout(r, 2000 * (i + 1)));
  }
  throw new Error(`failed: ${url}`);
}

// Match key: lowercase, letters and digits only, a trailing city/town/village word dropped.
// "Saint" is folded to "St" so Open States' "Saint Petersburg" meets "St. Petersburg".
const key = s => {
  const words = s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim().split(" ")
    .map(w => (w === "saint" ? "st" : w));
  if (words.length > 1 && /^(city|town|village)$/.test(words.at(-1))) words.pop();
  return words.join("");
};
// Person key: first and last word, initials and quoted nicknames dropped.
const personKey = s => {
  const w = s.replace(/["“”][^"“”]*["“”]/g, " ").toLowerCase().normalize("NFKD")
    .replace(/[̀-ͯ]/g, "").replace(/[^a-z ]+/g, " ").split(/\s+/)
    .filter(x => x.length > 1 && !/^(jr|sr|ii|iii|iv)$/.test(x));
  return `${w[0]}|${w.at(-1)}`;
};
const roleFrom = label => {
  if (!label) return "Mayor";
  const r = label.replace(/\s+of\s+.*$/i, "").trim();
  return r.replace(/(^|[\s-])([a-z])/g, (m, a, b) => a + b.toUpperCase()) || "Mayor";
};

// Our cities
const fl = readJSON(p("data", "derived", "florida.json"));
const cities = new Map();
for (const e of fl.entities.filter(e => e.type === "city")) {
  const k = key(e.sourceName);
  const plain = e2 => key(e2.sourceName + " x").slice(0, -1) === k; // name had no trailing city/town/village
  if (!cities.has(k) || (plain(e) && !plain(cities.get(k)))) cities.set(k, e); // "Melbourne" beats "Melbourne Village"
}

const skipped = []; // [city, name, reason]

// 1. Open States
const jur = new Map();
const muni = await (await get(`${OS_RAW}/municipalities.yml`)).text();
for (const m of muni.matchAll(/-\s*name:\s*(.+)\n\s+id:\s*(\S+)/g)) jur.set(m[2].trim(), m[1].trim().replace(/^['"]|['"]$/g, ""));
const files = (await (await get(OS_API, "application/vnd.github+json")).json()).filter(f => f.name.endsWith(".yml"));
const os = new Map(); // city key -> record
for (const f of files) {
  const t = await (await get(`${OS_RAW}/municipalities/${f.name}`)).text();
  const name = /^name:\s*(.+)$/m.exec(t)[1].trim().replace(/^'(.*)'$/, "$1").replace(/''/g, "'");
  const lines = t.split(/\r?\n/);
  const roles = [];
  for (let i = lines.indexOf("roles:") + 1; i > 0 && i < lines.length && /^[- ]/.test(lines[i]); i++) {
    if (lines[i].startsWith("-")) roles.push({});
    const m = /^[-\s]*(\w+):\s*['"]?(.*?)['"]?\s*$/.exec(lines[i]);
    if (m) roles.at(-1)[m[1]] = m[2];
  }
  for (const r of roles.filter(r => r.type === "mayor")) {
    const city = jur.get(r.jurisdiction) || r.jurisdiction.replace(/^.*place:([^/]+).*$/, "$1").replace(/_/g, " ");
    const rec = { city, name, role: "Mayor", start: r.start_date || "", end: r.end_date || "", url: `${OS_BLOB}/${f.name}` };
    if (rec.end && rec.end < TODAY) { rec.ended = true; }
    os.set(key(city), rec);
  }
}

// 2. Wikidata
const q = `SELECT DISTINCT ?place ?placeLabel ?head ?headLabel ?start ?officeLabel WHERE {
  VALUES ?type { wd:Q1093829 wd:Q15127012 wd:Q15078955 wd:Q515 wd:Q3957 wd:Q532 }
  ?place wdt:P31 ?type; wdt:P131+ wd:Q812; p:P6 ?st.
  ?st ps:P6 ?head; wikibase:rank ?rank.
  FILTER NOT EXISTS { ?st pq:P582 [] }
  FILTER(?rank != wikibase:DeprecatedRank)
  OPTIONAL { ?st pq:P580 ?start }
  OPTIONAL { ?place wdt:P1313 ?office. OPTIONAL { ?office rdfs:label ?ol FILTER(lang(?ol) IN ("en", "mul")) } }
  OPTIONAL { ?place rdfs:label ?pl FILTER(lang(?pl) IN ("en", "mul")) }
  OPTIONAL { ?head rdfs:label ?hl FILTER(lang(?hl) IN ("en", "mul")) }
  BIND(COALESCE(?pl, "") AS ?placeLabel) BIND(COALESCE(?hl, "") AS ?headLabel) BIND(COALESCE(?ol, "") AS ?officeLabel)
}`;
const wdRows = (await (await get(`${SPARQL}?format=json&query=${encodeURIComponent(q)}`, "application/sparql-results+json")).json()).results.bindings;
const byPlace = new Map();
for (const b of wdRows) {
  const place = b.place.value;
  if (!b.placeLabel.value || !b.headLabel.value) { skipped.push([b.placeLabel.value || place, b.headLabel.value || b.head.value, "wikidata: missing English label"]); continue; }
  if (!byPlace.has(place)) byPlace.set(place, { city: b.placeLabel.value, url: place.replace("http://", "https://"), heads: new Map() });
  const heads = byPlace.get(place).heads;
  const h = heads.get(b.head.value) || { name: b.headLabel.value, start: "", office: "" };
  const s = b.start?.value?.slice(0, 10) || "";
  if (s > h.start) h.start = s;
  if (b.officeLabel?.value && (!h.office || b.officeLabel.value.length < h.office.length)) h.office = b.officeLabel.value;
  heads.set(b.head.value, h);
}
const wd = new Map(); // city key -> record
for (const { city, url, heads } of byPlace.values()) {
  const list = [...heads.values()].sort((a, b) => b.start.localeCompare(a.start));
  const top = list[0];
  if (list.length > 1 && (!top.start || top.start === list[1].start)) {
    skipped.push([city, list.map(h => h.name).join(" / "), "wikidata: several current heads, none clearly latest"]); continue;
  }
  if (!top.start) { skipped.push([city, top.name, "wikidata: no start date"]); continue; }
  if (top.start < "2018") { skipped.push([city, top.name, `wikidata: start date before 2018 (${top.start})`]); continue; }
  const k = key(city);
  if (wd.has(k)) { skipped.push([city, top.name, "wikidata: two places share this name"]); continue; }
  wd.set(k, { city, name: top.name, role: roleFrom(top.office), start: top.start, url });
}

// Combine
const out = [];
const counts = { openstates: 0, wikidata: 0, conflicts: 0 };
for (const k of new Set([...os.keys(), ...wd.keys()])) {
  const o = os.get(k), w = wd.get(k);
  const label = (o || w).city;
  const c = cities.get(k);
  if (o && w && (personKey(o.name) !== personKey(w.name) || o.ended)) {
    skipped.push([label, `${o.name} / ${w.name}`, o.ended && personKey(o.name) === personKey(w.name)
      ? `conflict: openstates term ended ${o.end}, wikidata still current` : "conflict: openstates and wikidata name different people"]);
    counts.conflicts++; continue;
  }
  if (o?.ended) { skipped.push([label, o.name, `openstates: term ended ${o.end}`]); continue; }
  const rec = o ? { ...o, source: "openstates", start: o.start || w?.start || "" } : { ...w, source: "wikidata" };
  if (!c) { skipped.push([label, rec.name, "no matching city in florida.json"]); continue; }
  counts[rec.source]++;
  out.push([c.dfsId, c.sourceName, rec.role, rec.name, rec.start, rec.source, rec.url, TODAY]);
}
out.sort((a, b) => a[1].localeCompare(b[1]));
skipped.sort((a, b) => a[2].localeCompare(b[2]) || a[0].localeCompare(b[0]));
writeFile(p("data", "review", "fl-mayors-candidates.csv"), toCSV([["dfs_id", "city", "role", "name", "start_date", "source", "source_url", "retrieved"], ...out]));
writeFile(p("data", "review", "fl-mayors-skipped.csv"), toCSV([["city", "name", "reason"], ...skipped]));
const reasons = {};
for (const s of skipped) { const r = s[2].replace(/\s*\(.*\)$|\s\d{4}-\d{2}-\d{2}.*$/, ""); reasons[r] = (reasons[r] || 0) + 1; }
console.log(`openstates files ${files.length}, wikidata places ${byPlace.size}`);
console.log(`${out.length} rows (openstates ${counts.openstates}, wikidata ${counts.wikidata}); conflicts ${counts.conflicts}; skipped ${skipped.length}`);
for (const [r, n] of Object.entries(reasons)) console.log(`  ${n}  ${r}`);
