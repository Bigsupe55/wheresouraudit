// Build the static site into dist/ from data/derived/*.json (Maine and Florida).
// Usage: node scripts/build-site.mjs
import fs from "node:fs";
import { p, readJSON, readText, writeFile, esc, fmtDate } from "./lib/util.mjs";
import { ITEMS, RUBRIC_VERSION } from "./lib/rubric.mjs";

const DIST = p("dist");
fs.rmSync(DIST, { recursive: true, force: true });
const CONFIG = readJSON(p("site.config.json"));
const SITE = CONFIG.site;
const MAILTO = CONFIG.correctionsEmail;
const BUILT = new Date().toISOString().slice(0, 10);
const ME = readJSON(p("data", "derived", "maine.json"));
const FL = readJSON(p("data", "derived", "florida.json"));
const US = fs.existsSync(p("data", "derived", "us.json")) ? readJSON(p("data", "derived", "us.json")) : null;

// ---------- per-state settings ----------
const law = s => `Required by law here (${s})`;
const BEST = "Best practice here";
const STATES = {
  ME: {
    code: "ME", slug: "me", name: "Maine", data: ME,
    deadline: "12 months (our rule)",
    basis: (e, n) => n <= 2
      ? (e.type === "county" ? "Law for audits due from July 29, 2026 (30-A s.951); our rule before" : "Our rule here (Maine sets no deadline)")
      : "Best practice here (not required online in Maine)",
    ombudsman: "Stuck? Maine's Public Access Ombudsman can help: (207) 626-8577.",
    sentNote: "In Maine, the office should acknowledge it within 5 working days.",
    legend: [["bad", "Not posted, over 12 months"], ["warn", "Posted late"], ["good", "Posted on time"], ["none", "No town government listed"]],
  },
  FL: {
    code: "FL", slug: "fl", name: "Florida", data: FL,
    deadline: "9 months (Florida law)",
    basis: (e, n) => {
      const t = e.type;
      if (n <= 2) return law("s.218.39, s.218.32");
      if (n === 3) return t === "district" ? law("s.189.069") : BEST;
      if (n === 4) return t === "county" ? law("s.129.03") : t === "city" ? law("s.166.241") : t === "district" ? law("s.189.069") : BEST;
      if (n === 5) return law(t === "district" ? "s.218.32(1)(g), s.189.069" : "s.218.32(1)(g)");
      if (n === 6) return t === "district" ? law("s.189.069") : BEST;
      return "Best practice here (Florida asks for it, s.119.12(2))";
    },
    ombudsman: "Florida's Office of the Attorney General publishes the Government-in-the-Sunshine Manual, which explains your rights.",
    sentNote: "Florida law requires a prompt, good faith response. Keep your dated copy: the 5-business-day notice in s.119.12 counts from when the office receives it.",
    legend: [["bad", "3 or more governments not filed"], ["warn", "1 or 2 not filed"], ["good", "All filed"]],
  },
};
const ALL = [...ME.entities, ...FL.entities];

// ---------- layout ----------
const DISCLOSURE = "Built by Nick Hernandez, founder of Civic-Chain, which sells financial transparency software to governments. Every town is graded the same way, customer or not. Civic-Chain never uses this site for sales.";
function page({ title, description, body, path }) {
  const full = title === "Where's Our Audit?" ? title : `${title} | Where's Our Audit?`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(full)}</title>
<meta name="description" content="${esc(description)}">
<meta property="og:title" content="${esc(full)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="https://${SITE}${path}">
<meta name="twitter:card" content="summary">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/assets/site.css">
</head>
<body>
<header class="site"><a class="logo" href="/">Where's Our Audit?</a>
<nav><a href="/me/">Maine</a><a href="/fl/">Florida</a><a href="/us/">Other states</a><a href="/how-we-grade/">How we grade</a><a href="/corrections/">Corrections</a></nav></header>
<main>
${body}
</main>
<footer class="disclosure">${esc(DISCLOSURE)} · <a href="/how-we-grade/">How we grade</a> · <a href="/corrections/">Corrections log</a> · <a href="/unmatched/">Records we couldn't match</a> · <a href="/audits-that-showed-up/">Audits that showed up</a></footer>
<script src="/assets/app.js" defer></script>
</body>
</html>
`;
}
const out = (path, html) => writeFile(p("dist", ...path.split("/").filter(Boolean), "index.html"), html);

// ---------- pieces ----------
function flagHTML(f) {
  return `<div class="flag ${f.cls}">
  <span class="pill s-${f.cls}">${esc(f.label)}</span>
  <div class="sentence">${esc(f.sentence)}</div>
  <div class="meta">
    <span>Rule: ${esc(f.rule)} ${f.ourRule ? '<span class="badge">Our rule</span>' : ""}</span>
    <a href="${esc(f.source)}" rel="noopener">Source</a>
    ${f.sourceCopy ? `<a href="${esc(f.sourceCopy)}">Our dated copy</a>` : ""}
    <span>As of ${esc(f.asOf)}</span>
    <a href="mailto:${MAILTO}?subject=${encodeURIComponent("Correction: " + f.key)}">Something wrong? Report a correction</a>
  </div>
  ${f.reply ? `<div class="reply"><b>Official reply</b> (${esc(f.reply.from_office)}, ${esc(f.reply.received_on)}): ${esc(f.reply.reply_text)}</div>` : ""}
</div>`;
}
function checklistHTML(e, S) {
  if (e.dissolved) return `<p class="small muted">No grade: ${esc(e.name)} was dissolved on ${fmtDate(e.dissolved)}.</p>`;
  if (e.gradable === false) return `<p class="small muted">Status only. We don't grade this kind of entity (${esc(e.typeLabel.toLowerCase())}).</p>`;
  return `<table>
<tr><th>#</th><th>Item</th><th>Points</th><th>Basis</th></tr>
${ITEMS.map((it, i) => {
    const v = e.pts[i];
    const ev = e.evidence[it.key];
    return `<tr><td>${it.n}</td><td>${esc(it.label)}${ev?.url ? ` <a class="small" href="${esc(ev.url)}">evidence</a>` : ""}</td><td>${v === null ? '<span class="muted">Not checked yet</span>' : `${v} / ${it.max}`}</td><td class="small muted">${esc(S.basis(e, it.n))}</td></tr>`;
  }).join("\n")}
<tr><th></th><th>Total</th><th>${e.graded ? `${e.score} / 100` : "Not graded yet"}</th><th class="small muted">Rubric v${RUBRIC_VERSION}</th></tr>
</table>
${e.graded ? "" : `<p class="small muted">Items 3 to 7 need a person to check ${esc(e.name)}'s website. Until all 7 are checked, we show no grade.</p>`}`;
}
const shareHTML = e => `<div class="share" aria-label="Share card preview"><div class="q">Where's Our Audit?</div><div class="fact"><b>${esc(e.name)}, ${e.state}:</b> ${esc(e.headline)}</div><div class="foot">${SITE}${e.url} · sourced to public records</div></div>`;

function letterHTML(e, S) {
  const data = { state: e.state, entity: e.name, type: e.type, fy: e.letter.fy, fyeText: fmtDate(e.letter.fye), dueText: fmtDate(e.letter.due), missing: e.letter.missing, sourcePage: e.sourcePage };
  return `<form data-letter class="card" onsubmit="return false">
  <p class="small muted">Send it yourself. We never send anything for you. Copy it into an email or print it for:<br><b>${esc(e.contact.office)}</b>${e.contact.detail ? `<br>${esc(e.contact.detail)}` : ""}${e.contact.source ? `<br><span class="small">Contact from the ${esc(e.contact.source)}.</span>` : ""}</p>
  <div class="letter-grid">
    <div><label for="l-name">Your name${e.state === "FL" ? " (optional in Florida)" : ""}</label><input id="l-name" name="name" autocomplete="name"></div>
    <div><label for="l-email">Your email (to receive the records)</label><input id="l-email" name="email" type="email" autocomplete="email"></div>
    <div><label for="l-cap">Contact me before charges over $</label><input id="l-cap" name="cap" type="number" min="0" value="25"></div>
    <div><label><input name="waive" type="checkbox" checked style="width:auto"> Ask for a fee waiver</label></div>
  </div>
  <label for="l-text">Your letter</label>
  <textarea id="l-text" readonly></textarea>
  <div class="actions no-print">
    <button type="button" data-copy>Copy letter</button>
    <button type="button" class="ghost" data-mail>Open in my email app</button>
    <button type="button" class="ghost" data-print>Print</button>
  </div>
  <p class="small muted">${esc(S.ombudsman)} Your name and email stay in your browser; this page does not save or send them.</p>
  <script type="application/json" id="letter-data">${JSON.stringify(data).replace(/</g, "\\u003c")}</script>
</form>`;
}

// ---------- entity pages ----------
for (const e of ALL) {
  const S = STATES[e.state];
  const gradeBox = e.dissolved ? '<div class="grade ng">Dissolved</div>'
    : e.gradable === false ? '<div class="grade ng">Status only</div>'
    : `<div class="grade ${e.graded ? "" : "ng"}">${e.graded ? e.grade : "Not graded yet"}</div>`;
  const where = e.state === "FL" && e.county && e.type !== "county" ? ` · ${esc(e.county)} County` : "";
  const body = `
<p class="crumb"><a href="/${S.slug}/">${S.name}</a> › ${esc(e.typeLabel)}${where}</p>
<div class="top">
  ${gradeBox}
  <div>
    <h1 style="margin:0 0 6px">${esc(e.name)}, ${e.state}</h1>
    <span class="pill s-${e.status.cls}">${esc(e.status.label)}</span>
    <p style="margin:10px 0 0">${esc(e.headline)}.</p>
    ${e.type === "village" ? '<p class="small muted">A village corporation is a small local district inside a town, with its own budget.</p>' : ""}
    ${e.type === "district" ? '<p class="small muted">A special district is a local government with one job, such as water, fire, roads or a community development district.</p>' : ""}
    <p class="small muted">${e.graded ? `Score ${e.score} / 100 · ` : ""}As of ${esc(S.data.asOf)} · <a href="/how-we-grade/">How we grade</a></p>
  </div>
</div>
<div class="cols">
  <div>
    <h2>What we found</h2>
    ${e.flags.map(flagHTML).join("\n") || '<p class="muted">Nothing due yet.</p>'}
    <h2>Ask for it</h2>
    ${letterHTML(e, S)}
  </div>
  <div>
    <h2>Report card</h2>
    <div class="card">${checklistHTML(e, S)}</div>
    <h2>Share</h2>
    ${shareHTML(e)}
    <h2>Who to ask</h2>
    <div class="card small">${esc(e.contact.office)}${e.contact.detail ? `<br>${esc(e.contact.detail)}` : ""}${e.firm ? `<br><span class="muted">Audit firm on record with the State Auditor: ${esc(e.firm)}</span>` : ""}${e.dfsId ? `<br><span class="muted">Florida DFS entity ID: ${esc(e.dfsId)}</span>` : ""}</div>
  </div>
</div>`;
  out(e.url, page({ title: `${e.name}, ${e.state}`, description: `${e.name}, ${S.name}: ${e.headline}. See the record and ask for it in one click.`, body, path: e.url }));
}

// ---------- maps (static SVG) ----------
function geoSVG(features, { label, fillFor, hrefFor, titleFor }) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  const rings = f => f.geometry.type === "Polygon" ? f.geometry.coordinates : f.geometry.coordinates.flat();
  for (const f of features) for (const r of rings(f)) for (const [x, y] of r) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
  const kx = Math.cos(((minY + maxY) / 2) * Math.PI / 180), W = 600, scale = W / ((maxX - minX) * kx), H = Math.round((maxY - minY) * scale);
  const proj = ([x, y]) => [(x - minX) * kx * scale, (maxY - y) * scale];
  // Drop points closer than 1 px to the last kept point: invisible at this size, and it cuts page weight a lot.
  const ringPath = r => {
    const pts = r.map(proj), kept = [pts[0]];
    for (const q of pts.slice(1)) { const l = kept[kept.length - 1]; if (Math.hypot(q[0] - l[0], q[1] - l[1]) >= 1) kept.push(q); }
    return kept.length < 3 ? "" : "M" + kept.map(([a, b]) => `${a.toFixed(1)},${b.toFixed(1)}`).join("L") + "Z";
  };
  const paths = features.map(f => {
    const d = rings(f).map(ringPath).join("");
    const href = hrefFor(f), path = `<path class="f-${fillFor(f)}" d="${d}"><title>${esc(titleFor(f))}</title></path>`;
    return href ? `<a href="${href}">${path}</a>` : path;
  });
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)}">${paths.join("")}</svg>`;
}
const CLS = { overdue: "bad", late: "warn", on_time: "good", not_due: "none" };
function maineMap() {
  const geo = readJSON(p("data", "reference", "me-municipalities.geojson"));
  const byGeoid = new Map(ME.entities.filter(e => e.geoid).map(e => [e.geoid, e]));
  return geoSVG(geo.features, {
    label: "Map of Maine towns colored by audit status",
    fillFor: f => { const e = byGeoid.get(f.properties.GEOID); return e ? CLS[e.worst] : "none"; },
    hrefFor: f => byGeoid.get(f.properties.GEOID)?.url,
    titleFor: f => { const e = byGeoid.get(f.properties.GEOID); return e ? `${e.name}: ${e.headline}` : `${f.properties.NAME}: no town government on the State Auditor's list`; },
  });
}
const flCounties = () => {
  const groups = new Map();
  for (const e of FL.entities.filter(e => e.county && !e.dissolved)) { if (!groups.has(e.county)) groups.set(e.county, []); groups.get(e.county).push(e); }
  return groups;
};
const countySlug = n => n.toLowerCase().replace(/[^a-z0-9]+/g, "-");
function floridaMap(groups) {
  const geo = readJSON(p("data", "reference", "fl-counties.geojson"));
  const key = n => n.replace(/^St\.? /, "St. ").toLowerCase();
  const byName = new Map([...groups].map(([k, v]) => [key(k), v]));
  return geoSVG(geo.features, {
    label: "Map of Florida counties colored by how many local governments have not filed",
    fillFor: f => { const g = byName.get(key(f.properties.NAME)) || []; const n = g.filter(e => e.worst === "overdue").length; return n >= 3 ? "bad" : n >= 1 ? "warn" : g.length ? "good" : "none"; },
    hrefFor: f => byName.has(key(f.properties.NAME)) ? `#county-${countySlug(f.properties.NAME)}` : null,
    titleFor: f => { const g = byName.get(key(f.properties.NAME)) || []; return `${f.properties.NAME} County: ${g.filter(e => e.worst === "overdue").length} of ${g.length} county and city governments not filed`; },
  });
}

// ---------- state pages ----------
const ORDER = { overdue: 0, late: 1, on_time: 2, not_due: 3 };
const rowHTML = e => `<tr><td><a href="${e.url}">${esc(e.name)}</a></td><td><span class="pill s-${e.status.cls}">${esc(e.status.label)}</span></td><td class="small">${esc(e.headline)}</td><td>${e.dissolved ? '<span class="muted small">Dissolved</span>' : e.graded ? e.grade : '<span class="muted small">Not graded yet</span>'}</td></tr>`;
const tableOf = list => `<table><tr><th>Name</th><th>Latest due</th><th>Summary</th><th>Grade</th></tr>${list.sort((a, b) => ORDER[a.worst] - ORDER[b.worst] || a.name.localeCompare(b.name)).map(rowHTML).join("")}</table>`;
const searchBox = `<div class="search sans" data-search="/data/search.json"><label for="q">Find your town</label><input id="q" type="search" placeholder="Start typing a town, county or district" autocomplete="off"><ul class="hidden"></ul></div>`;
const legendHTML = S => `<div class="legend">${S.legend.map(([c, t]) => `<span style="--c:var(--map-${c})">${esc(t)}</span>`).join("")}</div>`;
{
  const E = ME.entities, n = k => E.filter(e => e.worst === k).length;
  const groups = [["county", "Counties"], ["city", "Cities"], ["town", "Towns"], ["plantation", "Plantations"], ["village", "Village corporations"]];
  const body = `
<h1>Maine: who posted their audit?</h1>
<p>Every Maine town, city, plantation and county sends its annual audit to the State Auditor, who posts it online. Maine law sets no deadline after the year ends, so we use <b>our 12-month rule</b>: an audit not posted within 12 months of year end shows as overdue. Counties have had a 12-month legal deadline since July 29, 2026.</p>
<div class="stats">
  <div><b>${E.length}</b> governments</div>
  <div><b style="color:var(--bad)">${n("overdue")}</b> with an audit not posted, over 12 months</div>
  <div><b style="color:var(--warn)">${n("late")}</b> posted at least one recent audit after 12 months</div>
  <div><b style="color:var(--good)">${n("on_time")}</b> all recent audits posted within 12 months</div>
</div>
${searchBox}
<h2>Map</h2>
${legendHTML(STATES.ME)}
<div class="map-wrap">${maineMap()}</div>
<p class="small muted">Colors show each town's worst status across the years the State Auditor shows (fiscal years ${E[0].years[0].fy} to ${E[0].years.at(-1).fy}). Counties and village corporations are in the lists below. Source: Maine State Auditor, copied ${esc(ME.snapshot)}.</p>
${groups.map(([t, label]) => { const l = E.filter(e => e.type === t); return l.length ? `<h2>${label} (${l.length})</h2>${tableOf(l)}` : ""; }).join("\n")}`;
  out("/me/", page({ title: "Maine", description: `${n("overdue")} Maine governments have an audit not posted more than 12 months after year end. Find yours.`, body, path: "/me/" }));
}
{
  const E = FL.entities.filter(e => !e.dissolved), n = k => E.filter(e => e.worst === k).length;
  const groups = flCounties();
  const districts = E.filter(e => e.type === "district"), other = E.filter(e => e.type === "other");
  const overdueDistricts = districts.filter(e => e.worst === "overdue");
  const body = `
<h1>Florida: who filed on time?</h1>
<p>Florida law gives every county, city and special district <b>9 months</b> after its fiscal year ends to file its annual financial report, and its audit if one is required (s.218.32 and s.218.39, Florida Statutes). The state's Department of Financial Services records when each one arrives. We show fiscal years ${FL.reportYears[0]} to ${FL.reportYears.at(-1)}.</p>
<div class="stats">
  <div><b>${E.length}</b> active local governments</div>
  <div><b style="color:var(--bad)">${n("overdue")}</b> with a report not filed, past the legal deadline</div>
  <div><b style="color:var(--warn)">${n("late")}</b> filed at least one recent report late</div>
  <div><b style="color:var(--good)">${n("on_time")}</b> filed every recent report on time</div>
</div>
${searchBox}
<h2>Map: counties and cities</h2>
${legendHTML(STATES.FL)}
<div class="map-wrap">${floridaMap(groups)}</div>
<p class="small muted">Each county is colored by how many of its county and city governments have a report not filed. Duval County and Jacksonville are one consolidated government, listed as Jacksonville. Special districts are not on the map yet because the state's public lists don't give their county; they are listed below. Source: Florida DFS LOGERx public reports, copied ${esc(FL.snapshot)}.</p>
<h2>Special districts with a report not filed (${overdueDistricts.length} of ${districts.length})</h2>
${tableOf(overdueDistricts)}
<p class="small"><a href="/fl/districts/">All ${districts.length} special districts</a> · <a href="/fl/other/">Other local entities (${other.length})</a></p>
<h2>By county</h2>
${[...groups.keys()].sort().map(c => `<h3 id="county-${countySlug(c)}">${esc(c)} County</h3>${tableOf(groups.get(c))}`).join("\n")}`;
  out("/fl/", page({ title: "Florida", description: `${n("overdue")} Florida local governments have a report not filed past the legal deadline. Find yours.`, body, path: "/fl/" }));
  out("/fl/districts/", page({ title: "Florida special districts", path: "/fl/districts/", description: "Every Florida special district and its filing status.", body: `<p class="crumb"><a href="/fl/">Florida</a></p><h1>Florida special districts (${districts.length})</h1>${searchBox}${tableOf(districts)}` }));
  out("/fl/other/", page({ title: "Other Florida local entities", path: "/fl/other/", description: "Other Florida local entities that file annual financial reports.", body: `<p class="crumb"><a href="/fl/">Florida</a></p><h1>Other local entities (${other.length})</h1><p>Planning organizations, workforce boards and similar bodies that file with the state. We show their filing status but don't grade them.</p>${tableOf(other)}` }));
  const gone = FL.entities.filter(e => e.dissolved);
  out("/fl/dissolved/", page({ title: "Dissolved Florida entities", path: "/fl/dissolved/", description: "Florida local governments dissolved in the years we show.", body: `<p class="crumb"><a href="/fl/">Florida</a></p><h1>Dissolved (${gone.length})</h1><p>These pages stay up for the record. No new flags appear after the dissolution date.</p>${tableOf(gone)}` }));
}

// ---------- other states (federal single audit status; one page per state, data loaded in the browser) ----------
if (US) {
  const byState = new Map();
  for (const e of US.entities) { if (!byState.has(e.state)) byState.set(e.state, []); byState.get(e.state).push(e); }
  const rows = [];
  for (const [st, list] of [...byState].sort()) {
    const name = US.stateNames[st];
    const compact = list.map(e => ({ i: e.id, n: e.name, t: e.typeLabel, c: e.county, p: e.pop, w: e.web, s: e.status.key, h: e.headline, wo: e.worst,
      f: e.flags.map(f => ({ c: f.cls, l: f.label, x: f.sentence, u: f.source })),
      y: e.years.map(y => [y.fy, y.fyEnd, y.due, y.accepted, y.status, y.daysLate, y.report, y.spent]) }));
    const rule = list.flatMap(e => e.flags).find(f => f.rule)?.rule || "";
    writeFile(p("dist", "data", "us", `${st.toLowerCase()}.json`), JSON.stringify({ st, name, asOf: US.asOf, rule, e: compact }));
    const gov = list.filter(e => e.typeLabel !== "Other local entity");
    const withFac = gov.filter(e => e.years.length).length, lateLatest = list.filter(e => e.status.key === "late").length;
    rows.push(`<tr><td><a href="/us/${st.toLowerCase()}/">${esc(name)}</a></td><td>${gov.length.toLocaleString("en-US")}</td><td>${withFac.toLocaleString("en-US")}</td><td>${(list.length - gov.length).toLocaleString("en-US")}</td><td>${lateLatest.toLocaleString("en-US")}</td></tr>`);
    out(`/us/${st.toLowerCase()}/`, page({ title: `${name}: federal audits`, path: `/us/${st.toLowerCase()}/`, description: `Federal single audit status for every county, city and town in ${name}.`,
      body: `<p class="crumb"><a href="/us/">Other states</a></p>
<h1>${esc(name)}: federal audits</h1>
<p>For ${esc(name)} we show one thing so far: whether each local government filed the <b>federal single audit</b> required when it spends $1 million or more in federal money in a year ($750,000 for years that began before October 1, 2024), and whether it was on time. The federal deadline is 9 months after the fiscal year ends (2 CFR 200.512). Governments are not graded yet in ${esc(name)}.</p>
<p class="small muted">"No federal audit on file" is normal for a government that spent less than the threshold. It only matters if it spent more. Source: Federal Audit Clearinghouse (fac.gov), copied ${esc(US.snapshot)}. Lateness is judged from fiscal year ${US.firstJudgedYear}.</p>
<div data-us="/data/us/${st.toLowerCase()}.json" data-mailto="${esc(MAILTO)}" class="sans">
  <label for="usq">Find your town, city, county or township</label>
  <input id="usq" type="search" placeholder="Start typing a name" autocomplete="off">
  <div data-us-detail class="hidden"></div>
  <p class="small muted" data-us-count></p>
  <table><thead><tr><th>Name</th><th>Type</th><th>Federal audit</th><th>Summary</th></tr></thead><tbody data-us-list><tr><td colspan="4" class="muted">Loading...</td></tr></tbody></table>
</div>
<noscript><p>This page needs JavaScript to show the list. The data file is at <a href="/data/us/${st.toLowerCase()}.json">/data/us/${st.toLowerCase()}.json</a>.</p></noscript>` }));
  }
  out("/us/", page({ title: "Other states", path: "/us/", description: "Federal single audit status for local governments in every state.",
    body: `<h1>Other states</h1>
<p>Maine and Florida have full pages, with state filing records and the report card. For every other state we show federal single audit status from the Federal Audit Clearinghouse, for every county, city, town and township in the Census list, plus other local bodies that filed one (school districts, authorities and similar).</p>
<p><a href="/me/">Maine</a> · <a href="/fl/">Florida</a></p>
<table><tr><th>State</th><th>Governments</th><th>With a federal audit on file</th><th>Other local filers</th><th>Latest filed late</th></tr>${rows.join("")}</table>` }));
}

// ---------- home ----------
{
  const nME = ME.entities.filter(e => e.worst === "overdue").length;
  const nFL = FL.entities.filter(e => e.worst === "overdue" && !e.dissolved).length;
  const body = `
<h1 style="font-size:42px;margin-bottom:6px">Where's our audit?</h1>
<p style="font-size:20px">See if your town filed its audit. If it didn't, ask for it in one click.</p>
${searchBox}
<div class="stats">
  <div><a href="/me/"><b>Maine</b></a> ${ME.entities.length} governments · <b style="display:inline;font-size:inherit;color:var(--bad)">${nME}</b> with an audit not posted</div>
  <div><a href="/fl/"><b>Florida</b></a> ${FL.entities.filter(e => !e.dissolved).length} local governments · <b style="display:inline;font-size:inherit;color:var(--bad)">${nFL}</b> with a report not filed</div>
  <div><a href="/us/"><b>Other states</b></a> federal single audit status for ${US ? US.entities.length.toLocaleString("en-US") : "every"} local governments and filers</div>
</div>
<h2>How it works</h2>
<ol>
<li>We copy public records: the Maine State Auditor's list of posted audits and Florida's state record of filed annual reports.</li>
<li>We show, for every government, which audits are on time, late, or missing.</li>
<li>If one is missing, we write the public records request for you. You send it.</li>
</ol>
<p>Every fact links to its source and to our dated copy. Officials can reply on their page, and we fix mistakes within 5 business days. <a href="/how-we-grade/">How we grade</a>.</p>`;
  out("/", page({ title: "Where's Our Audit?", description: "See if your town filed its audit. If it didn't, ask for it in one click.", body, path: "/" }));
}

// ---------- methodology ----------
out("/how-we-grade/", page({
  title: "How we grade", path: "/how-we-grade/", description: "What we check, where the data comes from, and what each status means.",
  body: `
<h1>How we grade</h1>
<h2>1. What we check</h2>
<p>Whether each local government's annual audit or financial report is public and on time, and how much of its money information it puts online. One checklist applies to every government, customer of anyone or not. Rubric version ${RUBRIC_VERSION}.</p>
<table><tr><th>#</th><th>Item</th><th>Points</th></tr>
${ITEMS.map(it => `<tr><td>${it.n}</td><td>${esc(it.label)}</td><td>${it.max}</td></tr>`).join("")}
</table>
<p>Item 1: on time 40, late 20, overdue or not filed 0. Item 2: 20 times the share of the 3 years before the latest that were on time; late and missing years both count 0. When the source shows fewer than 3 earlier years, we use the years it shows. A is 90 or more, B 80, C 70, D 60, F below 60. Each item is labelled "required by law here" or "best practice here" for that government's state and type.</p>
<p>A person checks items 3 to 7 on each government's live website and saves a dated archive copy. Until all 7 items are checked, the page shows "Not graded yet" and only the filing status. Entities that aren't counties, cities, towns or districts (such as planning organizations) get a status but no grade.</p>
<h2>2. Our sources</h2>
<ul>
<li>Maine State Auditor, municipal audit reports: <a href="${ME.sources.municipal}">${ME.sources.municipal}</a>, and county audit reports: <a href="${ME.sources.county}">${ME.sources.county}</a>. Last copied ${esc(ME.snapshot)}.</li>
<li>Florida Department of Financial Services, LOGERx public Compliant and Non-Compliant reports, fiscal years ${FL.reportYears[0]} to ${FL.reportYears.at(-1)}: <a href="${FL.sources.logerx}">${FL.sources.logerx}</a>. Last copied ${esc(FL.snapshot)}.</li>
<li>Names, IDs and map shapes: US Census Bureau (2024 Gazetteer, 2020 place-by-county file, TIGER/Line and cartographic boundary files). Maine clerk contacts: Maine Secretary of State clerk list.</li>
</ul>
<p>We copy these sources weekly and keep every dated copy, so each fact can be checked against what the source showed that day.</p>
<h2>3. What each status means</h2>
<h3>Maine</h3>
<ul><li><b>Posted</b>: on the State Auditor's site within 12 months of year end.</li>
<li><b>Posted after 12 months</b>: on the site, but later than 12 months.</li>
<li><b>Not posted yet, over 12 months</b>: not on the site, and more than 12 months have passed.</li>
<li><b>Not due yet</b>: less than 12 months since year end.</li></ul>
<p>The 12-month line is <b>our rule</b>, because Maine law (30-A M.R.S. s.5823) sets no deadline after year end. For counties, 30-A M.R.S. s.951 sets a 12-month deadline for audits due from July 29, 2026.</p>
<h3>Florida</h3>
<ul><li><b>Filed on time</b>: the state received the annual financial report (and the audit, when one is required) within 9 months of year end.</li>
<li><b>Filed late</b>: received after the 9-month deadline. We count the days from the later of the two receipt dates.</li>
<li><b>Not filed, past the legal deadline</b>: the state has no annual financial report and the deadline has passed.</li></ul>
<p>The 9-month deadline is Florida law (s.218.39 and s.218.32, Florida Statutes). A fiscal year labelled 2024 by the state is the one ending in the state's 2023-24 year (for example September 30, 2024, or December 31, 2023).</p>
<h2>4. What we can't know</h2>
<p>In Maine, "not posted" is not the same as "not filed": a town may have sent its audit and the State Auditor's office may not have posted it yet. In Florida, the state's records show when reports arrived; they don't show extensions or the reasons for a delay. If a government posts an audit on its own website, we count it from the date of its earliest archived copy.</p>
<h2>5. Corrections</h2>
<p>If something is wrong, use the "Report a correction" link on any flag. Evidence-backed corrections get an "Under review" badge right away and are fixed or answered within 5 business days. Every change is listed on the <a href="/corrections/">corrections log</a>. Officials writing from a government email can add a reply of up to 300 words, shown word for word.</p>
<h2>6. Who built this, and how it's funded</h2>
<p>${esc(DISCLOSURE)} The site is free, has no ads, and is paid for by its builder. Its code and data are public.</p>`,
}));

// ---------- trust pages ----------
out("/corrections/", page({ title: "Corrections log", path: "/corrections/", description: "Every change we make to a flag, with its date.",
  body: `<h1>Corrections log</h1><p>Every change to a flag or grade is listed here with its date and reason.</p><p class="muted">No corrections yet.</p>` }));
const unmatched = [...ME.unmatched, ...FL.unmatched, ...(US ? US.unmatched : [])];
out("/unmatched/", page({ title: "Records we couldn't match", path: "/unmatched/", description: "Source records we could not tie to exactly one government.",
  body: `<h1>Records we couldn't match</h1><p>We only attach a record to a government when the names or IDs match exactly, or a person has confirmed the match. These records didn't, so we show them here instead of guessing.</p>
<table><tr><th>State</th><th>Source</th><th>Name in the source</th><th>Why</th></tr>${unmatched.map(u => `<tr><td>${u.state}</td><td>${esc(u.source)}</td><td>${esc(u.sourceName)}</td><td>${esc(u.reason)}</td></tr>`).join("") || '<tr><td colspan="4" class="muted">None.</td></tr>'}</table>` }));
{
  const logFile = p("data", "derived", "status-log.csv");
  const rows = fs.existsSync(logFile) ? readText(logFile).trim().split("\n").slice(1).map(l => l.split(",")).filter(r => r[3] === "overdue" && ["on_time", "late"].includes(r[4])) : [];
  const byId = new Map(ALL.map(e => [e.id, e]));
  out("/audits-that-showed-up/", page({ title: "Audits that showed up", path: "/audits-that-showed-up/", description: "Audits and reports that appeared after we flagged them as missing.",
    body: `<h1>Audits that showed up</h1><p>Each week we check the sources again. When an audit or report we showed as missing appears, it is listed here.</p>
<p><b>${rows.length}</b> so far.</p>
${rows.length ? `<table><tr><th>Date seen</th><th>Government</th><th>Fiscal year</th></tr>${rows.map(r => { const e = byId.get(r[1]); return `<tr><td>${r[0]}</td><td>${e ? `<a href="${e.url}">${esc(e.name)}, ${e.state}</a>` : esc(r[1])}</td><td>${r[2]}</td></tr>`; }).join("")}</table>` : '<p class="muted">None yet. This list starts with our first weekly update.</p>'}` }));
}
out("/sent/", page({ title: "Thank you", path: "/sent/", description: "Thank you for asking for your town's records.",
  body: `<h1>Thank you for asking.</h1><p>Keep a dated copy of your request. ${esc(STATES.ME.sentNote)} ${esc(STATES.FL.sentNote)}</p><p><a href="/">Back to the start</a></p>` }));

// ---------- data, assets, dated source copies ----------
writeFile(p("dist", "data", "search.json"), JSON.stringify(ALL.map(e => ({ n: e.name, s: e.state, t: e.typeLabel + (e.county && e.type !== "county" ? `, ${e.county} County` : ""), u: e.url }))));
writeFile(p("dist", "assets", "site.css"), readText(p("src", "site.css")));
writeFile(p("dist", "assets", "app.js"), readText(p("src", "app.js")));
for (const [st, dirName] of [["maine", "maine"], ["florida", "florida"]]) {
  const base = p("data", "raw", dirName);
  if (!fs.existsSync(base)) continue;
  for (const day of fs.readdirSync(base).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d))) {
    const files = fs.readdirSync(p("data", "raw", dirName, day)).filter(f => /\.(x?html|txt)$/.test(f));
    fs.mkdirSync(p("dist", "sources", st, day), { recursive: true });
    for (const f of files) fs.copyFileSync(p("data", "raw", dirName, day, f), p("dist", "sources", st, day, f));
    if (st === "florida") out(`/sources/florida/${day}/`, page({ title: `Florida source copies, ${day}`, path: `/sources/florida/${day}/`, description: "Dated copies of the Florida DFS LOGERx public reports.", body: `<h1>Florida source copies, ${day}</h1><p>Exact copies of the Florida Department of Financial Services LOGERx public reports as we downloaded them on ${day}. The live versions are at <a href="${FL.sources.logerx}">${FL.sources.logerx}</a>.</p><ul>${files.map(f => `<li><a href="/sources/florida/${day}/${f}">${f}</a></li>`).join("")}</ul>` }));
  }
}
writeFile(p("dist", "404.html"), page({ title: "Not found", path: "/404", description: "Page not found.", body: `<h1>We couldn't find that page.</h1><p><a href="/">Find your town</a></p>` }));
writeFile(p("dist", "robots.txt"), "User-agent: *\nAllow: /\n");
writeFile(p("dist", "favicon.svg"), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="6" fill="#1b1d21"/><text x="16" y="23" font-family="Georgia,serif" font-size="20" font-weight="700" fill="#fbfaf7" text-anchor="middle">?</text></svg>`);

let count = 0;
const walk = d => { for (const f of fs.readdirSync(d, { withFileTypes: true })) f.isDirectory() ? walk(`${d}/${f.name}`) : count++; };
walk(DIST);
console.log(`built ${count} files into dist/ (${ME.entities.length} Maine + ${FL.entities.length} Florida entity pages), ${BUILT}`);
