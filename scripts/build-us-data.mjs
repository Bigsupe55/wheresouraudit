// Nationwide: federal single audit status from the Federal Audit Clearinghouse (FAC), attached to the
// Census of Governments general-purpose list (counties, municipalities, townships).
// Maine and Florida are skipped here: they have full state pages.
// FAC can show "filed on time" and "filed late", never "missing" (an entity under the federal threshold files nothing).
// Usage: node scripts/build-us-data.mjs [--snapshot=YYYY-MM-DD] [--approve]
import fs from "node:fs";
import { p, readText, writeJSON, csvObjects, slug, cleanWebsite, addMonthsEnd, daysBetween, latestDir, fmtDate, yearRange } from "./lib/util.mjs";
import { brakeAndLog } from "./lib/brake.mjs";

const args = Object.fromEntries(process.argv.slice(2).map(a => a.replace(/^--/, "").split("=")).map(([k, v]) => [k, v ?? true]));
const snapshot = args.snapshot || latestDir(p("data", "raw", "us"));
const asOf = snapshot;
const FIRST_JUDGED_YEAR = 2022; // pandemic-era extensions (OMB M-21-20) make earlier lateness unreliable
const SKIP = new Set(["ME", "FL"]);
export const US_LABELS = { on_time: "Filed on time", late: "Filed late", none: "No federal audit on file" };
const CLS = { on_time: "good", late: "warn", none: "none" };
const STATE_NAMES = { AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado", CT: "Connecticut", DE: "Delaware", DC: "District of Columbia", FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi", MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont", VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming" };

// ---------- name canonicalization (exact rules, no fuzzy matching) ----------
const KINDS = ["CHARTER TOWNSHIP", "TOWNSHIP", "CITY", "TOWN", "VILLAGE", "BOROUGH", "COUNTY", "PARISH", "PLANTATION", "MUNICIPALITY"];
const KIND_CLASS = { "CHARTER TOWNSHIP": "township", TOWNSHIP: "township", CITY: "municipal", TOWN: "municipal", VILLAGE: "municipal", BOROUGH: "municipal", PLANTATION: "municipal", MUNICIPALITY: "municipal", COUNTY: "county", PARISH: "county" };
// Suffixes that name the county government itself (not a county agency such as a board of health).
const COUNTY_GOV_SUFFIX = /\s+(COMMISSION|BOARD OF COMMISSIONERS|BOARD OF COUNTY COMMISSIONERS|BOARD OF SUPERVISORS|GOVERNMENT|FISCAL COURT|COMMISSIONERS)$/;
const clean = s => s.toUpperCase().replace(/&/g, " AND ").replace(/[.,'"()]/g, " ").replace(/\bSAINT\b/g, "ST").replace(/\bMOUNT\b/g, "MT").replace(/\s+/g, " ").trim();
// Words that mean the auditee is an agency, school or district, not the general-purpose government itself.
const NOT_GENERAL = /\b(SCHOOL|SCHOOLS|DISTRICT|HEALTH|CENTER|CENTERS|AUTHORITY|BOARD OF (?!COMMISSIONERS|COUNTY COMMISSIONERS|SUPERVISORS)|SERVICES?|ACADEMY|COLLEGE|HOUSING|LIBRARY|PARK|WATER|SEWER|FIRE|DEPARTMENT|COUNCIL|AGENCY|HOSPITAL|UTILIT(Y|IES)|TRANSIT|AIRPORT|PORT|CONSORTIUM|COOPERATIVE|FOUNDATION|ASSOCIATION|PREPARATORY|HALL|COURT(?! FISCAL)|SHERIFF|PROGRAM|PARTNERSHIP|ALLIANCE|INSTITUTE|UNIVERSITY|COMMUNITY)\b/;
function canon(name, state) {
  if (NOT_GENERAL.test(clean(name).replace(/ FISCAL COURT$/, ""))) return null;
  let s = clean(name).replace(new RegExp(`\\s+(STATE OF )?(${state}|${(STATE_NAMES[state] || "").toUpperCase()})$`), "").replace(/^THE /, "");
  s = s.replace(/^(CORPORATION|INCORPORATED|INC) OF THE /, "").replace(/^INCORPORATED (VILLAGE|CITY|TOWN) OF /, "$1 OF ");
  // "MIAMI TOWNSHIP, CLERMONT COUNTY" / "MADISON TOWNSHIP - FRANKLIN COUNTY": keep the county as a tie-breaker.
  let countyHint = null;
  const q = new RegExp(`^(.+ (?:${KINDS.filter(k => k !== "COUNTY").join("|")}))(?: -|,)? (.+) COUNTY$`).exec(s);
  if (q) { s = q[1]; countyHint = q[2]; }
  let m = new RegExp(`^(${KINDS.join("|")}) OF (.+)$`).exec(s);
  if (m) return { cls: KIND_CLASS[m[1]], kind: m[1], core: m[2].trim(), countyHint };
  if (/COUNTY /.test(s) && COUNTY_GOV_SUFFIX.test(s)) s = s.replace(COUNTY_GOV_SUFFIX, "");
  m = new RegExp(`^(.+) (${KINDS.join("|")})$`).exec(s);
  if (m) return { cls: KIND_CLASS[m[2]], kind: m[2], core: m[1].trim(), countyHint };
  return null;
}
const zip5 = z => (z || "").replace(/\D/g, "").slice(0, 5);

// ---------- Census list ----------
const census = csvObjects(readText(p("data", "reference", "census-govt-units-2022.csv"))).filter(c => c.IS_ACTIVE !== "N");
const byKey = new Map();
for (const c of census) {
  const k = canon(c.UNIT_NAME, c.STATE);
  if (!k) continue;
  c._k = k;
  // Census sometimes repeats the type at the end ("CITY OF WEST CARROLLTON CITY"); also index the name without it.
  const cores = [k.core];
  const t = / (CITY|TOWN|VILLAGE|BOROUGH|TOWNSHIP)$/.exec(k.core);
  if (t) cores.push(k.core.slice(0, -t[0].length));
  for (const key of cores.flatMap(core => [`${c.STATE}|${k.cls}|${k.kind}|${core}`, `${c.STATE}|${k.cls}|*|${core}`])) {
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(c);
  }
}

// ---------- FAC rows, grouped into auditees ----------
const fac = csvObjects(readText(p("data", "raw", "us", snapshot, "fac-general-local.csv"))).filter(r => STATE_NAMES[r.auditee_state]);
const auditees = new Map(); // key: state|EIN (or UEI) -> rows
for (const r of fac) {
  const id = r.auditee_ein && r.auditee_ein !== "GSA_MIGRATION" ? `ein${r.auditee_ein}` : `uei${r.auditee_uei}`;
  const k = `${r.auditee_state}|${id}`;
  if (!auditees.has(k)) auditees.set(k, []);
  auditees.get(k).push(r);
}

function rollWeekend(isoDate) {
  const d = new Date(isoDate + "T00:00:00Z");
  while ([0, 6].includes(d.getUTCDay())) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
function yearsOf(rows) {
  const byYear = new Map();
  for (const r of rows) { const y = r.audit_year; const prev = byYear.get(y); if (!prev || (r.fac_accepted_date || "") > (prev.fac_accepted_date || "")) byYear.set(y, r); }
  return [...byYear.values()].sort((a, b) => a.audit_year.localeCompare(b.audit_year)).map(r => {
    const fyEnd = r.fy_end_date.slice(0, 10);
    const endOfMonth = new Date(Date.parse(fyEnd) + 86400000).getUTCDate() === 1;
    const due = rollWeekend(endOfMonth ? addMonthsEnd(fyEnd, 9) : (() => { const d = new Date(fyEnd + "T00:00:00Z"); d.setUTCMonth(d.getUTCMonth() + 9); return d.toISOString().slice(0, 10); })());
    const accepted = (r.fac_accepted_date || r.submitted_date || "").slice(0, 10) || null;
    const judged = +r.audit_year >= FIRST_JUDGED_YEAR;
    const status = !accepted ? "none" : !judged || accepted <= due ? "on_time" : "late";
    return { fy: r.audit_year, fyEnd, due, accepted, status, daysLate: status === "late" ? daysBetween(due, accepted) : null, judged, report: r.report_id, spent: Math.round(+r.total_amount_expended || 0), name: r.auditee_name, city: r.auditee_city, zip: zip5(r.auditee_zip) };
  });
}

// ---------- match auditees to Census units (exact canonical name in the same state; ties broken by ZIP or city) ----------
const matched = new Map(); // census id -> auditee rows
const facOnly = [];
const unmatched = [];
for (const [k, rows] of auditees) {
  const state = k.split("|")[0];
  const latest = rows.slice().sort((a, b) => a.audit_year.localeCompare(b.audit_year)).pop();
  const c = canon(latest.auditee_name, state);
  if (!c) { facOnly.push({ state, rows }); continue; }
  let cands = byKey.get(`${state}|${c.cls}|${c.kind}|${c.core}`) || [];
  if (!cands.length && c.cls === "municipal") cands = byKey.get(`${state}|municipal|*|${c.core}`) || [];
  if (cands.length > 1 && c.countyHint) {
    const byCounty = cands.filter(x => clean(x.COUNTY_AREA_NAME) === c.countyHint);
    if (byCounty.length) cands = byCounty;
  }
  if (cands.length > 1) {
    const z = zip5(latest.auditee_zip), city = clean(latest.auditee_city);
    const narrowed = cands.filter(x => zip5(x.ZIP) === z || clean(x.CITY) === city);
    cands = narrowed.length === 1 ? narrowed : cands;
  }
  if (cands.length === 1) {
    const id = cands[0].CENSUS_ID_PID6;
    if (!matched.has(id)) matched.set(id, []);
    matched.get(id).push(...rows);
  } else {
    unmatched.push({ state: STATE_NAMES[state] ? state : state, source: "Federal Audit Clearinghouse", sourceName: latest.auditee_name, reason: cands.length ? `${cands.length} possible matches in the Census list` : "no exact match in the Census list" });
  }
}

// ---------- entities ----------
const titleCase = s => s.toLowerCase().replace(/\b([a-z])/g, (m, c) => c.toUpperCase()).replace(/\b(Of|And|The)\b/g, w => w.toLowerCase()).replace(/^./, c => c.toUpperCase());
const TYPE_LABEL = { "1 - COUNTY": "County", "2 - MUNICIPAL": "Municipality", "3 - TOWNSHIP": "Township" };
function flagsFor(name, years) {
  const flags = [];
  const judged = years.filter(y => y.judged && y.accepted);
  const late = judged.filter(y => y.status === "late");
  const latest = judged[judged.length - 1];
  const RULE = "Federal single audits are due 9 months after the fiscal year ends (2 CFR 200.512). An agency may have granted an extension we can't see.";
  if (latest && latest.status === "on_time") flags.push({ cls: "good", label: US_LABELS.on_time, sentence: `${name} filed its federal single audit for fiscal year ${latest.fy} on ${fmtDate(latest.accepted)}, ${latest.accepted === latest.due ? "on the day of" : "before"} the ${fmtDate(latest.due)} deadline.`, report: latest.report });
  if (late.length) flags.push({ cls: "warn", label: US_LABELS.late, sentence: `${name}'s federal single ${late.length > 1 ? "audits" : "audit"} for ${yearRange(late.map(y => y.fy))} reached the Federal Audit Clearinghouse after the federal deadline (${late.map(y => `FY${y.fy}: ${y.daysLate} days after`).join("; ")}).`, report: late[late.length - 1].report });
  // "Stopped filing": filed for year N, nothing on file for year N+1, which is past due. A fact, not an accusation.
  if (latest) {
    const nextDue = rollWeekend(addMonthsEnd(addMonthsEnd(latest.fyEnd, 12), 9));
    if (nextDue < asOf && !years.some(y => +y.fy === +latest.fy + 1)) flags.push({ cls: "none", label: US_LABELS.none, sentence: `${name} filed a federal single audit for fiscal year ${latest.fy}, but we found none for fiscal year ${+latest.fy + 1}, which would have been due ${fmtDate(nextDue)}. That is normal if it spent less than $1 million in federal money that year.`, report: null });
  }
  for (const f of flags) Object.assign(f, { rule: RULE, ourRule: false, source: f.report ? `https://app.fac.gov/dissemination/summary/${f.report}` : "https://app.fac.gov/dissemination/search/", asOf });
  return flags;
}
function entityFrom({ state, id, name, typeLabel, county, pop, web, years, fips = null, eins = [] }) {
  const judged = years.filter(y => y.judged && y.accepted);
  const latest = judged[judged.length - 1];
  const late = judged.filter(y => y.status === "late");
  const flags = flagsFor(name, years);
  const statusKey = latest ? latest.status : "none";
  let headline;
  if (!years.length) headline = "No federal single audit on file since 2021";
  else if (latest?.status === "late") headline = `Latest federal audit filed ${latest.daysLate} days late (FY${latest.fy})`;
  else if (latest && late.length) headline = `FY${latest.fy} federal audit filed on time, after ${late.length} late ${late.length > 1 ? "years" : "year"}`;
  else if (latest) headline = `Latest federal audit filed on time (FY${latest.fy})`;
  else headline = "Federal audit on file for 2021 only";
  return { id, state, name, typeLabel, county, pop, web, fips, eins, status: { key: statusKey, cls: CLS[statusKey], label: US_LABELS[statusKey] }, worst: late.length ? "late" : statusKey, headline, flags,
    years: years.map(y => ({ fy: y.fy, fyEnd: y.fyEnd, due: y.due, accepted: y.accepted, status: y.status, daysLate: y.daysLate, report: y.report, spent: y.spent })) };
}
const entities = [];
const used = new Set();
const mkId = (state, name) => { let s = `${state.toLowerCase()}-${slug(name)}`; let i = 2; while (used.has(s)) s = `${state.toLowerCase()}-${slug(name)}-${i++}`; used.add(s); return s; };
// Same name twice in a state (many Ohio townships): put the county in the address instead of a number.
const nameCount = new Map();
for (const c of census) nameCount.set(`${c.STATE}|${c.UNIT_NAME}`, (nameCount.get(`${c.STATE}|${c.UNIT_NAME}`) || 0) + 1);
for (const c of census) {
  const rows = matched.get(c.CENSUS_ID_PID6) || [];
  const name = titleCase(c.UNIT_NAME);
  const idName = nameCount.get(`${c.STATE}|${c.UNIT_NAME}`) > 1 && c.COUNTY_AREA_NAME ? `${c.UNIT_NAME} ${c.COUNTY_AREA_NAME} county` : c.UNIT_NAME;
  entities.push(entityFrom({ state: c.STATE, id: mkId(c.STATE, idName), name, typeLabel: TYPE_LABEL[c.UNIT_TYPE] || "Local government", county: c.COUNTY_AREA_NAME ? titleCase(c.COUNTY_AREA_NAME) : null, pop: +c.POPULATION || null, web: cleanWebsite(c.WEB_ADDRESS), years: yearsOf(rows), fips: c.FIPS_STATE + c.FIPS_COUNTY + c.FIPS_PLACE }));
}
for (const { state, rows } of facOnly) {
  const latest = rows.slice().sort((a, b) => a.audit_year.localeCompare(b.audit_year)).pop();
  const name = titleCase(latest.auditee_name);
  entities.push(entityFrom({ state, id: mkId(state, latest.auditee_name), name, typeLabel: "Other local entity", county: null, pop: null, web: null, years: yearsOf(rows), eins: [...new Set(rows.map(r => r.auditee_ein).filter(Boolean))] }));
}

const OUT = p("data", "derived", "us.json");
// The brake compares per-year statuses; "none" years don't exist, so reuse it with the same shape.
brakeAndLog({ scope: "us", snapshot, entities: entities.map(e => ({ id: e.id, years: e.years })), approve: args.approve, overdueKey: "__never__" });
entities.sort((a, b) => a.state.localeCompare(b.state) || a.name.localeCompare(b.name));
// Maine and Florida have full state pages: their federal records are merged into those pages by build-site.mjs.
const national = entities.filter(e => !SKIP.has(e.state)), mefl = entities.filter(e => SKIP.has(e.state));
writeJSON(OUT, { scope: "US", snapshot, asOf, firstJudgedYear: FIRST_JUDGED_YEAR, stateNames: STATE_NAMES, skipped: [...SKIP], entities: national, mefl, unmatched });

const census_n = census.length, withFac = entities.filter(e => e.typeLabel !== "Other local entity" && e.years.length).length;
console.log(`snapshot ${snapshot}: ${census_n} Census governments (${withFac} with a federal audit on file), ${facOnly.length} other FAC-only entities, ${unmatched.length} FAC auditees unmatched`);
console.log(`latest status: on time ${entities.filter(e => e.status.key === "on_time").length}, late ${entities.filter(e => e.status.key === "late").length}, none ${entities.filter(e => e.status.key === "none").length}`);
