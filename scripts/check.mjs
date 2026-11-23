// Checks the built site against the rules in the spec. Exits non-zero on any failure.
// Usage: node scripts/check.mjs
import fs from "node:fs";
import path from "node:path";
import { p, readJSON, readText } from "./lib/util.mjs";
import { BANNED } from "./lib/rubric.mjs";

let fail = 0; const warn = [];
const ok = (cond, msg) => { console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`); if (!cond) fail++; };

// 1. Files
const files = [];
const walk = d => { for (const f of fs.readdirSync(d, { withFileTypes: true })) { const fp = path.join(d, f.name); f.isDirectory() ? walk(fp) : files.push(fp); } };
walk(p("dist"));
ok(files.length < 20000, `file count ${files.length} is under the Cloudflare Pages Free limit of 20,000`);
const big = files.filter(f => fs.statSync(f).size > 25 * 1024 * 1024);
ok(!big.length, `no file over 25 MiB${big.length ? ": " + big.join(", ") : ""}`);

// 2. Words: our own pages only (the dated source copies are the government's pages, kept as they are).
const ours = files.filter(f => /\.(html|js|json)$/.test(f) && !f.includes(`${path.sep}sources${path.sep}`));
const visible = html => html.replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<style[\s\S]*?<\/style>/g, " ").replace(/<[^>]+>/g, " ");
let banned = [], dashes = [];
for (const f of ours) {
  const raw = readText(f), text = f.endsWith(".html") ? visible(raw) : raw;
  for (const w of BANNED) if (new RegExp(`\\b${w.replace(/[-\s]/g, "[-\\s]")}\\b`, "i").test(text)) banned.push(`${path.relative(p("dist"), f)}: "${w}"`);
  if (raw.includes("—")) dashes.push(path.relative(p("dist"), f));
}
ok(!banned.length, `no banned words on our pages${banned.length ? "\n      " + banned.slice(0, 10).join("\n      ") : ""}`);
ok(!dashes.length, `no em dashes${dashes.length ? ": " + dashes.slice(0, 10).join(", ") : ""}`);

// 2b. Share images: every page's og:image exists, is a PNG, and entity images match their page.
{
  const htmlPages = files.filter(f => f.endsWith(".html") && !f.includes(`${path.sep}sources${path.sep}`));
  let missing = [], notPng = 0;
  for (const f of htmlPages) {
    const m = /<meta property="og:image" content="https:\/\/[^/]+(\/share\/[^"]+\.png)"/.exec(readText(f));
    if (!m) { missing.push(path.relative(p("dist"), f) + " (no og:image)"); continue; }
    const img = p("dist", ...m[1].split("/").filter(Boolean));
    if (!fs.existsSync(img)) { missing.push(m[1]); continue; }
    const head = fs.readFileSync(img).subarray(0, 8).toString("hex");
    if (head !== "89504e470d0a1a0a") notPng++;
  }
  ok(!missing.length, `every page has a share image that exists${missing.length ? ": " + missing.slice(0, 5).join(", ") : ""}`);
  ok(notPng === 0, "every share image is a real PNG");
}

// 3. Every page carries the disclosure footer.
const pages = ours.filter(f => f.endsWith(".html"));
const noFooter = pages.filter(f => !readText(f).includes("Civic-Chain never uses this site for sales."));
ok(!noFooter.length, `disclosure footer on all ${pages.length} pages`);

// 4. Data: every flag has its 7 parts; no person named in a flag; statuses use allowed labels.
const ME = readJSON(p("data", "derived", "maine.json"));
const LABELS = new Set(["Posted", "Posted after 12 months", "Not posted yet, over 12 months", "Not due yet"]);
const badFlags = ME.entities.flatMap(e => e.flags.filter(f => !(f.label && f.sentence && f.rule && f.source && f.asOf) || (!LABELS.has(f.label) && !f.label.startsWith("Posted on "))).map(f => `${e.id}/${f.key}`));
ok(!badFlags.length, `every flag has label, sentence, rule, source and as-of date${badFlags.length ? ": " + badFlags.slice(0, 5) : ""}`);
ok(!ME.entities.some(e => e.flags.some(f => /\bnot filed\b/i.test(f.label + " " + f.sentence))), `Maine flags never say "not filed"`);
ok(!ME.entities.some(e => e.graded && e.pts.some(v => v === null)), "no grade shown unless all 7 items are checked");

// 4b. Florida data.
const FL = readJSON(p("data", "derived", "florida.json"));
const FL_LABELS = new Set(["Filed on time", "Filed late", "Not filed, past the legal deadline", "Not due yet", "On the Legislative Auditing Committee's enforcement list"]);
const badFL = FL.entities.flatMap(e => e.flags.filter(f => !(f.label && f.sentence && f.rule && f.source && f.asOf) || !FL_LABELS.has(f.label)).map(f => `${e.id}/${f.key}`));
ok(!badFL.length, `Florida: every flag has all parts and an allowed label${badFL.length ? ": " + badFL.slice(0, 5) : ""}`);
ok(!FL.entities.some(e => (e.gradable === false || e.dissolved) && e.graded), "Florida: 'other' entities and dissolved ones are never graded");
const urls = ALLURLS();
function ALLURLS() { const s = new Set(); let dup = 0; for (const e of [...ME.entities, ...FL.entities]) { if (s.has(e.url)) dup++; s.add(e.url); } return dup; }
ok(urls === 0, "every entity page has its own address");
const flget = n => FL.entities.find(e => e.name === n);
const baker = flget("Baker County"), raiford = flget("Raiford");
ok(baker && baker.years.find(y => y.fy === "2024")?.daysLate === 171, "Baker County FY2024 filed 171 days late (matches research)");
ok(baker && baker.status.label === "Filed on time" && baker.pts[1] === 0, "Baker County: FY2025 on time, all 3 prior years late (item 2 = 0, rubric test)");
ok(raiford && raiford.jlac && raiford.worst === "overdue", "Raiford: not filed and on the JLAC enforcement list");
ok(FL.entities.filter(e => e.type === "city").every(e => e.county), "every Florida city is placed in a county");

// 4c. Nationwide (federal single audits).
if (fs.existsSync(p("data", "derived", "us.json"))) {
  const US = readJSON(p("data", "derived", "us.json"));
  const US_LABELS = new Set(["Filed on time", "Filed late", "No federal audit on file"]);
  const badUS = US.entities.flatMap(e => e.flags.filter(f => !(f.label && f.sentence && f.source && f.asOf) || !US_LABELS.has(f.label)).map(() => e.id));
  ok(!badUS.length, `nationwide: every flag has all parts and an allowed label${badUS.length ? ": " + badUS.slice(0, 5) : ""}`);
  ok(!US.entities.some(e => e.flags.some(f => /\bmissing\b|\bnot filed\b/i.test(f.label + " " + f.sentence))), `nationwide flags never say "missing" or "not filed"`);
  ok(!US.entities.some(e => e.state === "ME" || e.state === "FL"), "nationwide data skips Maine and Florida (they have full pages)");
  ok(!US.entities.some(e => e.years.some(y => y.status === "late" && +y.fy < US.firstJudgedYear)), `no lateness judged before fiscal year ${US.firstJudgedYear}`);
  const ids = new Set(); let dupIds = 0; for (const e of US.entities) { if (ids.has(e.id)) dupIds++; ids.add(e.id); }
  ok(dupIds === 0, "nationwide: every entity has its own id");
  const govs = US.entities.filter(e => e.typeLabel !== "Other local entity").length;
  ok(govs > 37000 && govs < 39000, `nationwide: ${govs} Census general-purpose governments (Census 2022 lists 38,736 including ME and FL)`);
  const cols = readJSON(p("dist", "data", "us", "oh.json"));
  ok(cols.e.some(e => e.i === "oh-city-of-columbus" && e.s === "on_time"), "Columbus, OH: federal audit on file, latest on time");
}

// 4d. Federal single audit sections on Maine and Florida pages.
{
  const statePages = [...ME.entities, ...FL.entities].map(e => p("dist", ...e.url.split("/").filter(Boolean), "index.html"));
  const noFed = statePages.filter(f => !readText(f).includes("<h2>Federal single audit</h2>"));
  ok(!noFed.length, `every Maine and Florida page has a federal single audit section${noFed.length ? ": " + noFed.slice(0, 3).join(", ") : ""}`);
  const fedDirs = ["me", "fl"].flatMap(st => { const d = p("dist", st, "federal"); return fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }).filter(x => x.isDirectory()).map(x => p("dist", st, "federal", x.name, "index.html")) : []; });
  ok(fedDirs.length > 0 && fedDirs.every(f => readText(f).includes('<div class="grade ng">Status only</div>')), `${fedDirs.length} federal-only pages, none graded`);
  const brun = readText(p("dist", "me", "town", "brunswick", "index.html"));
  ok(/Federal single audit[\s\S]*Brunswick's federal single audits/.test(brun), "Brunswick: federal flags use the page's own name");
}

// 5. Known cases from the research (Maine).
const get = id => ME.entities.find(e => e.id === id);
if (ME.snapshot >= "2026-11-22" && ME.snapshot <= "2026-12-31") {
  const sag = get("me-county-sagadahoc"), all = get("me-town-allagash"), bru = get("me-town-brunswick");
  ok(sag && sag.headline === "4 audits not posted (FY2022 to FY2025)", "Sagadahoc County: 4 audits not posted, FY2022 to FY2025");
  ok(all && all.worst === "overdue", "Allagash: overdue");
  ok(bru && bru.pts[0] === 40 && bru.status.label === "Posted", "Brunswick: latest audit posted on time (item 1 = 40)");
  ok(ME.unmatched.some(u => u.sourceName === "DREW PLT."), "Drew Plantation is listed as unmatched (Census treats it as unorganized territory)");
  const overdue = ME.entities.filter(e => e.worst === "overdue").length;
  ok(overdue >= 155 && overdue <= 170, `overdue count ${overdue} is close to the research draft (163)`);
}

// 6. Launch readiness (warnings, not failures, during development).
const cfg = readJSON(p("site.config.json"));
if (/example\.invalid/.test(cfg.correctionsEmail)) warn.push("correctionsEmail in site.config.json is not a real inbox yet");
if (!ME.entities.some(e => e.graded)) warn.push("no website checks entered yet, so every page shows \"Not graded yet\"");
warn.push("before launch: lawyer review, Cloudflare bandwidth and Web Analytics checks, USPTO search, State Auditor email (spec checklist)");
for (const w of warn) console.log(`WARN  ${w}`);
console.log(fail ? `\n${fail} check(s) failed` : "\nall checks passed");
process.exit(fail ? 1 : 0);
