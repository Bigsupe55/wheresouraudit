// Suggest links for rubric items 4 to 7 by reading each government's homepage and a few likely pages.
// Polite: identifies itself, one request about every 2 seconds, gives up after 15 seconds.
// Resumable: results go to data/review/suggestions.json and finished entities are skipped.
// It only SUGGESTS. A person confirms every item in the review tool.
// Usage: node scripts/review/crawl.mjs [--group=1] [--limit=50] [--ids=me-town-brunswick,fl-100002] [--redo]
import fs from "node:fs";
import { p, readJSON, writeJSON, decodeEntities } from "../lib/util.mjs";

const args = Object.fromEntries(process.argv.slice(2).map(a => a.replace(/^--/, "").split("=")).map(([k, v]) => [k, v ?? true]));
// Keep this short: a longer description made some town website platforms answer "404 not found".
const UA = "WheresOurAudit-review/0.1 (+https://wheresouraudit.pages.dev)";
const PAUSE = 2000, TIMEOUT = 15000, MAX_SUBPAGES = 5;
const OUT = p("data", "review", "suggestions.json");
const store = fs.existsSync(OUT) ? readJSON(OUT) : {};
const { queue } = readJSON(p("data", "review", "queue.json"));

export const PATTERNS = {
  budget: /\bbudget/i,
  audit_online: /\baudit|\bacfr\b|comprehensive annual financial|annual financial report|financial statements|financial report|annual (town )?report|town report/i,
  minutes: /\bminutes\b|\bagendas?\b/i,
  records_contact: /public records|records? request|\bfoaa\b|freedom of access|open records|right to know|request (a |for )?records/i,
};
// Pages worth opening for more links, best first: money pages, then clerk and records, then general menus.
const FOLLOW_RANK = [/financ|budget|audit|transparen/i, /clerk|records|foaa|public access/i, /meetings?|agendas?|minutes|board/i, /documents?|town office|administration|government|departments?/i];
const followRank = t => { const i = FOLLOW_RANK.findIndex(re => re.test(t)); return i < 0 ? 99 : i; };

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function get(url) {
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), TIMEOUT);
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "text/html,*/*;q=0.5" }, redirect: "follow", signal: ctl.signal });
    const type = res.headers.get("content-type") || "";
    const body = /html|xml|text/i.test(type) ? (await res.text()).slice(0, 2_000_000) : "";
    return { ok: res.ok, status: res.status, url: res.url, html: body };
  } catch (e) { return { ok: false, status: 0, url, html: "", error: e.name === "AbortError" ? "timeout" : e.message }; }
  finally { clearTimeout(t); }
}
function links(html, base) {
  const out = [];
  for (const m of html.matchAll(/<a\b[^>]*href\s*=\s*["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    let href; try { href = new URL(decodeEntities(m[1]), base).href; } catch { continue; }
    if (!/^https?:/i.test(href)) continue;
    const text = decodeEntities(m[2].replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim().slice(0, 160);
    out.push({ href, text });
  }
  return out;
}
const years = s => [...new Set((s.match(/\b20(1[5-9]|2[0-9])\b/g) || []))].sort();
// A link's path as words; some sites have badly encoded addresses, which must not stop the scan.
const pathWords = href => { const raw = href.split("?")[0].split("/").slice(3).join("/"); let s; try { s = decodeURIComponent(raw); } catch { s = raw; } return s.replace(/[-_]/g, " "); };
function suggest(all) {
  const res = {};
  for (const [item, re] of Object.entries(PATTERNS)) {
    const seen = new Set();
    res[item] = all.filter(l => re.test(l.text) || re.test(pathWords(l.href)))
      .filter(l => !seen.has(l.href) && seen.add(l.href))
      .map(l => ({ ...l, years: years(l.text + " " + l.href), score: (re.test(l.text) ? 2 : 0) + (years(l.text + l.href).length ? 1 : 0) + (/\.pdf($|\?)/i.test(l.href) ? 1 : 0)
        - (item !== "minutes" && /agenda|minutes|meeting/i.test(l.text + " " + l.href) ? 3 : 0) })) // a meeting packet is rarely the budget or audit page
      .sort((a, b) => b.score - a.score || (b.years.at(-1) || "").localeCompare(a.years.at(-1) || ""))
      .slice(0, 6);
  }
  return res;
}

// A website the reviewer typed in (data/manual/website-overrides.csv) replaces the listed one.
const ovFile = p("data", "manual", "website-overrides.csv");
if (fs.existsSync(ovFile)) {
  const { csvObjects, readText } = await import("../lib/util.mjs");
  const ov = new Map(csvObjects(readText(ovFile)).map(r => [r.entity_id, r.website]));
  for (const q of queue) if (ov.has(q.id)) { q.website = ov.get(q.id) || null; q.websiteSource = "entered by reviewer"; }
}
let list = queue.filter(q => q.website && q.gradable);
if (args.group) list = list.filter(q => q.group === +args.group);
if (args.ids) { const ids = new Set(String(args.ids).split(",")); list = list.filter(q => ids.has(q.id)); }
if (!args.redo) list = list.filter(q => !store[q.id]);
if (args.limit) list = list.slice(0, +args.limit);
console.log(`crawling ${list.length} websites`);
let n = 0;
for (const q of list) {
  const home = await get(q.website);
  const entry = { checkedAt: new Date().toISOString(), website: q.website, finalUrl: home.url, status: home.status, error: home.error || null, blocked: !home.ok, pages: [] };
  let all = [];
  // Warnings for the reviewer: the listed website may be stale (Census list is from 2022) or taken over.
  const hostOf = u => { try { return new URL(u).host.replace(/^www\./, ""); } catch { return ""; } };
  entry.warnings = [];
  if (!home.ok) entry.warnings.push(home.status ? `The listed website returned HTTP ${home.status}.` : `The listed website did not load (${home.error}).`);
  if (home.ok && hostOf(home.url) !== hostOf(q.website)) entry.warnings.push(`The listed website redirects to a different domain (${hostOf(home.url)}). Check it is really the official site.`);
  if (home.ok && home.html) {
    entry.title = (/<title[^>]*>([\s\S]*?)<\/title>/i.exec(home.html)?.[1] || "").replace(/\s+/g, " ").trim().slice(0, 120);
    const core = q.name.replace(/ (County|Plantation)$/, "").toLowerCase().replace(/[^a-z0-9 ]/g, "").split(" ").filter(w => w.length > 2 && !["city", "town", "of", "the", "district", "community", "development"].includes(w));
    if (core.length && !core.some(w => (entry.title + " " + home.html.slice(0, 50000)).toLowerCase().includes(w))) entry.warnings.push(`The page doesn't mention "${q.name}". Check it is really the official site.`);
    entry.placeholder = /coming soon|under construction|domain (is )?for sale|parked/i.test(home.html.slice(0, 20000)) && home.html.length < 20000;
    all = links(home.html, home.url);
    const host = new URL(home.url).host;
    const seenF = new Set();
    const follow = all.filter(l => new URL(l.href).host === host && !/\.(pdf|docx?|xlsx?|pptx?|zip)($|\?)/i.test(l.href) && followRank(l.text) < 99 && !seenF.has(l.href) && seenF.add(l.href))
      .sort((a, b) => followRank(a.text) - followRank(b.text)).slice(0, MAX_SUBPAGES);
    for (const f of follow) {
      await sleep(PAUSE);
      const sub = await get(f.href);
      entry.pages.push({ url: f.href, status: sub.status });
      if (sub.ok && sub.html) all = all.concat(links(sub.html, sub.url));
    }
  }
  entry.suggestions = suggest(all);
  store[q.id] = entry;
  writeJSON(OUT, store);
  n++;
  const counts = Object.entries(entry.suggestions).map(([k, v]) => `${k}:${v.length}`).join(" ");
  console.log(`${n}/${list.length} ${q.id} ${entry.blocked ? `BLOCKED (${entry.status || entry.error})` : counts}`);
  await sleep(PAUSE);
}
