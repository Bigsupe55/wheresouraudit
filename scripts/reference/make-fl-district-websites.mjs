// Reference: Florida special district official websites, from FloridaCommerce's Official List
// (s.189.069 requires each district to keep an official website and report it).
// The site's firewall refuses requests without a browser user agent.
// Usage: node scripts/reference/make-fl-district-websites.mjs
import { p, writeFile, toCSV, iso } from "../lib/util.mjs";
import { readXlsx } from "../lib/xlsx.mjs";

const URL = "https://specialdistrictreports.floridajobs.org/OfficialList/DistrictWebsiteExcel";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
const res = await fetch(URL, { headers: { "User-Agent": UA } });
if (!res.ok) { console.error(`FAILED ${res.status}`); process.exit(1); }
const rows = readXlsx(Buffer.from(await res.arrayBuffer()));
const head = rows.findIndex(r => /District's Name/i.test(r[1] || ""));
const out = rows.slice(head + 1).filter(r => r[1]).map(r => [r[1].trim(), /^https?:\/\//i.test(r[2] || "") ? r[2].trim() : "", /^https?:\/\//i.test(r[2] || "") ? "" : (r[2] || "").trim()]);
writeFile(p("data", "reference", "fl-district-websites.csv"), toCSV([["district", "website", "note"], ...out]));
writeFile(p("data", "reference", "fl-district-websites.SOURCE.txt"), `${URL}\tfetched ${iso(new Date())}\n`);
console.log(`${out.length} districts, ${out.filter(r => r[1]).length} with a website`);
