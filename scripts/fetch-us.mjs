// Download the Federal Audit Clearinghouse full "general" CSV (about 270 MB, no key needed),
// keep only local-government rows from audit year 2021 on, drop personal contact columns, and save
// a slim dated copy: data/raw/us/<date>/fac-general-local.csv
// Usage: node scripts/fetch-us.mjs
import fs from "node:fs";
import { Readable } from "node:stream";
import { p, iso, toCSV } from "./lib/util.mjs";

const URL = "https://app.fac.gov/dissemination/public-data/gsa/full/general.csv";
const KEEP = ["report_id", "audit_year", "auditee_name", "auditee_city", "auditee_state", "auditee_zip", "auditee_ein", "auditee_uei", "fy_start_date", "fy_end_date", "submitted_date", "fac_accepted_date", "total_amount_expended", "entity_type", "resubmission_status"];
const day = iso(new Date());
const outDir = p("data", "raw", "us", day);
fs.mkdirSync(outDir, { recursive: true });
const out = fs.createWriteStream(p("data", "raw", "us", day, "fac-general-local.csv"));

const res = await fetch(URL);
if (!res.ok) { console.error(`FAILED ${res.status}`); process.exit(1); }

// Streaming CSV parser (handles quoted fields with commas, quotes and newlines).
let head = null, idx = null, kept = 0, seen = 0, field = "", row = [], q = false, pendingQuote = false;
const emit = r => {
  if (!head) { head = r; idx = KEEP.map(k => { const i = head.indexOf(k); if (i < 0) throw new Error(`SAFETY BRAKE: column ${k} missing from FAC general.csv`); return i; }); out.write(toCSV([KEEP])); return; }
  seen++;
  const get = k => r[head.indexOf(k)];
  if (get("entity_type") !== "local" || +get("audit_year") < 2021) return;
  kept++;
  out.write(toCSV([idx.map(i => r[i] ?? "")]));
};
const decoder = new TextDecoder();
for await (const chunk of Readable.fromWeb(res.body)) {
  const s = decoder.decode(chunk, { stream: true });
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (pendingQuote) { pendingQuote = false; if (c === '"') { field += '"'; continue; } q = false; }
    if (q) { if (c === '"') pendingQuote = true; else field += c; continue; }
    if (c === '"') q = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field.replace(/\r$/, "")); field = ""; emit(row); row = []; }
    else field += c;
  }
}
if (field || row.length) { row.push(field); emit(row); }
out.end();
fs.writeFileSync(p("data", "raw", "us", day, "SOURCES.txt"), `fac-general-local.csv\tfiltered from ${URL} (entity_type=local, audit_year>=2021; contact name, email and phone columns dropped)\tfetched ${new Date().toISOString()}\nRows in source: ${seen}. Rows kept: ${kept}.\n`);
console.log(`FAC general.csv: ${seen} rows, kept ${kept} local rows from 2021 on`);
