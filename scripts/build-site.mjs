// Build the static site into dist/ from data/derived/*.json.
// Usage: node scripts/build-site.mjs
import fs from "node:fs";
import { p, readJSON, readText, writeFile, esc, fmtDate } from "./lib/util.mjs";
import { ITEMS, RUBRIC_VERSION } from "./lib/rubric.mjs";

const DIST = p("dist");
fs.rmSync(DIST, { recursive: true, force: true });
const ME = readJSON(p("data", "derived", "maine.json"));
const CONFIG = readJSON(p("site.config.json"));
const SITE = CONFIG.site;
const MAILTO = CONFIG.correctionsEmail;
const BUILT = new Date().toISOString().slice(0, 10);

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
<nav><a href="/me/">Maine</a><a href="/how-we-grade/">How we grade</a><a href="/corrections/">Corrections</a></nav></header>
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
const basis = (e, n) => n <= 2
  ? (e.type === "county" ? "Law for audits due from July 29, 2026 (30-A s.951); our rule before" : "Our rule here (Maine sets no deadline)")
  : "Best practice here (not required online in Maine)";
function checklistHTML(e) {
  return `<table>
<tr><th>#</th><th>Item</th><th>Points</th><th>Basis</th></tr>
${ITEMS.map((it, i) => {
    const v = e.pts[i];
    const ev = e.evidence[it.key];
    return `<tr><td>${it.n}</td><td>${esc(it.label)}${ev?.url ? ` <a class="small" href="${esc(ev.url)}">evidence</a>` : ""}</td><td>${v === null ? '<span class="muted">Not checked yet</span>' : `${v} / ${it.max}`}</td><td class="small muted">${basis(e, it.n)}</td></tr>`;
  }).join("\n")}
<tr><th></th><th>Total</th><th>${e.graded ? `${e.score} / 100` : "Not graded yet"}</th><th class="small muted">Rubric v${RUBRIC_VERSION}</th></tr>
</table>
${e.graded ? "" : `<p class="small muted">Items 3 to 7 need a person to check ${esc(e.name)}'s website. Until all 7 are checked, we show no grade.</p>`}`;
}
const shareHTML = e => `<div class="share" aria-label="Share card preview"><div class="q">Where's Our Audit?</div><div class="fact"><b>${esc(e.name)}, ${e.state}:</b> ${esc(e.headline)}</div><div class="foot">${SITE}${e.url} · sourced to public records</div></div>`;

function letterHTML(e) {
  const data = { state: "ME", entity: e.name, type: e.type, fy: e.letter.fy, fyeText: fmtDate(e.letter.fye), missing: e.letter.missing, sourcePage: e.sourcePage };
  return `<form data-letter class="card" onsubmit="return false">
  <p class="small muted">Send it yourself. We never send anything for you. Copy it into an email or print it for:<br><b>${esc(e.contact.office)}</b>${e.contact.detail ? `<br>${esc(e.contact.detail)}` : ""}${e.contact.source ? `<br><span class="small">Contact from the ${esc(e.contact.source)}.</span>` : ""}</p>
  <div class="letter-grid">
    <div><label for="l-name">Your name</label><input id="l-name" name="name" autocomplete="name"></div>
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
  <p class="small muted">Stuck? Maine's Public Access Ombudsman can help: (207) 626-8577. Your name and email stay in your browser; this page does not save or send them.</p>
  <script type="application/json" id="letter-data">${JSON.stringify(data).replace(/</g, "\\u003c")}</script>
</form>`;
}

// ---------- entity pages ----------
for (const e of ME.entities) {
  const body = `
<p class="crumb"><a href="/me/">Maine</a> › ${esc(e.typeLabel)}</p>
<div class="top">
  <div class="grade ${e.graded ? "" : "ng"}">${e.graded ? e.grade : "Not graded yet"}</div>
  <div>
    <h1 style="margin:0 0 6px">${esc(e.name)}, ME</h1>
    <span class="pill s-${e.status.cls}">${esc(e.status.label)}</span>
    <p style="margin:10px 0 0">${esc(e.headline)}.</p>
    ${e.type === "village" ? '<p class="small muted">A village corporation is a small local district inside a town, with its own budget.</p>' : ""}
    <p class="small muted">${e.graded ? `Score ${e.score} / 100 · ` : ""}As of ${esc(ME.asOf)} · <a href="/how-we-grade/">How we grade</a></p>
  </div>
</div>
<div class="cols">
  <div>
    <h2>What we found</h2>
    ${e.flags.map(flagHTML).join("\n")}
    <h2>Ask for it</h2>
    ${letterHTML(e)}
  </div>
  <div>
    <h2>Report card</h2>
    <div class="card">${checklistHTML(e)}</div>
    <h2>Share</h2>
    ${shareHTML(e)}
    <h2>Who to ask</h2>
    <div class="card small">${esc(e.contact.office)}${e.contact.detail ? `<br>${esc(e.contact.detail)}` : ""}${e.firm ? `<br><span class="muted">Audit firm on record with the State Auditor: ${esc(e.firm)}</span>` : ""}</div>
  </div>
</div>`;
  out(e.url, page({ title: `${e.name}, ME`, description: `${e.name}, Maine: ${e.headline}. See the record and ask for the audit in one click.`, body, path: e.url }));
}

// ---------- Maine map (built as static SVG; each town links to its page) ----------
function mapSVG() {
  const geo = readJSON(p("data", "reference", "me-municipalities.geojson"));
  const byGeoid = new Map(ME.entities.filter(e => e.geoid).map(e => [e.geoid, e]));
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  const rings = f => f.geometry.type === "Polygon" ? f.geometry.coordinates : f.geometry.coordinates.flat();
  for (const f of geo.features) for (const r of rings(f)) for (const [x, y] of r) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
  const kx = Math.cos(((minY + maxY) / 2) * Math.PI / 180), W = 600, scale = W / ((maxX - minX) * kx), H = Math.round((maxY - minY) * scale);
  const proj = ([x, y]) => [(x - minX) * kx * scale, (maxY - y) * scale];
  // Drop points closer than 1 px to the last kept point: invisible at this size, and it cuts the page weight a lot.
  const ringPath = r => {
    const pts = r.map(proj), kept = [pts[0]];
    for (const q of pts.slice(1)) { const l = kept[kept.length - 1]; if (Math.hypot(q[0] - l[0], q[1] - l[1]) >= 1) kept.push(q); }
    if (kept.length < 3) return "";
    return "M" + kept.map(([a, b]) => `${a.toFixed(1)},${b.toFixed(1)}`).join("L") + "Z";
  };
  const cls = { overdue: "f-bad", late: "f-warn", on_time: "f-good", not_due: "f-none" };
  const paths = geo.features.map(f => {
    const d = rings(f).map(ringPath).join("");
    const e = byGeoid.get(f.properties.GEOID);
    if (!e) return `<path class="f-none" d="${d}"><title>${esc(f.properties.NAME)}: no town government on the State Auditor's list</title></path>`;
    return `<a href="${e.url}"><path class="${cls[e.worst]}" d="${d}"><title>${esc(e.name)}: ${esc(e.headline)}</title></path></a>`;
  });
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Map of Maine towns colored by audit status">${paths.join("")}</svg>`;
}

// ---------- state page ----------
{
  const E = ME.entities;
  const n = k => E.filter(e => e.worst === k).length;
  const groups = [["county", "Counties"], ["city", "Cities"], ["town", "Towns"], ["plantation", "Plantations"], ["village", "Village corporations"]];
  const rowHTML = e => `<tr><td><a href="${e.url}">${esc(e.name)}</a></td><td><span class="pill s-${e.status.cls}">${esc(e.status.label)}</span></td><td class="small">${esc(e.headline)}</td><td>${e.graded ? e.grade : '<span class="muted small">Not graded yet</span>'}</td></tr>`;
  const order = { overdue: 0, late: 1, on_time: 2, not_due: 3 };
  const body = `
<h1>Maine: who posted their audit?</h1>
<p>Every Maine town, city, plantation and county sends its annual audit to the State Auditor, who posts it online. Maine law sets no deadline after the year ends, so we use <b>our 12-month rule</b>: an audit not posted within 12 months of year end shows as overdue. Counties have had a 12-month legal deadline since July 29, 2026.</p>
<div class="stats">
  <div><b>${E.length}</b> governments</div>
  <div><b style="color:var(--bad)">${n("overdue")}</b> with an audit not posted, over 12 months</div>
  <div><b style="color:var(--warn)">${n("late")}</b> posted at least one recent audit after 12 months</div>
  <div><b style="color:var(--good)">${n("on_time")}</b> all recent audits posted within 12 months</div>
</div>
<div class="search sans" data-search="/data/search.json"><label for="q">Find your town</label><input id="q" type="search" placeholder="Start typing a town name" autocomplete="off"><ul class="hidden"></ul></div>
<h2>Map</h2>
<div class="legend"><span style="--c:var(--map-bad)">Not posted, over 12 months</span><span style="--c:var(--map-warn)">Posted late</span><span style="--c:var(--map-good)">Posted on time</span><span style="--c:var(--map-none)">No town government listed</span></div>
<div class="map-wrap">${mapSVG()}</div>
<p class="small muted">Colors show each town's worst status across the years the State Auditor shows (fiscal years ${ME.entities[0].years[0].fy} to ${ME.entities[0].years.at(-1).fy}). Counties and village corporations are in the lists below. Source: Maine State Auditor, copied ${esc(ME.snapshot)}.</p>
${groups.map(([t, label]) => {
    const list = E.filter(e => e.type === t).sort((a, b) => order[a.worst] - order[b.worst] || a.name.localeCompare(b.name));
    return list.length ? `<h2>${label} (${list.length})</h2><table><tr><th>Name</th><th>Latest due audit</th><th>Summary</th><th>Grade</th></tr>${list.map(rowHTML).join("")}</table>` : "";
  }).join("\n")}`;
  out("/me/", page({ title: "Maine", description: `${n("overdue")} Maine governments have an audit not posted more than 12 months after year end. Find yours.`, body, path: "/me/" }));
}

// ---------- home ----------
{
  const n = ME.entities.filter(e => e.worst === "overdue").length;
  const body = `
<h1 style="font-size:42px;margin-bottom:6px">Where's our audit?</h1>
<p style="font-size:20px">See if your town filed its audit. If it didn't, ask for it in one click.</p>
<div class="search sans" data-search="/data/search.json"><label for="q">Find your town</label><input id="q" type="search" placeholder="Start typing a town name" autocomplete="off"><ul class="hidden"></ul></div>
<div class="stats">
  <div><a href="/me/"><b>Maine</b></a> ${ME.entities.length} governments · <b style="display:inline;font-size:inherit;color:var(--bad)">${n}</b> with an audit not posted</div>
  <div><b>Florida</b> coming next</div>
  <div><b>Other states</b> federal audit status coming</div>
</div>
<h2>How it works</h2>
<ol>
<li>We copy public records: the Maine State Auditor's list of posted audits.</li>
<li>We show, for every government, which audits are posted, posted late, or not posted.</li>
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
<p>Whether each local government's annual audit is public, and how much of its money information it puts online. One checklist applies to every government, customer of anyone or not. Rubric version ${RUBRIC_VERSION}.</p>
<table><tr><th>#</th><th>Item</th><th>Points</th></tr>
${ITEMS.map(it => `<tr><td>${it.n}</td><td>${esc(it.label)}</td><td>${it.max}</td></tr>`).join("")}
</table>
<p>Item 1: on time 40, late 20, overdue or not filed 0. Item 2: 20 times the share of the 3 years before the latest that were on time; late and missing years both count 0. When the source shows fewer than 3 earlier years, we use the years it shows. A is 90 or more, B 80, C 70, D 60, F below 60. Each item is labelled "required by law here" or "best practice here".</p>
<p>A person checks items 3 to 7 on each government's live website and saves a dated archive copy. Until all 7 items are checked, the page shows "Not graded yet" and only the audit status.</p>
<h2>2. Our sources</h2>
<ul><li>Maine State Auditor, municipal audit reports: <a href="${ME.sources.municipal}">${ME.sources.municipal}</a></li>
<li>Maine State Auditor, county audit reports: <a href="${ME.sources.county}">${ME.sources.county}</a></li>
<li>Town names and IDs: US Census Bureau 2024 Gazetteer. Clerk contacts: Maine Secretary of State clerk list. Map shapes: Census TIGER/Line.</li></ul>
<p>Last copied: ${esc(ME.snapshot)}. We copy these pages weekly and keep every dated copy, so each fact can be checked against what the page showed that day.</p>
<h2>3. What each status means (Maine)</h2>
<ul><li><b>Posted</b>: on the State Auditor's site within 12 months of year end.</li>
<li><b>Posted after 12 months</b>: on the site, but later than 12 months.</li>
<li><b>Not posted yet, over 12 months</b>: not on the site, and more than 12 months have passed.</li>
<li><b>Not due yet</b>: less than 12 months since year end.</li></ul>
<p>The 12-month line is <b>our rule</b>, because Maine law (30-A M.R.S. s.5823) sets no deadline after year end. For counties, 30-A M.R.S. s.951 sets a 12-month deadline for audits due from July 29, 2026.</p>
<h2>4. What we can't know</h2>
<p>"Not posted" is not the same as "not filed". A town may have sent its audit and the State Auditor's office may not have posted it yet. The dates on the State Auditor's list are most likely the dates the office received each audit; we have asked the office to confirm. If a town posts an audit on its own website, we count it from the date of its earliest archived copy.</p>
<h2>5. Corrections</h2>
<p>If something is wrong, use the "Report a correction" link on any flag. Evidence-backed corrections get an "Under review" badge right away and are fixed or answered within 5 business days. Every change is listed on the <a href="/corrections/">corrections log</a>. Officials writing from a government email can add a reply of up to 300 words, shown word for word.</p>
<h2>6. Who built this, and how it's funded</h2>
<p>${esc(DISCLOSURE)} The site is free, has no ads, and is paid for by its builder. Its code and data are public.</p>`,
}));

// ---------- trust pages ----------
out("/corrections/", page({ title: "Corrections log", path: "/corrections/", description: "Every change we make to a flag, with its date.",
  body: `<h1>Corrections log</h1><p>Every change to a flag or grade is listed here with its date and reason.</p><p class="muted">No corrections yet.</p>` }));
out("/unmatched/", page({ title: "Records we couldn't match", path: "/unmatched/", description: "Source records we could not tie to exactly one government.",
  body: `<h1>Records we couldn't match</h1><p>We only attach a record to a government when the names match exactly or a person has confirmed the match. These records didn't, so we show them here instead of guessing.</p>
<table><tr><th>State</th><th>Source</th><th>Name in the source</th><th>Why</th></tr>${ME.unmatched.map(u => `<tr><td>${u.state}</td><td>${esc(u.source)}</td><td>${esc(u.sourceName)}</td><td>${esc(u.reason)}</td></tr>`).join("") || '<tr><td colspan="4" class="muted">None.</td></tr>'}</table>` }));
{
  const logFile = p("data", "derived", "status-log.csv");
  const rows = fs.existsSync(logFile) ? readText(logFile).trim().split("\n").slice(1).map(l => l.split(",")).filter(r => r[3] === "overdue" && ["on_time", "late"].includes(r[4])) : [];
  const byId = new Map(ME.entities.map(e => [e.id, e]));
  out("/audits-that-showed-up/", page({ title: "Audits that showed up", path: "/audits-that-showed-up/", description: "Audits that appeared after we flagged them as not posted.",
    body: `<h1>Audits that showed up</h1><p>Each week we check the State Auditor's list again. When an audit we showed as not posted appears, it is listed here.</p>
<p><b>${rows.length}</b> so far.</p>
${rows.length ? `<table><tr><th>Date seen</th><th>Government</th><th>Fiscal year</th></tr>${rows.map(r => { const e = byId.get(r[1]); return `<tr><td>${r[0]}</td><td>${e ? `<a href="${e.url}">${esc(e.name)}</a>` : esc(r[1])}</td><td>${r[2]}</td></tr>`; }).join("")}</table>` : '<p class="muted">None yet. This list starts with our first weekly update.</p>'}` }));
}
out("/sent/", page({ title: "Thank you", path: "/sent/", description: "Thank you for asking for your town's records.",
  body: `<h1>Thank you for asking.</h1><p>Keep a dated copy of your request. In Maine, the office should acknowledge it within 5 working days.</p><p><a href="/">Back to the start</a></p>` }));

// ---------- data + assets + source copies ----------
writeFile(p("dist", "data", "search.json"), JSON.stringify(ME.entities.map(e => ({ n: e.name, s: e.state, t: e.typeLabel, u: e.url }))));
writeFile(p("dist", "assets", "site.css"), readText(p("src", "site.css")));
writeFile(p("dist", "assets", "app.js"), readText(p("src", "app.js")));
for (const [kind, file] of [["municipal", "municipal.html"], ["county", "county.html"]]) {
  writeFile(p("dist", "sources", "maine", ME.snapshot, `${kind}.html`), readText(p("data", "raw", "maine", ME.snapshot, file)));
}
writeFile(p("dist", "404.html"), page({ title: "Not found", path: "/404", description: "Page not found.", body: `<h1>We couldn't find that page.</h1><p><a href="/">Find your town</a></p>` }));
writeFile(p("dist", "robots.txt"), "User-agent: *\nAllow: /\n");
writeFile(p("dist", "favicon.svg"), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="6" fill="#1b1d21"/><text x="16" y="23" font-family="Georgia,serif" font-size="20" font-weight="700" fill="#fbfaf7" text-anchor="middle">?</text></svg>`);

const files = [];
const walk = d => { for (const f of fs.readdirSync(d, { withFileTypes: true })) f.isDirectory() ? walk(p(d.slice(p().length), f.name)) : files.push(f.name); };
walk(DIST);
console.log(`built ${files.length} files into dist/ (${ME.entities.length} Maine entity pages), ${BUILT}`);
