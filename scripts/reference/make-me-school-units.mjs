// Reference: Maine Department of Education list of school administrative units (SAUs) with DOE ids.
// Source: "SAU by Municipality" workbook, sheet "SAUs Only & Charters" (linked from https://www.maine.gov/doe/schools/structure).
// maine.gov refuses requests without a browser user agent. Refresh each July, when DOE publishes the new year's file;
// pass the new file's address as the first argument.
// Usage: node scripts/reference/make-me-school-units.mjs [xlsx url]
import { p, writeFile, toCSV, iso } from "../lib/util.mjs";
import { readXlsx } from "../lib/xlsx.mjs";

const URL = process.argv[2] || "https://www.maine.gov/doe/sites/maine.gov.doe/files/inline-files/School%20Finance%20-%202027%20SAU%20by%20Municipality%20-%207.1.2026.xlsx";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
const res = await fetch(URL, { headers: { "User-Agent": UA } });
if (!res.ok) { console.error(`FAILED ${res.status} ${URL}`); process.exit(1); }
const rows = readXlsx(Buffer.from(await res.arrayBuffer()), "SAUs Only & Charters");
const head = rows[0];
const ix = ["YearCode", "OrganizationName", "OrganizationId", "Organization Type"].map(k => { const i = head.indexOf(k); if (i < 0) throw new Error(`column ${k} missing`); return i; });
const data = rows.slice(1).filter(r => r[ix[1]]).map(r => ix.map(i => (r[i] ?? "").trim()));
writeFile(p("data", "reference", "me-school-units.csv"), toCSV([["year", "name", "doe_id", "type"], ...data]));
writeFile(p("data", "reference", "me-school-units.SOURCE.txt"), `${URL}\nsheet "SAUs Only & Charters", fetched ${iso(new Date())}\n`);
console.log(`${data.length} school units`);
