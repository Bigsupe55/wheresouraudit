// Reference: re-test the website of every government in a state whose last scan failed, warned, or found no
// website, and find current addresses for the broken ones. OUTPUT IS PROPOSALS for a person's OK, written to
// data/review/<state>-website-proposals.csv (not committed). Approved rows go into data/manual/website-overrides.csv.
// Step 1, re-test the listed address: "fine now", "refuses robots" (403, a person must open it), "moved"
//   (redirects to another domain), "wrong site" (loads but doesn't name the government in the state), "dead".
// Step 2, search (moved, wrong site, dead, or no address):
//   - every kind: the domain the listed site redirects to.
//   - general-purpose governments only: Wikidata official website (P856, CC0), then the state's common address
//     patterns (cityof<name>.org, <name>fl.gov, townof<name>.org, <name>maine.gov, ...), DNS checked first.
//     Florida special districts get no guesses: their listed sites come from the state's current official list.
//     A Maine plantation gets no guesses when a town has the same name (lincolnmaine.us is the Town of Lincoln).
// Every candidate must name the government and show state evidence (a state-style domain, the state's name, or
// one of its ZIP codes), and must not be a business, placeholder or parked page. "high" = the page title names it
// AND the address is a government-only domain (.gov, .fl.us, .me.us) or the listed site redirects there;
// "medium" = any other match (a person must look: lookalike domains name the town too); "blocked" = 403.
// Polite: identifies itself, one request per second per worker, 6 workers on different sites.
// Usage: node scripts/reference/find-websites.mjs --state=FL|ME [--ids=fl-200007,...] [--limit=50]
import fs from "node:fs";
import dns from "node:dns/promises";
import { p, readJSON, readText, csvObjects, writeFile, toCSV, iso, decodeEntities } from "../lib/util.mjs";

const args = Object.fromEntries(process.argv.slice(2).map(a => a.replace(/^--/, "").split("=")).map(([k, v]) => [k, v ?? true]));
const ST = String(args.state || "").toUpperCase();
const STATES = {
  FL: {
    name: "Florida", wikidata: "Q812", noGuess: e => e.type === "district",
    host: /fl\.(gov|us|org|com|net)$|florida|\.fl\.us$|-fl\./, text: t => /\bflorida\b/.test(t) || /\bfl\.?,?\s+3[234]\d{3}\b/.test(t),
    prefix: "(townof|cityof|villageof|ci\\.|co\\.)?",
    patterns: (s, type) => type === "county"
      ? [`${s}countyfl.gov`, `${s}county.gov`, `${s}countyfl.net`, `${s}countyfl.org`, `${s}county.us`, `${s}county.org`, `${s}county.com`, `${s}bocc.com`, `${s}bocc.org`, `co.${s}.fl.us`, `${s}fl.gov`]
      : [`cityof${s}.com`, `cityof${s}.org`, `cityof${s}.gov`, `cityof${s}.net`, `cityof${s}fl.gov`, `cityof${s}fl.com`, `cityof${s}fl.org`, `cityof${s}-fl.gov`, `townof${s}-fl.gov`, `${s}fl.gov`, `${s}fl.org`, `${s}-fl.gov`, `${s}florida.gov`, `${s}florida.org`, `${s}.gov`, `townof${s}.com`, `townof${s}.org`, `townof${s}.gov`, `townof${s}.us`, `villageof${s}.com`, `villageof${s}.org`, `villageof${s}.gov`, `ci.${s}.fl.us`],
  },
  ME: {
    name: "Maine", wikidata: "Q724",
    // A plantation never takes a guessed address when a town has the same name.
    noGuess: (e, all) => e.type === "plantation" && all.some(x => x.type !== "plantation" && key(x.name) === key(e.name)),
    // "<town>me.com" is no evidence by itself (hudsonme.com is a designer's portfolio), so those pages must say Maine.
    host: /maine|\.me\.us$/, text: t => /\bmaine\b/.test(t) || /\bme\.?,?\s+0(39|4\d)\d{2}\b/.test(t),
    prefix: "(townof|cityof|co\\.)?",
    patterns: (s, type) => type === "county"
      ? [`${s}countymaine.gov`, `${s}countyme.gov`, `${s}county.me`, `${s}countymaine.org`, `${s}countyme.org`, `co.${s}.me.us`]
      // <town>.maine.gov is the state's own hosting for towns (athens.maine.gov, owlshead.maine.gov, friendship.maine.gov).
      : [`${s}.maine.gov`, `${s}maine.gov`, `${s}me.gov`, `townof${s}me.net`, `townof${s}me.gov`, `${s}me.com`, `${s}me.net`, `townof${s}.org`, `townof${s}.com`, `townof${s}me.org`, `townof${s}maine.org`, `${s}maine.org`, `${s}maine.com`, `${s}maine.us`, `${s}me.org`, `${s}me.us`, `${s}-me.gov`, `${s}.me.us`, `cityof${s}.org`, `${s}maine.net`],
  },
};
const S = STATES[ST];
if (!S) { console.log(`usage: node scripts/reference/find-websites.mjs --state=${Object.keys(STATES).join("|")}`); process.exit(1); }
const UA = "WheresOurAudit-review/0.1 (+https://wheresouraudit.pages.dev)";
const OUT = p("data", "review", `${ST.toLowerCase()}-website-proposals.csv`);
const WORKERS = 6;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const PARKED = /hugedomains|godaddy|sedo\.com|dan\.com|afternic|parkingcrew|bodis|domain (is )?for sale|buy this domain|this domain (name )?(may be|is) for sale|domain has expired|parked free/i;
// Businesses and groups that use a town's name, checked against the page title: keywestcity.com now sends visitors
// to a hotel site, oaklandparkfl.org is a news site, leecountyfl.org sells arrest records, palmbeachcounty.com is a
// nightlife guide, rangeleymaine.com is the chamber, andovermaine.com a visitor guide, hammondme.com a clinic.
const COMMERCIAL = /\bhotels?\b|\bmotels?\b|vacation rental|real estate|homes for sale|\brealtors?\b|news and info|\bnewspaper\b|\barrests?\b|mugshots?|inmate|background check|people search|things to do|nightlife|chamber of commerce|visitor guide|\bvisit\b|tourism|economic development|\bdowntown\b|therapy|\bclinic\b|this week in|happenings/gi;
// A word in the government's own name doesn't count ("Lakeland Downtown Development Authority" titles say downtown).
const commercial = (e, title) => (title.match(COMMERCIAL) || []).some(w => !e.name.toLowerCase().includes(w.toLowerCase()));
// Pages that are not a working site yet: cantonmaine.org, townofallagash.com, lee.me.us, Pixelated Cities placeholders.
const PLACEHOLDER = /coming soon|under construction|my wordpress blog|pixelated cities|domain is for people and organizations/i;
const govHost = h => /\.gov$|\.fl\.us$|\.me\.us$/.test(h);
const host = u => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return ""; } };

const all = readJSON(p("data", "review", "queue.json")).queue.filter(e => e.state === ST);
const scans = readJSON(p("data", "review", "suggestions.json"));
const ovFile = p("data", "manual", "website-overrides.csv");
const overridden = new Set(fs.existsSync(ovFile) ? csvObjects(readText(ovFile)).map(r => r.entity_id) : []);
let todo = all.filter(e => !overridden.has(e.id) && (!e.website ? !S.noGuess(e, all) : scans[e.id]?.blocked || scans[e.id]?.warnings?.length));
if (args.ids) { const ids = new Set(String(args.ids).split(",")); todo = all.filter(e => ids.has(e.id)); }
if (args.limit) todo = todo.slice(0, +args.limit);
console.log(`${S.name} governments to re-test: ${todo.length} (skipping ${all.filter(e => overridden.has(e.id)).length} already corrected)`);

// "City of Fort Myers" -> "fortmyers"; "Alachua County" -> "alachua"; "Drew Plantation" -> "drew".
function key(s) { return s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/^(the )?(city|town|village) of /, "").replace(/ (county|plantation)$/, "").replace(/[^a-z0-9]+/g, ""); }
const GENERIC = new Set(["city", "town", "village", "plantation", "of", "the", "county", "district", "community", "development", "special", "improvement", "authority", "and", "board", "florida", "maine", "water", "control", "dependent", "independent", "service", "services", "fire", "rescue", "soil", "conservation", "drainage", "housing", "library", "hospital", "port", "airport", "north", "south", "east", "west", "lake", "park"]);
const wikiKey = (s, county) => (county ? "county:" : "place:") + key(s);
const coreWords = s => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter(w => w.length > 2 && !GENERIC.has(w));

// Wikidata: official websites of places and counties in the state.
const wiki = new Map();
if (todo.some(e => !S.noGuess(e, all))) try {
  const q = `SELECT ?placeLabel ?site WHERE { ?place wdt:P131+ wd:${S.wikidata}; wdt:P856 ?site. SERVICE wikibase:label { bd:serviceParam wikibase:language "en". } }`;
  const res = await fetch(`https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(q)}`, { headers: { "User-Agent": UA, Accept: "application/sparql-results+json" } });
  // Keyed by kind as well as name: Okeechobee County is not the City of Okeechobee, Palm Beach County not the Town of Palm Beach.
  for (const b of (await res.json()).results.bindings) { const k = wikiKey(b.placeLabel.value, / county$/i.test(b.placeLabel.value)); wiki.set(k, [...(wiki.get(k) || []), b.site.value]); }
  console.log(`wikidata: ${wiki.size} ${S.name} places and counties with a website`);
} catch (err) { console.log(`wikidata failed: ${err.message}`); }

async function load(url) {
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "text/html,*/*;q=0.5" }, redirect: "follow", signal: AbortSignal.timeout(15000) });
    return { status: res.status, url: res.url, html: res.ok ? (await res.text()).slice(0, 500_000) : "" };
  } catch (err) { return { status: 0, url, html: "", error: err.cause?.code || err.name }; }
}
async function loadAny(url) {
  let r = await load(url);
  if (r.status === 0 && url.startsWith("https://")) { await sleep(1000); r = await load(url.replace("https://", "http://")); }
  else if (r.status === 0 && url.startsWith("http://")) { await sleep(1000); r = await load(url.replace("http://", "https://")); }
  return r;
}
// Does this page belong to this government? null, "blocked", "medium" or "high".
function judge(e, r, c) {
  const h = host(r.url || c.url);
  if (c.source === "address pattern" && !new RegExp(`^${S.prefix}${key(e.name)}`).test(h)) return null;
  const stateHost = S.host.test(h);
  if (r.status === 403) return PARKED.test(r.url) || (c.source === "address pattern" && !stateHost) ? null : "blocked";
  if (r.status < 200 || r.status >= 300 || !r.html) return null;
  if (PARKED.test(r.url) || PARKED.test(r.html.slice(0, 20000))) return null;
  const title = decodeEntities((/<title[^>]*>([\s\S]*?)<\/title>/i.exec(r.html)?.[1] || "").replace(/\s+/g, " ")).toLowerCase();
  if (commercial(e, title)) return null;
  const text = decodeEntities(r.html.replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").toLowerCase();
  if (PLACEHOLDER.test(title + " " + text.slice(0, 3000))) return null;
  if (!stateHost && !S.text(title + " " + text)) return null;
  // "high" needs more than a name match: a lookalike domain can name the county and the state
  // (gulfcountygovernment.com is now someone else's site, though Wikidata still lists it). So only a government-only
  // domain or a redirect from the listed official address can be "high"; any other find is at most "medium".
  const cap = conf => conf === "high" && !govHost(h) && c.source !== "listed site redirects here" ? "medium" : conf;
  return cap(nameMatch(e, title, text));
}
function nameMatch(e, title, text) {
  const words = coreWords(e.name);
  const plain = e.name.toLowerCase().replace(/^(the )?(city|town|village) of /, "").replace(/ (county|plantation)$/, "");
  // A county's page must say "<name> County" (the City of Okeechobee's site names Okeechobee but is not the county).
  if (e.type === "county") return title.includes(`${plain} county`) ? "high" : text.includes(`${plain} county`) ? "medium" : null;
  if (!words.length) return title.includes(plain) ? "high" : text.includes(plain) ? "medium" : null;
  if (words.every(w => title.includes(w))) return "high";
  return words.every(w => text.includes(w)) ? "medium" : null;
}

const rows = [], counts = {};
let next = 0;
async function worker() {
  while (next < todo.length) {
    const e = todo[next++];
    let state = "no address listed", movedTo = "";
    if (e.website) {
      const r = await loadAny(e.website);
      const sameHost = host(r.url) === host(e.website);
      if (r.status === 403) state = sameHost ? "refuses robots" : "moved";
      else if (r.status >= 200 && r.status < 300) state = !sameHost ? "moved" : judge(e, r, { source: "listed" }) ? "fine now" : "wrong site";
      else state = r.status ? `dead (HTTP ${r.status})` : `dead (${r.error})`;
      if (state === "moved") movedTo = r.url;
      await sleep(1000);
    }
    let found = null;
    if (!["fine now", "refuses robots"].includes(state)) {
      const tried = new Set([host(e.website || "")]);
      const cands = [];
      if (movedTo && !PARKED.test(movedTo)) cands.push({ url: movedTo, source: "listed site redirects here" });
      if (!S.noGuess(e, all)) {
        for (const u of wiki.get(wikiKey(e.name, e.type === "county")) || []) cands.push({ url: u, source: "wikidata" });
        for (const h of S.patterns(key(e.name), e.type)) {
          try { await dns.lookup(`www.${h}`); cands.push({ url: `https://www.${h}/`, source: "address pattern" }); }
          catch { try { await dns.lookup(h); cands.push({ url: `https://${h}/`, source: "address pattern" }); } catch {} }
        }
      }
      for (const c of cands) {
        if (tried.has(host(c.url)) && c.source !== "listed site redirects here") continue;
        tried.add(host(c.url));
        const r = await loadAny(c.url);
        await sleep(1000);
        const conf = judge(e, r, c);
        // Best confidence wins; on a tie, a government-only domain beats any other.
        const score = (f, u) => ["blocked", "medium", "high"].indexOf(f) * 2 + (govHost(host(u)) ? 1 : 0);
        if (conf && (!found || score(conf, r.url || c.url) > score(found.conf, found.url))) found = { ...c, url: r.url || c.url, conf };
        if (found?.conf === "high" && govHost(host(found.url))) break;
      }
    }
    counts[state.replace(/ \(.*/, "")] = (counts[state.replace(/ \(.*/, "")] || 0) + 1;
    rows.push([e.id, e.name, e.type, e.website || "", state, found?.url || "", found?.source || "", found?.conf || (["fine now", "refuses robots"].includes(state) ? "" : "none")]);
    if (rows.length % 50 === 0) console.log(`${rows.length}/${todo.length} ${JSON.stringify(counts)}`);
  }
}
await Promise.all(Array.from({ length: WORKERS }, worker));
rows.sort((a, b) => a[0].localeCompare(b[0]));
writeFile(OUT, toCSV([["entity_id", "name", "type", "listed_website", "listed_site_now", "proposed_website", "source", "confidence"], ...rows]));
const conf = {}; rows.forEach(r => r[7] && (conf[r[7]] = (conf[r[7]] || 0) + 1));
console.log(`${rows.length} governments: ${JSON.stringify(counts)}; proposals ${JSON.stringify(conf)} -> ${OUT} (${iso(new Date())})`);
