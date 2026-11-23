// Turn the latest Maine snapshot into data/derived/maine.json: one record per entity with
// per-year audit statuses, flags, rubric items and contacts.
// Usage: node scripts/build-maine-data.mjs [--snapshot=YYYY-MM-DD] [--approve]
//   --approve  publish even if the safety brake trips (more than 10% of statuses changed).
import fs from "node:fs";
import { p, readText, readJSON, writeJSON, writeFile, csvObjects, toCSV, slug, lastDayOfMonth, addMonthsEnd, mdyToISO, daysBetween, latestDir, yearRange, fmtDate } from "./lib/util.mjs";
import { parseFirstTable } from "./lib/html-table.mjs";
import { brakeAndLog } from "./lib/brake.mjs";
import { ITEMS, item1Points, item2Points, letterGrade, MAINE_LABELS, STATUS_CLASS, RUBRIC_VERSION } from "./lib/rubric.mjs";

const args = Object.fromEntries(process.argv.slice(2).map(a => a.replace(/^--/, "").split("=")).map(([k, v]) => [k, v ?? true]));
const RAW = p("data", "raw", "maine");
const snapshot = args.snapshot || latestDir(RAW);
const asOf = snapshot; // statuses are judged as of the day the source was copied
const SRC = {
  municipal: "https://www.maine.gov/audit/municipal/annual-audit-reports.html",
  county: "https://www.maine.gov/audit/county/annual-audit-reports.html",
};
const COUNTY_LAW_FROM = "2026-07-29"; // 30-A M.R.S. s.951 12-month deadline applies to audits due on or after this date
const MONTHS = { JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6, JUNE: 6, JUL: 7, JULY: 7, AUG: 8, SEP: 9, SEPT: 9, OCT: 10, NOV: 11, DEC: 12 };

// ---------- reference data ----------
const norm = s => s.toUpperCase().replace(/[.']/g, "").replace(/\b(PLANTATION|PLT)\b/g, "PLT").replace(/\bST\b/g, "SAINT").replace(/\s+/g, " ").trim();
const gaz = readText(p("data", "reference", "census-gazetteer-2024-me-cousubs.txt"), "latin1").split(/\r?\n/).slice(1).filter(Boolean).map(l => l.split("\t").map(c => c.trim()));
const byKey = new Map();
for (const g of gaz) {
  const [, geoid, , name, funcstat] = g;
  const m = /^(.*) (town|city|plantation|UT|CDP|Indian Reservation|reservation)$/.exec(name);
  if (!m) continue;
  const [_, base, typ] = m;
  if (!["town", "city", "plantation"].includes(typ)) continue; // unorganized territories and reservations are not on the State Auditor list
  const key = norm(base + (typ === "plantation" ? " PLT" : ""));
  if (!byKey.has(key)) byKey.set(key, []);
  byKey.get(key).push({ geoid, censusName: name, type: typ, funcstat, base });
}
const aliasFile = p("data", "manual", "aliases-me.csv");
const aliases = new Map(fs.existsSync(aliasFile) ? csvObjects(readText(aliasFile)).map(r => [norm(r.source_name), r.geoid]) : []);
const byGeoid = new Map([...byKey.values()].flat().map(g => [g.geoid, g]));

const clerks = new Map(csvObjects(readText(p("data", "reference", "maine-sos-clerks.csv"))).map(r => [norm(r.Municipality), r]));

const manual = name => { const f = p("data", "manual", name); return fs.existsSync(f) ? csvObjects(readText(f)) : []; };
const checks = manual("website-checks.csv");
const replies = manual("replies.csv");
const ownSite = manual("own-site-audits.csv");

// ---------- parse the snapshot ----------
const EXPECTED_HEAD = /^(municipality|county|entity|name)/i;
function parseSource(file, kind) {
  const html = readText(p("data", "raw", "maine", snapshot, file));
  const { headers, rows } = parseFirstTable(html);
  const years = headers.slice(2, -1);
  // Schema guard: if the page changes shape, stop rather than publish nonsense.
  if (!EXPECTED_HEAD.test(headers[0]) || years.length < 3 || !years.every(y => /^\d{4}$/.test(y)) || !/firm|auditor/i.test(headers[headers.length - 1])) {
    throw new Error(`SAFETY BRAKE: ${file} columns changed shape: ${JSON.stringify(headers)}. Review the page before publishing.`);
  }
  return rows.filter(r => r.length === headers.length).map(r => ({
    kind, sourceName: r[0].text, fyeMonth: r[1].text.toUpperCase(),
    years: Object.fromEntries(years.map((y, i) => [y, { posted: mdyToISO(r[2 + i].text), pdf: r[2 + i].href || null }])),
    firm: r[r.length - 1].text, tableYears: years,
  }));
}
const rows = [...parseSource("municipal.html", "municipal"), ...parseSource("county.html", "county")];

// ---------- statuses ----------
function yearStatus(row, fy) {
  const month = MONTHS[row.fyeMonth];
  if (!month) return null;
  const fye = lastDayOfMonth(+fy, month);
  const due = addMonthsEnd(fye, 12);
  const posted = row.years[fy]?.posted || null;
  let status;
  if (posted) status = posted <= due ? "on_time" : "late";
  else status = due < asOf ? "overdue" : "not_due";
  const byLaw = row.kind === "county" && due >= COUNTY_LAW_FROM;
  return { fy, fye, due, posted, pdf: row.years[fy]?.pdf || null, status, daysLate: posted && status === "late" ? daysBetween(due, posted) : null, byLaw };
}

const entities = [];
const unmatched = [];
for (const row of rows) {
  let type, geoid = null, censusName = null, name;
  if (row.kind === "county") {
    type = "county";
    name = row.sourceName.replace(/\s+COUNTY$/i, "").toLowerCase().replace(/\b\w/g, c => c.toUpperCase()) + " County";
  } else {
    const k = norm(row.sourceName);
    let hits = aliases.has(k) ? [byGeoid.get(aliases.get(k))].filter(Boolean) : (byKey.get(k) || (k.endsWith(" PLT") ? byKey.get(k.slice(0, -4)) : null) || byKey.get(k + " PLT") || []);
    if (hits.length > 1) hits = hits.filter(h => h.type !== "plantation" || k.endsWith(" PLT")); // e.g. a town and a same-named UT
    if (hits.length === 1) {
      ({ geoid, censusName } = hits[0]); type = hits[0].type;
      name = hits[0].base + (type === "plantation" ? " Plantation" : "");
    } else if (/VILLAGE|VILLAGE CORP/i.test(row.sourceName)) {
      type = "village"; // village corporations: quasi-municipal, not Census units. Labelled, not graded differently.
      name = row.sourceName.toLowerCase().replace(/\b\w/g, c => c.toUpperCase()).replace(/\bCorp\b/, "Corporation");
    } else {
      unmatched.push({ state: "ME", source: "Maine State Auditor", sourceName: row.sourceName, reason: hits.length ? "more than one possible match" : "no exact match in the Census list" });
      continue;
    }
  }
  const typeSlug = { county: "county", town: "town", city: "city", plantation: "plantation", village: "village" }[type];
  const id = `me-${typeSlug}-${slug(name.replace(/ (County|Plantation)$/, ""))}`;
  const yrs = row.tableYears.map(fy => yearStatus(row, fy)).filter(Boolean).sort((a, b) => a.fy.localeCompare(b.fy));

  // Own-site audits (ticket 09): count by earliest archive date, flagged as "posted on [entity]'s site".
  for (const o of ownSite.filter(o => o.entity_id === id)) {
    const y = yrs.find(y => y.fy === o.fiscal_year);
    if (y && !y.posted && o.earliest_archive_date) {
      y.ownSite = { url: o.url, archive: o.archive_url, date: o.earliest_archive_date };
      y.status = o.earliest_archive_date <= y.due ? "on_time" : "late";
      y.posted = o.earliest_archive_date;
    }
  }

  const due = yrs.filter(y => y.status !== "not_due");
  const latest = due[due.length - 1] || null;
  const prior = latest ? due.filter(y => y.fy < latest.fy).slice(-3) : [];
  const overdue = due.filter(y => y.status === "overdue");
  const late = due.filter(y => y.status === "late");

  // ---------- flags (ticket 07: 7 parts each) ----------
  const ruleText = y => y.byLaw
    ? "County audits are due to the State Auditor within 12 months of year end (30-A M.R.S. s.951)."
    : row.kind === "county"
      ? "Our 12-month rule. The county 12-month deadline in 30-A M.R.S. s.951 applies to audits due from July 29, 2026."
      : "Our 12-month rule. Maine law (30-A M.R.S. s.5823) sets no deadline after year end.";
  const src = row.kind === "county" ? SRC.county : SRC.municipal;
  const flags = [];
  const group = (list, status) => {
    if (!list.length) return;
    const byLaw = list.every(y => y.byLaw);
    const label = MAINE_LABELS[status];
    let sentence;
    if (status === "overdue") sentence = `${name}'s ${list.length > 1 ? "audits" : "audit"} for ${yearRange(list.map(y => y.fy))} ${list.length > 1 ? "are" : "is"} not posted on the Maine State Auditor's site, and more than 12 months have passed since ${list.length > 1 ? "each" : "that"} year ended.`;
    else if (status === "late") sentence = `${name}'s ${list.length > 1 ? "audits" : "audit"} for ${yearRange(list.map(y => y.fy))} ${list.length > 1 ? "were" : "was"} posted on the Maine State Auditor's site more than 12 months after the year ended (${list.map(y => `FY${y.fy}: ${y.daysLate} days after`).join("; ")}).`;
    else sentence = `${name}'s audit for fiscal year ${list[0].fy} was posted on the Maine State Auditor's site on ${fmtDate(list[0].posted)}, within 12 months of the year ending.`;
    const key = `${status}-${list.map(y => y.fy).join("-")}`;
    flags.push({
      key, cls: STATUS_CLASS[status], label, sentence, rule: ruleText(list[list.length - 1]), ourRule: !byLaw,
      source: src, sourceCopy: `/sources/maine/${snapshot}/${row.kind}.html`, asOf,
      reply: replies.find(r => r.entity_id === id && r.flag_key === key) || null,
    });
  };
  group(overdue, "overdue");
  group(late, "late");
  if (latest && latest.status === "on_time") group([latest], "on_time");
  for (const y of yrs.filter(y => y.ownSite)) {
    flags.push({ key: `ownsite-${y.fy}`, cls: "warn", label: `Posted on ${name}'s site, not on the State Auditor's`, sentence: `An audit for fiscal year ${y.fy} appears on ${name}'s own website but not on the Maine State Auditor's list. Its earliest archived copy is dated ${fmtDate(y.ownSite.date)}.`, rule: "Counted for grading from its earliest archived date (rubric v1.1).", ourRule: true, source: y.ownSite.url, sourceCopy: y.ownSite.archive, asOf, reply: null });
  }

  // ---------- headline ----------
  let headline;
  if (overdue.length) headline = `${overdue.length} ${overdue.length > 1 ? "audits" : "audit"} not posted (FY${overdue[0].fy}${overdue.length > 1 ? ` to FY${overdue[overdue.length - 1].fy}` : ""})`;
  else if (latest?.status === "late") headline = `Latest audit posted after 12 months (FY${latest.fy})`;
  else if (latest) headline = `Latest audit posted on time (FY${latest.fy})`;
  else headline = "No audit due yet";

  // ---------- rubric ----------
  const pts = ITEMS.map(() => null);
  pts[0] = latest ? item1Points(latest.status) : null;
  pts[1] = item2Points(prior.map(y => y.status));
  const myChecks = checks.filter(c => c.entity_id === id);
  for (const it of ITEMS.slice(2)) {
    const c = myChecks.filter(c => c.item === it.key).sort((a, b) => a.checked_on.localeCompare(b.checked_on)).pop();
    if (c) pts[it.n - 1] = c.result === "pass" ? it.max : 0;
  }
  const graded = pts.every(v => v !== null);
  const score = graded ? pts.reduce((a, b) => a + b, 0) : null;
  const evidence = Object.fromEntries(ITEMS.slice(2).map(it => [it.key, myChecks.filter(c => c.item === it.key).pop() || null]));

  // ---------- records contact (Maine SOS public clerk list; office only, no personal names) ----------
  const ck = clerks.get(norm(row.sourceName)) || clerks.get(norm(name.replace(/ Plantation$/, "")));
  const contact = type === "county"
    ? { office: `${name} Commissioners' office`, detail: "Find the county's records contact on its official website.", source: null }
    : ck ? { office: `${type === "plantation" ? "Plantation" : type === "city" ? "City" : "Town"} Clerk's office, ${name}`, detail: [ck["Address Line 1"], ck["Address Line 2"], ck.CityStateZip].filter(Boolean).join(", ") + (ck["Work Phone"] ? ` · ${ck["Work Phone"]}` : ""), source: "Maine Secretary of State clerk list" }
      : { office: `Clerk's office, ${name}`, detail: "Not in the Secretary of State's clerk list. Ask at the town office.", source: null };

  entities.push({
    id, state: "ME", type, typeLabel: { county: "County", town: "Town", city: "City", plantation: "Plantation", village: "Village corporation" }[type],
    name, sourceName: row.sourceName, geoid, censusName, firm: row.firm, fyeMonth: row.fyeMonth,
    url: `/me/${typeSlug}/${slug(name.replace(/ (County|Plantation)$/, ""))}/`,
    status: latest ? { key: latest.status, cls: STATUS_CLASS[latest.status], label: MAINE_LABELS[latest.status] } : { key: "not_due", cls: "none", label: MAINE_LABELS.not_due },
    worst: overdue.length ? "overdue" : late.length ? "late" : latest ? latest.status : "not_due",
    headline, years: yrs, latestFy: latest?.fy || null, flags, pts, graded, score, grade: graded ? letterGrade(score) : null, evidence,
    letter: (() => { const y = overdue[overdue.length - 1] || latest || yrs[yrs.length - 1]; return { fy: y.fy, fye: y.fye, due: y.due, missing: !y.posted }; })(),
    contact, sourcePage: src,
  });
}

// ---------- safety brake: compare with the last published data ----------
const OUT = p("data", "derived", "maine.json");
const SCOPE = "maine";
brakeAndLog({ scope: SCOPE, snapshot, entities, approve: args.approve });

entities.sort((a, b) => a.name.localeCompare(b.name));
writeJSON(OUT, { state: "ME", snapshot, asOf, rubric: RUBRIC_VERSION, sources: SRC, entities, unmatched });

const count = k => entities.filter(e => e.worst === k).length;
console.log(`snapshot ${snapshot}: ${entities.length} entities (${entities.filter(e => e.type === "county").length} counties, ${entities.filter(e => e.type === "village").length} village corporations), ${unmatched.length} unmatched`);
console.log(`worst status: overdue ${count("overdue")}, late ${count("late")}, on time ${count("on_time")}, not due ${count("not_due")}; graded ${entities.filter(e => e.graded).length}`);
