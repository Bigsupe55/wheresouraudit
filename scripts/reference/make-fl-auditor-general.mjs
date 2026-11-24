// Yearly: parse the Florida Auditor General's local government late-filer report (exhibits A to D) into
// data/reference/fl-auditor-general-<report>.csv. Needs pdftotext (poppler) on PATH; run locally once a year
// when the new report comes out (November or December, ahead of the Legislative Auditing Committee).
//   A: required to file an audit, not filed as of the report's cut-off date
//   B: may have been required to file, not filed (the Auditor General could not tell)
//   C: audit filed more than 9 months after fiscal year end (date filed, days late)
//   D: audit filed more than 45 days after delivery to the governing body
// Usage: node scripts/reference/make-fl-auditor-general.mjs [report] [asOf]
//   e.g. node scripts/reference/make-fl-auditor-general.mjs 2026-049 2025-10-10
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { p, writeFile, toCSV, iso } from "../lib/util.mjs";

const report = process.argv[2] || "2026-049";
const asOf = process.argv[3] || "2025-10-10";
const URL = `https://flauditor.gov/pages/pdf_files/${report}.pdf`;
// Totals printed in the report itself (counties, municipalities, special districts), used as a parse check.
const EXPECT = { "2026-049": { A: [6, 60, 66], B: [0, 2, 38], C: [7, 53, 144], D: [4, 23, 85] } }[report];

const tmp = p("data", "review", `ag-${report}`);
fs.mkdirSync(tmp, { recursive: true });
const pdf = `${tmp}/${report}.pdf`, txt = `${tmp}/${report}.txt`;
if (!fs.existsSync(pdf)) {
  const res = await fetch(URL);
  if (!res.ok) { console.error(`FAILED ${res.status} ${URL}`); process.exit(1); }
  fs.writeFileSync(pdf, Buffer.from(await res.arrayBuffer()));
}
execFileSync("pdftotext", ["-raw", pdf, txt]); // -raw keeps each table row on one line (-layout misaligns exhibit C)
const lines = fs.readFileSync(txt, "utf8").split(/\r?\n/);

const starts = {};
lines.forEach((l, i) => { const m = /^EXHIBIT ([A-G])$/.exec(l.trim()); if (m) starts[m[1]] = i; });
const order = Object.keys(starts).sort((a, b) => starts[a] - starts[b]);
const TYPES = { Counties: "county", Municipalities: "municipality", "Special Districts": "special_district" };
const rows = [];
for (const ex of "ABCD") {
  const s = starts[ex], e = starts[order[order.indexOf(ex) + 1]];
  let etype = null;
  for (let l of lines.slice(s + 1, e)) {
    l = l.trim();
    const head = l.replace(/ \(Continued\).*$/, "").replace(/ Date Filed Days Late$/, "");
    if (TYPES[head]) { etype = TYPES[head]; continue; }
    if (!etype || /^(Report No\.|November \d{4}|December \d{4}|Page \d+|.*Page \d+$)/.test(l) || / Total /.test(` ${l} `)) continue;
    const m = /^(\d{1,3}) (.+?)$/.exec(l);
    if (!m) continue;
    let rest = m[2];
    const rec = { report, as_of: asOf, exhibit: ex, entity_type: etype, seq: +m[1], name: "", date_filed: "", days_late: "", days_after_delivery: "", footnote: "", status_note: "" };
    if (ex === "C") { const mm = /^(.+?) (\d{1,2}\/\d{1,2}\/\d\d) (\d+)$/.exec(rest); if (!mm) { console.log("UNPARSED C:", l); continue; } [, rest, rec.date_filed, rec.days_late] = mm; }
    if (ex === "D") { const mm = /^(.+?) (\d+) (\d+)$/.exec(rest); if (!mm) { console.log("UNPARSED D:", l); continue; } [, rest, rec.days_after_delivery, rec.days_late] = mm; }
    // Status note first ("Name a (Dissolved 1/10/2025)"), then footnote letters: "x a", "x a, b",
    // or glued by pdftotext ("Countya", "ofa", ")a, b").
    // Both orders occur ("Name a (Dissolved ...)" and "Name (FYE 6/30/24)a"), so strip twice.
    for (let pass = 0; pass < 2; pass++) {
      let mm = /^(.+?) \(((?:Inactive|Dissolved|Established|Merged|FYE)[^)]*)\)$/.exec(rest);
      if (mm && !rec.status_note) { rest = mm[1]; rec.status_note = mm[2]; }
      mm = /^(.+?)(?: |(?<=County)|(?<=District)|(?<= of)|(?<=\)))(a, b|a|b)$/.exec(rest);
      if (mm && !rec.footnote) { rest = mm[1]; rec.footnote = mm[2].replace(", ", "+"); }
    }
    if (rec.date_filed) { const [mo, d, y] = rec.date_filed.split("/"); rec.date_filed = `20${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`; }
    rec.name = rest.trim();
    rows.push(rec);
  }
}
let bad = 0;
for (const ex of "ABCD") {
  const got = ["county", "municipality", "special_district"].map(t => rows.filter(r => r.exhibit === ex && r.entity_type === t).length);
  const ok = !EXPECT || JSON.stringify(got) === JSON.stringify(EXPECT[ex]);
  if (!ok) bad++;
  console.log(`exhibit ${ex}: ${got.join("/")} ${EXPECT ? `expected ${EXPECT[ex].join("/")} ${ok ? "OK" : "MISMATCH"}` : "(no expected totals for this report)"}`);
}
if (bad) { console.error("Totals don't match the report; not writing the CSV."); process.exit(1); }
const head = Object.keys(rows[0]);
writeFile(p("data", "reference", `fl-auditor-general-${report}.csv`), toCSV([head, ...rows.map(r => head.map(h => r[h]))]));
writeFile(p("data", "reference", `fl-auditor-general-${report}.SOURCE.txt`), `${URL}\nAuditor General Report No. ${report}, exhibits A to D, status as of ${asOf}. Parsed ${iso(new Date())} with pdftotext -raw.\n`);
console.log(`${rows.length} rows written`);
