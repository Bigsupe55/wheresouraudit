// Reference: find current website addresses for Maine towns whose listed site (Census of Governments 2022)
// is missing or does not load. OUTPUT IS PROPOSALS for a person's OK, written to
// data/review/me-website-proposals.csv (not committed). Approved rows go into data/manual/website-overrides.csv.
// Sources, in order:
//   1. Wikidata official website (P856) for places in Maine (CC0).
//   2. Common Maine town address patterns (townof<name>.org, <name>maine.gov, ...), DNS checked first.
// Every candidate is loaded once and kept only if the page is not a parked or for-sale domain and its text
// names the town. "high" = the page title names the town and says Maine (or ME); "medium" = the page names
// the town somewhere; "blocked" = the server refused our robot (403), so a person must open it.
// Polite: identifies itself, one page request per second.
// Usage: node scripts/reference/find-me-websites.mjs [--diag=path-to-json] [--all-missing]
//   --diag: output of a reachability check ([{id, now}]); towns whose "now" is not 2xx or 403 are re-searched.
//   --all-missing also searches towns that have no listed website at all.
import fs from "node:fs";
import dns from "node:dns/promises";
import { p, readJSON, writeFile, toCSV, iso, decodeEntities } from "../lib/util.mjs";

const args = Object.fromEntries(process.argv.slice(2).map(a => a.replace(/^--/, "").split("=")).map(([k, v]) => [k, v ?? true]));
const UA = "WheresOurAudit-review/0.1 (+https://wheresouraudit.pages.dev)";
const OUT = p("data", "review", "me-website-proposals.csv");
const sleep = ms => new Promise(r => setTimeout(r, ms));
const PARKED = /hugedomains|godaddy|sedo\.com|dan\.com|afternic|parkingcrew|bodis|domain (is )?for sale|buy this domain|this domain (name )?(may be|is) for sale|domain has expired|parked free/i;

const host = u => { try { return new URL(u).hostname.replace(/^www./, ""); } catch { return ""; } };
const queue = readJSON(p("data", "review", "queue.json")).queue.filter(e => e.state === "ME" && e.type !== "county");
const diag = args.diag ? JSON.parse(fs.readFileSync(args.diag, "utf8")) : [];
const broken = new Map(diag.filter(d => !/^(2\d\d|403) /.test(d.now)).map(d => [d.id, d.now]));
// A 403 on the same domain is a site that refuses robots, not a wrong address; only a move to another domain counts.
const listed = new Map(readJSON(p("data", "review", "queue.json")).queue.map(e => [e.id, e.website]));
const redirected = new Map(diag.filter(d => /^403 /.test(d.now) && host(d.now.split(" ")[1]) !== host(listed.get(d.id) || "")).map(d => [d.id, d.now.split(" ")[1]]));
const todo = queue.filter(e => broken.has(e.id) || redirected.has(e.id) || (args["all-missing"] && !e.website));
console.log(`towns to search: ${todo.length} (broken ${broken.size}, 403 ${redirected.size}${args["all-missing"] ? `, no website ${queue.filter(e => !e.website).length}` : ""})`);

const key = s => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/\b(city|town|plantation|village)( of)?\b/g, "").replace(/[^a-z0-9]+/g, "");

// 1. Wikidata
const wiki = new Map();
try {
  const q = `SELECT ?placeLabel ?site WHERE { ?place wdt:P131+ wd:Q724; wdt:P856 ?site. SERVICE wikibase:label { bd:serviceParam wikibase:language "en". } }`;
  const res = await fetch(`https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(q)}`, { headers: { "User-Agent": UA, Accept: "application/sparql-results+json" } });
  for (const b of (await res.json()).results.bindings) { const k = key(b.placeLabel.value); wiki.set(k, [...(wiki.get(k) || []), b.site.value]); }
  console.log(`wikidata: ${wiki.size} Maine places with a website`);
} catch (err) { console.log(`wikidata failed: ${err.message}`); }

// 2. Patterns
const patterns = s => [`${s}maine.gov`, `${s}me.gov`, `townof${s}.org`, `townof${s}.com`, `townof${s}me.org`, `townof${s}maine.org`, `${s}maine.org`, `${s}maine.com`, `${s}maine.us`, `${s}me.org`, `${s}me.us`, `${s}-me.gov`, `${s}.me.us`, `cityof${s}.org`, `${s}maine.net`];

let last = 0;
async function load(url) {
  const wait = last + 1000 - Date.now(); if (wait > 0) await sleep(wait); last = Date.now();
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "text/html,*/*;q=0.5" }, redirect: "follow", signal: AbortSignal.timeout(15000) });
    return { status: res.status, url: res.url, html: res.ok ? (await res.text()).slice(0, 500_000) : "" };
  } catch (err) { return { status: 0, url, html: "", error: err.cause?.code || err.message }; }
}
function judge(e, r, c) {
  // A guessed address must still be the town's own domain after redirects (abbotme.com -> a news site is not Abbot).
  const h = host(r.url || c.url);
  // It must also start with the name (waterstreethallowell.org is a business group, not Hallowell).
  if (c.source === "address pattern" && !new RegExp(`^(townof|cityof)?${key(e.name)}`).test(h.replace(/[^a-z0-9.]/g, ""))) return null;
  // A plantation never takes a guessed address when a town has the same name (lincolnmaine.us is the Town of Lincoln).
  if (c.source === "address pattern" && e.type === "plantation" && queue.some(x => x.type !== "plantation" && key(x.name) === key(e.name))) return null;
  // Many Maine town names exist in other states (Union, Washington, Plymouth), so every match needs Maine evidence:
  // a Maine-style domain, the word Maine on the page, or a Maine ZIP code (039xx to 049xx).
  const maineHost = /maine|me\.(gov|org|us|com|net)$|\.me\.us$/.test(h);
  if (r.status === 403) return PARKED.test(r.url) || (c.source === "address pattern" && !maineHost) ? null : "blocked";
  if (r.status < 200 || r.status >= 300 || !r.html) return null;
  if (PARKED.test(r.url) || PARKED.test(r.html.slice(0, 20000))) return null;
  const title = decodeEntities((/<title[^>]*>([\s\S]*?)<\/title>/i.exec(r.html)?.[1] || "").replace(/\s+/g, " "));
  const name = e.name.toLowerCase();
  const raw = decodeEntities(r.html.replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ");
  const text = raw.toLowerCase();
  const maineText = /\bmaine\b/i.test(title + " " + raw) || /\bME\.?,?\s+0(39|4\d)\d{2}\b/.test(raw);
  if (!maineHost && !maineText) return null;
  if (title.toLowerCase().includes(name)) return "high";
  const n = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(town|city|plantation) of ${n}|${n},? (maine|me)\\b`).test(text) ? "medium" : null;
}

const rows = [];
for (const e of todo) {
  const tried = new Set([host(e.website || "")]);
  const cands = [];
  if (redirected.has(e.id) && !PARKED.test(redirected.get(e.id))) cands.push({ url: redirected.get(e.id), source: "listed site redirects here" });
  for (const u of wiki.get(key(e.name)) || []) cands.push({ url: u, source: "wikidata" });
  const s = key(e.name);
  for (const h of patterns(s)) {
    try { await dns.lookup(`www.${h}`); cands.push({ url: `https://www.${h}/`, source: "address pattern" }); }
    catch { try { await dns.lookup(h); cands.push({ url: `https://${h}/`, source: "address pattern" }); } catch {} }
  }
  let found = null;
  for (const c of cands) {
    if (tried.has(host(c.url)) && c.source !== "listed site redirects here") continue;
    tried.add(host(c.url));
    let r = await load(c.url);
    if (r.status === 0 && c.url.startsWith("https://")) r = await load(c.url.replace("https://", "http://"));
    const conf = judge(e, r, c);
    if (conf && (!found || ["blocked", "medium", "high"].indexOf(conf) > ["blocked", "medium", "high"].indexOf(found.conf))) found = { ...c, url: r.url || c.url, conf };
    if (found?.conf === "high") break;
  }
  const why = broken.get(e.id) || (redirected.has(e.id) ? "403 (redirects)" : "no website listed");
  rows.push([e.id, e.name, e.website || "", why, found?.url || "", found?.source || "", found?.conf || "none"]);
  console.log(`${e.id}: ${found ? `${found.conf} ${found.url} (${found.source})` : "nothing found"}`);
}
writeFile(OUT, toCSV([["entity_id", "town", "listed_website", "problem", "proposed_website", "source", "confidence"], ...rows]));
const by = {}; rows.forEach(r => (by[r[6]] = (by[r[6]] || 0) + 1));
console.log(`${rows.length} towns ${JSON.stringify(by)} -> ${OUT} (${iso(new Date())})`);
