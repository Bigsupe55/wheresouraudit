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

// 3. Every page carries the disclosure footer.
const pages = ours.filter(f => f.endsWith(".html"));
const noFooter = pages.filter(f => !readText(f).includes("Civic-Chain never uses this site for sales."));
ok(!noFooter.length, `disclosure footer on all ${pages.length} pages`);

// 4. Data: every flag has its 7 parts; no person named in a flag; statuses use allowed labels.
const ME = readJSON(p("data", "derived", "maine.json"));
const LABELS = new Set(["Posted", "Posted after 12 months", "Not posted yet, over 12 months", "Not due yet"]);
const badFlags = ME.entities.flatMap(e => e.flags.filter(f => !(f.label && f.sentence && f.rule && f.source && f.asOf) || (!LABELS.has(f.label) && !f.label.startsWith("Posted on "))).map(f => `${e.id}/${f.key}`));
ok(!badFlags.length, `every flag has label, sentence, rule, source and as-of date${badFlags.length ? ": " + badFlags.slice(0, 5) : ""}`);
ok(!ME.entities.some(e => e.flags.some(f => /not filed/i.test(f.label + f.sentence))), `Maine flags never say "not filed"`);
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
