// Reference: FloridaCommerce "Official List of Special Districts" custom report (detailed, Excel):
// every active district with its county, dependent or independent status and other details.
// Same request as choosing every county on https://specialdistrictreports.floridajobs.org/OfficialList/CustomList
// (the site refuses requests without a browser user agent).
// Usage: node scripts/reference/make-fl-district-list.mjs
import fs from "node:fs";
import { p, writeFile, toCSV, iso } from "../lib/util.mjs";
import { readXlsx } from "../lib/xlsx.mjs";

const BASE = "https://specialdistrictreports.floridajobs.org/OfficialList/CustomList";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
const page = await (await fetch(BASE, { headers: { "User-Agent": UA } })).text();
const select = /<select[^>]*name="customReportData\.CountyName"[^>]*>([\s\S]*?)<\/select>/.exec(page)?.[1] || "";
const counties = [...select.matchAll(/<option[^>]*value="([^"]*)"/g)].map(m => m[1]);
if (counties.length < 60) { console.error(`expected 68 county options, found ${counties.length}; the form may have changed`); process.exit(1); }
const body = new URLSearchParams();
body.append("StartDate", ""); body.append("EndDate", "");
body.append("customReportData.DependencyStatus", "Dependent,Independent");
body.append("customReportData.ActiveStatus", "Active");
body.append("customReportData.BondAuthority", "Yes,No");
for (const c of counties) body.append("customReportData.CountyName", c);
body.append("customReportData.Sort", "1");
body.append("customReportData.ReportType", "Detailed");
body.append("customReportData.FormatType", "Excel");
body.append("Action", "GenerateReport");
const res = await fetch(BASE, { method: "POST", headers: { "User-Agent": UA, "Content-Type": "application/x-www-form-urlencoded", Referer: BASE }, body });
const type = res.headers.get("content-type") || "";
const buf = Buffer.from(await res.arrayBuffer());
if (!res.ok || !/sheet|excel|octet/i.test(type)) {
  fs.mkdirSync(p("data", "review"), { recursive: true });
  fs.writeFileSync(p("data", "review", "fl-district-list-response.html"), buf);
  console.error(`FAILED: HTTP ${res.status}, ${type}. Response saved to data/review/fl-district-list-response.html`); process.exit(1);
}
const rows = readXlsx(buf);
const headAt = rows.findIndex(r => r.some(c => /district.?s name/i.test(c || "")));
if (headAt < 0) { console.error("header row not found; the report layout may have changed"); process.exit(1); }
const head = rows[headAt].map(h => (h || "").trim());
// Keep the district's own facts only. The report also lists each district's registered agent (a person's
// name, title, address, phone and email); none of that is kept: the site names governments, never people.
const KEEP = ["District's Name", "District's Unique ID", "Website", "Status", "County(ies)", "Local Governing Authority", "Special Purpose", "Date Created / Established", "Creation Method", "Most Recent Update"];
const ix = KEEP.map(k => { const i = head.indexOf(k); if (i < 0) { console.error(`column missing: ${k}`); process.exit(1); } return i; });
const data = rows.slice(headAt + 1).filter(r => r[ix[0]]);
writeFile(p("data", "reference", "fl-district-list.csv"), toCSV([["district", "commerce_id", "website", "status", "counties", "local_governing_authority", "special_purpose", "created", "creation_method", "updated"], ...data.map(r => ix.map(i => (r[i] ?? "").trim()))]));
writeFile(p("data", "reference", "fl-district-list.SOURCE.txt"), `${BASE} (POST: all counties including Multi, active, dependent and independent, detailed, Excel)\nfetched ${iso(new Date())}\n`);
console.log(`${data.length} districts`);
