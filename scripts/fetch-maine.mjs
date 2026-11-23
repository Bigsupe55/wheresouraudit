// Fetch the Maine State Auditor's municipal and county audit tables and save them as a dated snapshot.
// maine.gov refuses requests without a browser user agent, so we send one. One request per page, with a pause.
// Usage: node scripts/fetch-maine.mjs
import { p, writeFile, iso } from "./lib/util.mjs";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
const SOURCES = {
  "municipal.html": "https://www.maine.gov/audit/municipal/annual-audit-reports.html",
  "county.html": "https://www.maine.gov/audit/county/annual-audit-reports.html",
};
const day = iso(new Date());
for (const [file, url] of Object.entries(SOURCES)) {
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) { console.error(`FAILED ${res.status} ${url}`); process.exit(1); }
  const html = await res.text();
  if (!html.includes("<table")) { console.error(`No table found in ${url}; the page shape may have changed.`); process.exit(1); }
  const out = p("data", "raw", "maine", day, file);
  writeFile(out, html);
  console.log(`saved ${out} (${html.length} bytes)`);
  await new Promise(r => setTimeout(r, 2000));
}
writeFile(p("data", "raw", "maine", day, "SOURCES.txt"), Object.entries(SOURCES).map(([f, u]) => `${f}\t${u}\tfetched ${new Date().toISOString()}`).join("\n") + "\n");
