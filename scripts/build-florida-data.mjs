// Turn the latest Florida LOGERx snapshot into data/derived/florida.json.
// Status per fiscal year is judged against the legal deadline: 9 months after fiscal year end
// (s.218.39 audit, s.218.32 annual financial report). The filing date is the later of the annual
// financial report and audit received dates at the Department of Financial Services (DFS).
// Usage: node scripts/build-florida-data.mjs [--snapshot=YYYY-MM-DD] [--approve]
import fs from "node:fs";
import { p, readText, writeJSON, csvObjects, slug, lastDayOfMonth, addMonthsEnd, daysBetween, latestDir, yearRange, fmtDate, stripTags, decodeEntities } from "./lib/util.mjs";
import { ITEMS, item1Points, item2Points, letterGrade, STATUS_CLASS, RUBRIC_VERSION } from "./lib/rubric.mjs";
import { brakeAndLog } from "./lib/brake.mjs";

const args = Object.fromEntries(process.argv.slice(2).map(a => a.replace(/^--/, "").split("=")).map(([k, v]) => [k, v ?? true]));
const RAW = p("data", "raw", "florida");
const snapshot = args.snapshot || latestDir(RAW);
const asOf = snapshot;
const HUMAN_PAGE = "https://logerx.myfloridacfo.gov/LogerX/SystemReports";
export const FL_LABELS = { on_time: "Filed on time", late: "Filed late", overdue: "Not filed, past the legal deadline", not_due: "Not due yet" };

// ---------- parse LOGERx XHTML reports ----------
function table(file) {
  const t = readText(p("data", "raw", "florida", snapshot, file));
  const tb = t.slice(t.indexOf("<table"));
  const rows = [...tb.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map(m => [...m[1].matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/g)].map(c => stripTags(c[1]))).filter(r => r.length > 2);
  const [head, ...body] = rows;
  return { head, body };
}
const EXPECT = ["Type", "Entity ID", "Name", "FYE", "AFR Received Date", "Audit Received Date", "Audit Completion Date"];
const files = fs.readdirSync(p("data", "raw", "florida", snapshot));
const reportYears = [...new Set(files.map(f => /govs-(\d{4})\.xhtml$/.exec(f)?.[1]).filter(Boolean))].sort();
const mdy = s => { const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s || ""); return m ? `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}` : null; };

// FY label Y covers the Florida state fiscal year Oct 1 (Y-1) to Sep 30 (Y). A 12/31 year end inside it is Dec 31 of Y-1
// (confirmed in the data: FY2024 12/31 filers report in early 2025).
function fyeDate(fy, fye) {
  const [m, d] = fye.split("/").map(Number);
  const year = m >= 10 ? fy - 1 : fy;
  return d >= 28 ? lastDayOfMonth(year, m) : `${year}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

const byId = new Map();
for (const fy of reportYears) {
  for (const [kind, file] of [["noncompliant", `publicnoncompliantgovs-${fy}.xhtml`], ["compliant", `publiccompliantgovs-${fy}.xhtml`]]) {
    if (!files.includes(file)) continue;
    const { head, body } = table(file);
    if (EXPECT.some((h, i) => head[i] !== h)) throw new Error(`SAFETY BRAKE: ${file} columns changed shape: ${JSON.stringify(head)}`);
    for (const r of body) {
      const [type, id, name, fye, afr, audit, completed, dissolved] = r;
      if (!/^\d{6}$/.test(id) || !/^\d{1,2}\/\d{1,2}$/.test(fye)) continue;
      if (!byId.has(id)) byId.set(id, { id, rows: {} });
      const e = byId.get(id);
      e.rows[fy] = { type, name: decodeEntities(name), fye, afr: mdy(afr), audit: mdy(audit), completed: mdy(completed), dissolved: mdy(dissolved || ""), list: kind };
    }
  }
}

// JLAC enforcement (letter and state-fund withholding dates), matched by type + name.
const jlac = [];
for (const f of files.filter(f => /^jlac-\d{4}\.xhtml$/.test(f))) {
  const t = readText(p("data", "raw", "florida", snapshot, f));
  const tb = t.slice(t.indexOf("<table"));
  for (const m of tb.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
    const c = [...m[1].matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/g)].map(x => stripTags(x[1]));
    if (c.length >= 4 && c[0] !== "Type" && mdy(c[2])) jlac.push({ fy: /(\d{4})/.exec(f)[1], type: c[0], name: c[1], letter: mdy(c[2]), withholding: mdy(c[3]) });
  }
}

const manual = name => { const f = p("data", "manual", name); return fs.existsSync(f) ? csvObjects(readText(f)) : []; };

// ---------- Census: city to county (for the county map) ----------
// Pipe-delimited (names can contain commas, so it is not CSV).
const [pHead, ...pRows] = readText(p("data", "reference", "census-place-by-county-2020-fl.txt")).split(/\r?\n/).filter(Boolean).map(l => l.split("|"));
const places = pRows.map(r => Object.fromEntries(pHead.map((h, i) => [h, r[i]]))).filter(r => r.TYPE === "INCORPORATED PLACE");
// Compare names with punctuation and spaces removed; Census adds one trailing type word ("Cooper City city").
const placeKey = s => s.toLowerCase().replace(/,\s*(the\s+)?(village|villages|town|city)\s+of\b/, "").replace(/[^a-z0-9]/g, "");
const cityCounty = new Map();
for (const r of places) {
  const base = r.PLACENAME.replace(/ (city|town|village)$/, ""), county = r.COUNTYNAME.replace(/ County$/, "");
  const hit = { county, fips: r.STATEFP + r.COUNTYFP + r.PLACEFP }; // fips matches the Census government list (federal audits)
  for (const k of [placeKey(base), placeKey(base.split(",")[0]), placeKey(r.PLACENAME)]) if (!cityCounty.has(k)) cityCounty.set(k, hit);
}
const placeAliases = new Map(manual("aliases-fl-places.csv").map(r => [placeKey(r.dfs_name), { county: r.county, fips: null }]));
// Exact key first, then the same name with its type word or ", Village of ..." part dropped. Each step is still an exact match.
const countyOf = n => placeAliases.get(placeKey(n))
  || cityCounty.get(placeKey(n))
  || cityCounty.get(placeKey(n.replace(/ (City|Town|Village)$/i, "")))
  || cityCounty.get(placeKey(n.split(",")[0]))
  || null;

const checks = manual("website-checks.csv");
const replies = manual("replies.csv");

// ---------- statuses ----------
const TYPE = { County: "county", City: "city", "Special District": "district", "Other Entity": "other" };
const TYPE_LABEL = { county: "County", city: "City", district: "Special district", other: "Other local entity" };
const entities = [];
const usedSlugs = new Set();
for (const raw of byId.values()) {
  const fys = Object.keys(raw.rows).sort();
  const latestRow = raw.rows[fys[fys.length - 1]];
  const type = TYPE[latestRow.type] || "other";
  const baseName = latestRow.name;
  const name = type === "county" ? `${baseName} County` : baseName;
  const dissolved = fys.map(f => raw.rows[f].dissolved).filter(Boolean).sort()[0] || null;

  const years = fys.map(fy => {
    const r = raw.rows[fy];
    const fye = fyeDate(+fy, r.fye);
    const due = addMonthsEnd(fye, 9);
    const filed = [r.afr, r.audit].filter(Boolean).sort().pop() || null;
    let status;
    if (r.afr) status = filed <= due ? "on_time" : "late";
    else status = due < asOf ? "overdue" : "not_due";
    if (dissolved && dissolved <= due && !r.afr) status = "not_due"; // no new flags after dissolution
    return { fy, fye, due, afr: r.afr, audit: r.audit, filed: r.afr ? filed : null, status, daysLate: status === "late" ? daysBetween(due, filed) : null, list: r.list };
  });
  const due = years.filter(y => y.status !== "not_due");
  const latest = due[due.length - 1] || null;
  const prior = latest ? due.filter(y => y.fy < latest.fy).slice(-3) : [];
  const overdue = due.filter(y => y.status === "overdue");
  const late = due.filter(y => y.status === "late");

  // ---------- flags ----------
  const RULE = "Due 9 months after the end of the fiscal year (s.218.39 and s.218.32, Florida Statutes).";
  const what = y => y.audit && y.audit !== y.afr ? "annual financial report and audit" : "annual financial report";
  const flags = [];
  const push = (status, list, sentence) => flags.push({ key: `${status}-${list.map(y => y.fy).join("-")}`, cls: STATUS_CLASS[status], label: FL_LABELS[status], sentence, rule: RULE, ourRule: false, source: HUMAN_PAGE, sourceCopy: `/sources/florida/${snapshot}/`, asOf, reply: null });
  if (overdue.length) push("overdue", overdue, `The Florida Department of Financial Services has no annual financial report from ${name} for ${yearRange(overdue.map(y => y.fy))}, and the legal deadline has passed (${overdue.map(y => `FY${y.fy} was due ${fmtDate(y.due)}`).join("; ")}).`);
  if (late.length) push("late", late, `${name}'s filings for ${yearRange(late.map(y => y.fy))} reached the Florida Department of Financial Services after the legal deadline (${late.map(y => `FY${y.fy}: ${y.daysLate} days after`).join("; ")}).`);
  if (latest && latest.status === "on_time") push("on_time", [latest], `${name}'s ${what(latest)} for fiscal year ${latest.fy} reached the Florida Department of Financial Services on ${fmtDate(latest.filed)}, ${latest.filed === latest.due ? "on the day of" : "before"} the ${fmtDate(latest.due)} deadline.`);
  const J = jlac.filter(j => j.name.toLowerCase() === baseName.toLowerCase() && TYPE[j.type] === type);
  for (const j of J) flags.push({ key: `jlac-${j.fy}`, cls: "bad", label: "On the Legislative Auditing Committee's enforcement list", sentence: `The Joint Legislative Auditing Committee sent ${name} an enforcement letter on ${fmtDate(j.letter)}${j.withholding ? `, and state funds were set to be withheld starting ${fmtDate(j.withholding)}` : ""} (FY${j.fy}).`, rule: "s.11.40(2), Florida Statutes, lets the committee have state funds withheld until reports are filed.", ourRule: false, source: HUMAN_PAGE, sourceCopy: `/sources/florida/${snapshot}/`, asOf, reply: null });
  for (const f of flags) f.reply = replies.find(r => r.entity_id === `fl-${raw.id}` && r.flag_key === f.key) || null;

  let headline;
  if (dissolved) headline = `Dissolved on ${fmtDate(dissolved)}`;
  else if (overdue.length) headline = `${overdue.length} annual ${overdue.length > 1 ? "reports" : "report"} not filed (FY${overdue[0].fy}${overdue.length > 1 ? ` to FY${overdue[overdue.length - 1].fy}` : ""})`;
  else if (latest?.status === "late") headline = `Latest report filed ${latest.daysLate} days late (FY${latest.fy})`;
  else if (latest && late.length) headline = `FY${latest.fy} filed on time, after ${late.length} late ${late.length > 1 ? "years" : "year"}`;
  else if (latest) headline = `Latest report filed on time (FY${latest.fy})`;
  else headline = "No report due yet";

  // ---------- rubric (grades only for counties, cities, districts; "other" entities get status only) ----------
  const gradable = type !== "other" && !dissolved;
  const pts = ITEMS.map(() => null);
  pts[0] = latest ? item1Points(latest.status) : null;
  pts[1] = item2Points(prior.map(y => y.status));
  const id = `fl-${raw.id}`;
  const mine = checks.filter(c => c.entity_id === id);
  for (const it of ITEMS.slice(2)) {
    const c = mine.filter(c => c.item === it.key).sort((a, b) => a.checked_on.localeCompare(b.checked_on)).pop();
    if (c) pts[it.n - 1] = c.result === "pass" ? it.max : 0;
  }
  const graded = gradable && pts.every(v => v !== null);
  const score = graded ? pts.reduce((a, b) => a + b, 0) : null;

  let s = slug(baseName.replace(/,? (Town|City|Village) of$/i, "")) || raw.id;
  const typeSlug = type;
  if (usedSlugs.has(`${typeSlug}/${s}`)) s = `${s}-${raw.id}`;
  usedSlugs.add(`${typeSlug}/${s}`);
  const place = type === "city" ? countyOf(baseName) : null;
  const county = type === "county" ? baseName : place?.county || null;
  const letterYear = overdue[overdue.length - 1] || latest || years[years.length - 1];
  entities.push({
    id, dfsId: raw.id, placeFips: place?.fips || null, state: "FL", type, typeLabel: TYPE_LABEL[type], name, sourceName: baseName, county, dissolved,
    url: `/fl/${typeSlug}/${s}/`,
    status: latest ? { key: latest.status, cls: STATUS_CLASS[latest.status], label: FL_LABELS[latest.status] } : { key: "not_due", cls: "none", label: FL_LABELS.not_due },
    worst: overdue.length ? "overdue" : late.length ? "late" : latest ? latest.status : "not_due",
    headline, years, latestFy: latest?.fy || null, flags, pts, graded, gradable, score, grade: graded ? letterGrade(score) : null,
    evidence: Object.fromEntries(ITEMS.slice(2).map(it => [it.key, mine.filter(c => c.item === it.key).pop() || null])),
    letter: { fy: letterYear.fy, fye: letterYear.fye, due: letterYear.due, missing: !letterYear.afr },
    contact: { office: `Records custodian, ${name}`, detail: "Florida asks every agency to post its records contact on its website (s.119.12(2), Florida Statutes). Look there first.", source: null },
    jlac: J.length > 0, sourcePage: HUMAN_PAGE,
  });
}

const OUT = p("data", "derived", "florida.json");
const SCOPE = "florida";
brakeAndLog({ scope: SCOPE, snapshot, entities, approve: args.approve });
entities.sort((a, b) => a.name.localeCompare(b.name));
writeJSON(OUT, { state: "FL", snapshot, asOf, rubric: RUBRIC_VERSION, reportYears, sources: { logerx: HUMAN_PAGE }, entities, unmatched: [] });

const n = k => entities.filter(e => e.worst === k && !e.dissolved).length;
const byType = Object.fromEntries(Object.values(TYPE).map(t => [t, entities.filter(e => e.type === t).length]));
console.log(`snapshot ${snapshot}, fiscal years ${reportYears.join(", ")}: ${entities.length} entities ${JSON.stringify(byType)}, dissolved ${entities.filter(e => e.dissolved).length}`);
console.log(`worst status (active): not filed ${n("overdue")}, late ${n("late")}, on time ${n("on_time")}, not due ${n("not_due")}; cities placed in a county ${entities.filter(e => e.type === "city" && e.county).length} of ${byType.city}; JLAC flags ${entities.filter(e => e.jlac).length}`);
