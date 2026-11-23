// Fetch Florida DFS LOGERx public system reports (Compliant and Non-Compliant) for the last 5 fiscal years,
// plus the JLAC enforcement report, as XHTML. Saves a dated snapshot.
// The endpoint is public and needs no login, but it is undocumented: pull gently (about 11 requests a week).
// Usage: node scripts/fetch-florida.mjs [lastYear]
import { p, writeFile, iso } from "./lib/util.mjs";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
const API = "https://logerx.myfloridacfo.gov/api/document/systemReport";
const day = iso(new Date());
const yearsRes = await fetch("https://logerx.myfloridacfo.gov/api/document/AFR/reportYears", { headers: { "User-Agent": UA } }).then(r => r.json()).catch(() => null);
const available = Array.isArray(yearsRes) ? yearsRes.map(Number).filter(Boolean) : [];
const last = +(process.argv[2] || (available.length ? Math.max(...available) : new Date().getFullYear() - 1));
const years = [last - 4, last - 3, last - 2, last - 1, last];
const jobs = years.flatMap(y => [["PUBLICNONCOMPLIANTGOVS", y], ["PUBLICCOMPLIANTGOVS", y]]).concat([["JLAC", last - 1], ["JLAC", last]]);
const log = [];
for (const [name, year] of jobs) {
  const res = await fetch(API, { method: "POST", headers: { "Content-Type": "application/json", "User-Agent": UA }, body: JSON.stringify({ afrYear: year, reportFormat: "XHTML", reportName: name }) });
  if (!res.ok) { console.error(`FAILED ${res.status} ${name} ${year}`); process.exit(1); }
  const body = await res.json();
  if (!body.content) { console.error(`EMPTY ${name} ${year}`); process.exit(1); }
  const html = Buffer.from(body.content, "base64").toString("utf8").replace(/^﻿/, "");
  const file = `${name.toLowerCase()}-${year}.xhtml`;
  writeFile(p("data", "raw", "florida", day, file), html);
  log.push(`${file}\tPOST ${API} ${JSON.stringify({ afrYear: year, reportFormat: "XHTML", reportName: name })}\tfetched ${new Date().toISOString()}`);
  console.log(`saved ${file} (${html.length} bytes)`);
  await new Promise(r => setTimeout(r, 2500));
}
writeFile(p("data", "raw", "florida", day, "SOURCES.txt"), log.join("\n") + "\nHuman page: https://logerx.myfloridacfo.gov/LogerX/SystemReports\n");
