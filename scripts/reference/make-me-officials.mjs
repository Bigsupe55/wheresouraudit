// Reference: Maine municipal governing board members (select board / town or city council) and mayors,
// for the "Who's responsible" panel.
// OUTPUT IS UNCONFIRMED CANDIDATES written to data/review/me-officials-candidates.csv (not published).
// A name goes on the site only after a person confirms it in the review tool.
// NAME AND TITLE ONLY: never phones, emails, addresses or party.
// Sources:
//   1. Open States people data, data/me/municipalities (CC0)
//   2. Wikidata: Maine places with P6 head of government that has no end time (CC0); needs a start date
//      of 2018 or later, the same rule as make-fl-mayors.mjs
//   3. Town websites (group 1 entries in data/review/queue.json with a website). Polite: identifies itself,
//      one request every 2 seconds, at most 3 pages per town (homepage + 2 board pages). A name is kept
//      only from a page about the board whose text pairs it with a board title, and only when the page
//      lists at least 2 such pairs.
// Not used: Maine Municipal Association directory (member/paid product, no reuse terms), SOS clerk list
// and MRS municipal listing (clerks and office contacts only, no board members).
// Also writes data/review/me-board-links.csv (board pages found per town, for the /boards review page).
// Usage: node scripts/reference/make-me-officials.mjs [--limit=60] [--ids=me-town-brunswick,...] [--no-web]
//   --limit picks an even spread across the website list (pilot); --limit=0 means all.
import { p, readJSON, writeFile, toCSV, iso, decodeEntities } from "../lib/util.mjs";

const args = Object.fromEntries(process.argv.slice(2).map(a => a.replace(/^--/, "").split("=")).map(([k, v]) => [k, v ?? true]));
const UA = "WheresOurAudit-review/0.1 (+https://wheresouraudit.pages.dev)";
const PAUSE = 2000, TIMEOUT = 15000, MAX_PAGES = 3;
const TODAY = iso(new Date());
const OUT = p("data", "review", "me-officials-candidates.csv");
// Board pages found on each town's website, so a reviewer can open them in the /boards page of the review tool.
const LINKS_OUT = p("data", "review", "me-board-links.csv");
const boardPages = [];
const sleep = ms => new Promise(r => setTimeout(r, ms));

const me = readJSON(p("data", "derived", "maine.json"));
const key = s => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/\b(city|town|plantation|village)\b/g, "").replace(/[^a-z0-9]+/g, "");
const byKey = new Map();
for (const e of me.entities.filter(e => e.type !== "county")) if (!byKey.has(key(e.name)) || e.type === "city") byKey.set(key(e.name), e);

const rows = [];
const add = (e, role, name, source, url) => rows.push([e.id, e.name, role, name, source, url, TODAY]);

async function api(url, accept) {
  const res = await fetch(url, { headers: { "User-Agent": UA, ...(accept ? { Accept: accept } : {}) } });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return res;
}

// ---- 1. Open States
const osKeys = new Set();
try {
  const RAW = "https://raw.githubusercontent.com/openstates/people/main/data/me";
  const BLOB = "https://github.com/openstates/people/blob/main/data/me/municipalities";
  const files = (await (await api("https://api.github.com/repos/openstates/people/contents/data/me/municipalities", "application/vnd.github+json")).json()).filter(f => f.name.endsWith(".yml"));
  for (const f of files) {
    const t = await (await api(`${RAW}/municipalities/${f.name}`)).text();
    const name = /^name:\s*(.+)$/m.exec(t)[1].trim().replace(/^'(.*)'$/, "$1").replace(/''/g, "'");
    for (const block of t.split(/\n\s*-\s+(?=\w+:)/).slice(1)) {
      const g = k => (new RegExp(`\\b${k}:\\s*['"]?(.*?)['"]?\\s*$`, "m").exec(block) || [])[1] || "";
      const jur = g("jurisdiction");
      if (!jur.includes("place:")) continue;
      if (g("end_date") && g("end_date") < TODAY) continue;
      const e = byKey.get(key(jur.replace(/^.*place:([^/]+).*$/, "$1").replace(/_/g, " ")));
      if (!e) continue;
      const role = g("type") === "mayor" ? "Mayor" : g("title") || "Council Member";
      add(e, role, name, "openstates", `${BLOB}/${f.name}`);
      osKeys.add(`${e.id}|${role}`);
    }
  }
} catch (err) { console.log(`openstates failed: ${err.message}`); }

// ---- 2. Wikidata
try {
  const q = `SELECT ?place ?placeLabel ?headLabel ?start WHERE {
    ?place wdt:P131+ wd:Q724; p:P6 ?st. ?st ps:P6 ?head; wikibase:rank ?rank.
    FILTER NOT EXISTS { ?st pq:P582 [] } FILTER(?rank != wikibase:DeprecatedRank)
    OPTIONAL { ?st pq:P580 ?start }
    SERVICE wikibase:label { bd:serviceParam wikibase:language "en". } }`;
  const b = (await (await api(`https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(q)}`, "application/sparql-results+json")).json()).results.bindings;
  for (const x of b) {
    const e = byKey.get(key(x.placeLabel.value)), start = x.start?.value?.slice(0, 10) || "";
    if (!e || !start || start < "2018") continue;
    if (osKeys.has(`${e.id}|Mayor`)) continue; // Open States already has this office
    add(e, "Mayor", x.headLabel.value, "wikidata", x.place.value.replace("http://", "https://"));
  }
} catch (err) { console.log(`wikidata failed: ${err.message}`); }

// ---- 3. Town websites
const BOARD_LINK = /select\s*board|board\s+of\s+select|selectm[ae]n|select\s*persons?|town\s+council|city\s+council|elected\s+officials|municipal\s+officers|board\s+of\s+assessors,?\s+overseers/i;
const TITLE = String.raw`(?:(?:vice|deputy)[\s-]*)?(?:chair(?:man|woman|person)?|mayor|selectm[ae]n|selectwom[ae]n|selectpersons?|select\s*board\s+member|(?:town\s+|city\s+)?council(?:or|lor|\s+member)|councilors?\s+at[\s-]large|at[\s-]large(?:\s+councilor)?|(?:district|ward)\s*\d+|member|secretary|assessor|overseer)`;
const TITLE_RE_RAW = new RegExp(`^${TITLE}(?:\\s*(?:,|/|&|and|-|–)\\s*${TITLE})*(?:\\s*[,(-]?\\s*(?:district|ward)\\s*\\d+\\)?)?$`, "i");
// Term dates ("Mayor (1/2027)", "Chair, term expires 2026") are dropped before the title is tested.
const stripTerm = s => s.replace(/\s*\(?\s*(?:term\s*(?:expires|ends)?:?\s*)?(?:\d{1,2}\/)?(?:\d{1,2}\/)?(?:19|20)\d{2}\s*\)?\s*$/i, "").replace(/\s*[,;:|-]\s*$/, "").trim();
const TITLE_RE = { test: s => TITLE_RE_RAW.test(stripTerm(s)) };
const NAME_WORD = String.raw`(?:[A-Z][a-z'’]+(?:-[A-Z][a-z'’]+)?|Mc[A-Z][a-z]+|O'[A-Z][a-z]+|[A-Z]\.)`;
const NAME_RE = new RegExp(`^(?:(?:Dr|Mr|Mrs|Ms)\\.?\\s+)?${NAME_WORD}(?:\\s+(?:["“][A-Z][a-z]+["”]|${NAME_WORD})){1,3}(?:,?\\s+(?:Jr\\.?|Sr\\.?|II|III|IV))?$`);
const NOT_NAME = /\b(Town|City|Board|Select|Council|Office|Maine|Clerk|Hall|Meeting|Meetings|Street|Road|Avenue|Department|Members?|Minutes|Agenda|Chair|Manager|Administrator|Treasurer|Mayor|Selectmen|Contact|Home|Committee|Plantation|Police|Fire|Public|County|School|The|Of|And|Village|Vice|Ward|District|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|January|February|March|April|May|June|July|August|September|October|November|December|Term|Expires|Elected|Officials?|Staff|Assessors?|Overseers?|Secretary|Phone|Email|Fax)\b/;

async function get(url) {
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), TIMEOUT);
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "text/html,*/*;q=0.5" }, redirect: "follow", signal: ctl.signal });
    const type = res.headers.get("content-type") || "";
    return { ok: res.ok, status: res.status, url: res.url, html: /html|text/i.test(type) ? (await res.text()).slice(0, 2_000_000) : "" };
  } catch (e) { return { ok: false, status: 0, url, html: "", error: e.name === "AbortError" ? "timeout" : e.message }; }
  finally { clearTimeout(t); }
}
function boardLinks(html, base) {
  const out = [];
  for (const m of html.matchAll(/<a\b[^>]*href\s*=\s*["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    let href; try { href = new URL(decodeEntities(m[1]), base).href; } catch { continue; }
    if (!/^https?:/i.test(href) || /\.(pdf|docx?|jpe?g|png)(\?|$)/i.test(href)) continue;
    const text = decodeEntities(m[2].replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
    if (text.length > 60 || /minutes|agenda|meeting|video|apply|vacanc|election\s+results/i.test(text)) continue;
    let path = href; try { path = decodeURIComponent(href); } catch {}
    const score = BOARD_LINK.test(text) ? 2 : BOARD_LINK.test(path.replace(/[-_]/g, " ")) ? 1 : 0;
    if (score) out.push({ href: href.split("#")[0], score: score + (/elected/i.test(text) ? -0.5 : 0) });
  }
  const seen = new Set();
  return out.sort((a, b) => b.score - a.score).filter(l => !seen.has(l.href) && seen.add(l.href));
}
// Page text as lines, contact details removed before any parsing.
function lines(html) {
  const body = html.replace(/<(script|style|noscript|nav|header|footer)\b[\s\S]*?<\/\1>/gi, " ");
  return decodeEntities(body.replace(/<br\s*\/?>|<\/(p|div|li|tr|td|th|h\d|dd|dt|span|strong|b)>/gi, "\n").replace(/<[^>]+>/g, " "))
    .replace(/\S+@\S+\.\w+/g, " ").replace(/\(?\d{3}\)?[\s.-]*\d{3}[\s.-]*\d{4}/g, " ")
    .split(/\n/).map(s => s.replace(/[\s ]+/g, " ").trim()).filter(Boolean);
}
const titleCase = s => s.toLowerCase().replace(/(^|[\s-])([a-z])/g, (m, a, b) => a + b.toUpperCase());
function roleFor(title, body) {
  const t = title.toLowerCase();
  if (/mayor/.test(t)) return /deputy/.test(t) ? "Deputy Mayor" : "Mayor";
  const pos = /vice|deputy/.test(t) ? " Vice Chair" : /chair/.test(t) ? " Chair" : /council/.test(t) ? " Councilor" : " Member";
  return body + pos.replace(" Councilor", " Member");
}
const cleanName = s => s.replace(/^(?:Dr|Mr|Mrs|Ms)\.?\s+/, "").replace(/\s+/g, " ").trim();
function extract(html) {
  const L = lines(html);
  const text = L.join(" ");
  const body = /select\s*board|selectm[ae]n|select\s*persons?/i.test(text) ? "Select Board" : /city\s+council/i.test(text) ? "City Council" : /town\s+council/i.test(text) ? "Town Council" : "Select Board";
  const found = new Map();
  const take = (name, title) => {
    name = cleanName(name); title = title.trim().replace(/[()]/g, "").trim();
    if (!NAME_RE.test(name) || NOT_NAME.test(name) || !TITLE_RE.test(title)) return;
    if (/^(member|secretary|assessor|overseer)$/i.test(title) && body === "Select Board" && !/select|council/i.test(text)) return;
    if (!found.has(name)) found.set(name, roleFor(title, body));
  };
  for (let i = 0; i < L.length; i++) {
    const s = L[i].replace(/\s*[,;|]\s*$/, "").replace(/\s*term\s*(expires|ends)?:?.*$/i, "").replace(/\s*\(?\s*(19|20)\d{2}\s*\)?$/, "").trim();
    let m;
    if ((m = /^(.+?)\s*(?:,|\s[-–—]\s|:|\()\s*(.+?)\)?$/.exec(s))) { take(m[1], m[2]); take(m[2], m[1]); }
    if (i + 1 < L.length && NAME_RE.test(cleanName(s)) && TITLE_RE.test(L[i + 1].replace(/[,:]$/, ""))) take(s, L[i + 1].replace(/[,:]$/, ""));
  }
  return found.size >= 2 && found.size <= 15 ? [...found].map(([name, role]) => ({ name, role })) : [];
}
const isBoardPage = (html, url) => BOARD_LINK.test((/<title>([\s\S]*?)<\/title>/i.exec(html)?.[1] || "") + " " + (/<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(html)?.[1] || "").replace(/<[^>]+>/g, " ") + " " + url.replace(/[-_]/g, " "));

if (!args["no-web"]) {
  let list = readJSON(p("data", "review", "queue.json")).queue.filter(e => e.state === "ME" && e.group == 1 && e.website && e.type !== "county");
  if (args.ids) { const ids = new Set(String(args.ids).split(",")); list = list.filter(e => ids.has(e.id)); }
  const limit = args.limit === undefined ? 60 : +args.limit;
  if (limit && list.length > limit) { const step = list.length / limit; list = Array.from({ length: limit }, (_, i) => list[Math.floor(i * step)]); }
  const stats = { towns: list.length, unreachable: 0, noBoardPage: 0, noNames: 0, withNames: 0 };
  let last = 0;
  const politeGet = async url => { const wait = last + PAUSE - Date.now(); if (wait > 0) await sleep(wait); last = Date.now(); return get(url); };
  for (const e of list) {
    const home = await politeGet(e.website);
    if (!home.ok || !home.html) { stats.unreachable++; console.log(`  ${e.id}: unreachable (${home.status || home.error})`); continue; }
    const cands = [];
    if (isBoardPage(home.html, home.url)) cands.push(home);
    const allLinks = boardLinks(home.html, home.url).filter(l => l.href !== home.url);
    if (cands.length) boardPages.push([e.id, home.url]);
    for (const l of allLinks.slice(0, 4)) boardPages.push([e.id, l.href]);
    const links = allLinks.slice(0, MAX_PAGES - 1);
    if (!links.length && !cands.length) { stats.noBoardPage++; console.log(`  ${e.id}: no board page`); continue; }
    let got = null;
    for (const l of links) {
      const r = await politeGet(l.href);
      if (r.ok && r.html) cands.push(r);
      const res = r.ok && r.html ? extract(r.html) : [];
      if (res.length) { got = { url: r.url, res }; break; }
    }
    if (!got && cands[0] === home) { const res = extract(home.html); if (res.length) got = { url: home.url, res }; }
    if (!got) { stats.noNames++; console.log(`  ${e.id}: board page, no clear list (${links.map(l => l.href).join(" ")})`); continue; }
    stats.withNames++;
    for (const r of got.res) add(e, r.role, r.name, "town-website", got.url);
    console.log(`  ${e.id}: ${got.res.length} names from ${got.url}`);
  }
  console.log(`web: ${JSON.stringify(stats)}`);
  writeFile(LINKS_OUT, toCSV([["entity_id", "url"], ...boardPages]));
  console.log(`${boardPages.length} board page links, ${new Set(boardPages.map(r => r[0])).size} towns -> ${LINKS_OUT}`);
}

rows.sort((a, b) => a[1].localeCompare(b[1]) || a[2].localeCompare(b[2]) || a[3].localeCompare(b[3]));
writeFile(OUT, toCSV([["entity_id", "town", "role", "name", "source", "source_url", "retrieved"], ...rows]));
const bySrc = {};
rows.forEach(r => (bySrc[r[4]] = (bySrc[r[4]] || 0) + 1));
console.log(`${rows.length} candidate rows, ${new Set(rows.map(r => r[0])).size} towns ${JSON.stringify(bySrc)} -> ${OUT}`);
