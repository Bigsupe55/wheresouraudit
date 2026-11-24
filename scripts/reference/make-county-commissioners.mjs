// Yearly: build data/reference/county-commissioners.csv (elected county governing board members) for the
// "Who's responsible" panel, from two association directories already saved in data/review/officials/:
//   ME: Maine County Commissioners Association directory, table "2026 Maine County Commissioners"
//   FL: Florida Association of Counties County Directory, one commission page per county
// NAME AND ROLE ONLY: the directories also print phones, emails and home addresses; never copy those.
// Duval is left out on purpose: it is consolidated with Jacksonville and its board is the city council.
// It is still parsed, only to check our Florida total against the directory's own statewide figure.
// Needs pdftotext (poppler) on PATH.
// Usage: node scripts/reference/make-county-commissioners.mjs
import { execFileSync } from "node:child_process";
import { p, writeFile, toCSV } from "../lib/util.mjs";

const SRC = {
  ME: { pdf: p("data", "review", "officials", "me.pdf"), url: "https://www.mainecounties.org/uploads/1/4/3/2/143228552/2026_directory_complete.pdf", date: "2026 directory" },
  FL: { pdf: p("data", "review", "officials", "fl.pdf"), url: "https://www.fl-counties.com/wp-content/uploads/2025/04/2025-FAC-County-Directory.pdf", date: "2025 directory" },
};
const pdftotext = (pdf, mode) => execFileSync("pdftotext", [mode, "-enc", "UTF-8", pdf, "-"], { maxBuffer: 1e8 }).toString("utf8");

const ME_COUNTIES = ["Androscoggin", "Aroostook", "Cumberland", "Franklin", "Hancock", "Kennebec", "Knox", "Lincoln", "Oxford", "Penobscot", "Piscataquis", "Sagadahoc", "Somerset", "Waldo", "Washington", "York"];
const FL_COUNTIES = ["Alachua", "Baker", "Bay", "Bradford", "Brevard", "Broward", "Calhoun", "Charlotte", "Citrus", "Clay", "Collier", "Columbia", "DeSoto", "Dixie", "Duval", "Escambia", "Flagler", "Franklin", "Gadsden", "Gilchrist", "Glades", "Gulf", "Hamilton", "Hardee", "Hendry", "Hernando", "Highlands", "Hillsborough", "Holmes", "Indian River", "Jackson", "Jefferson", "Lafayette", "Lake", "Lee", "Leon", "Levy", "Liberty", "Madison", "Manatee", "Marion", "Martin", "Miami-Dade", "Monroe", "Nassau", "Okaloosa", "Okeechobee", "Orange", "Osceola", "Palm Beach", "Pasco", "Pinellas", "Polk", "Putnam", "Santa Rosa", "Sarasota", "Seminole", "St. Johns", "St. Lucie", "Sumter", "Suwannee", "Taylor", "Union", "Volusia", "Wakulla", "Walton", "Washington"];
const FL_STATEWIDE = 377; // "commissioners, totaling 377 statewide" (directory intro; counts Duval's council and mayor)
// Duval's page prints the mayor, 14 district members and only 2 of Jacksonville's 5 at-large council seats.
const DUVAL_UNPRINTED = 3;

const errors = [];
const fail = msg => errors.push(msg);
const rows = [];

// ---- Maine: one table row per commissioner: "Dis TermExp County Name  Address ..."
{
  const re = /^\s*(\d)\s+\d{2}\/\d{2}\/\d{2}\s+([A-Z][a-z]+)\s+(\S.*?)\s{2,}/;
  const seen = new Set();
  for (const line of pdftotext(SRC.ME.pdf, "-layout").split(/\r?\n/)) {
    const m = re.exec(line);
    if (!m) continue;
    const [, district, county, name] = m;
    if (!ME_COUNTIES.includes(county)) { fail(`ME: unknown county "${county}" in: ${line.trim()}`); continue; }
    const key = `${county}|${district}`;
    if (seen.has(key)) { fail(`ME: duplicate ${key}`); continue; }
    seen.add(key);
    rows.push({ state: "ME", county, role: "County Commissioner", district, name: name.trim(), source: SRC.ME.url, source_date: SRC.ME.date });
  }
}

// ---- Florida: pages with "POPULATION:" and a "COMMISSIONERS" heading are the county commission pages.
// In -raw text each member is a name line followed by a seat line ("District 3", "At-Large", "Mayor", "County Chair").
const flRows = [];
{
  const LABEL = /^(?:Distr?i?ct (\d+)|(At[- ]Large)(?: (\d+))?|(Mayor)|(County Chair))$/;
  const NAME = /^[A-Z][A-Za-z.,'’“”"\- ]*[A-Za-z.”"]$/;
  const word = s => !/\s/.test(s) && s !== s.toUpperCase(); // one name fragment, not an ALL CAPS heading
  const pages = pdftotext(SRC.FL.pdf, "-raw").split("\f").filter(pg => /POPULATION:/.test(pg) && /^COMMISSIONERS\s*$/m.test(pg));
  const seenCounty = new Set();
  for (const pg of pages) {
    const lines = pg.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    const head = lines.map(l => /^(.+?) County$/i.exec(l)).find(Boolean);
    const county = head && FL_COUNTIES.find(c => c.toLowerCase() === head[1].toLowerCase());
    if (!county) { fail(`FL: page without a known county heading: ${lines.slice(0, 3).join(" / ")}`); continue; }
    if (seenCounty.has(county)) { fail(`FL: ${county} appears on two commission pages`); continue; }
    seenCounty.add(county);
    lines.forEach((l, i) => {
      let name, district = "", role = "County Commissioner";
      const mayor = /^Mayor (.+)$/.exec(l); // Orange prints "Mayor Jerry Demings" on one line
      if (mayor) { name = mayor[1]; role = "Mayor"; }
      else {
        const m = LABEL.exec(l);
        if (!m) return;
        if (m[1]) district = `District ${m[1]}`;
        else if (m[2]) district = m[3] ? `At-Large ${m[3]}` : "At-Large";
        else if (m[4]) role = "Mayor";
        else if (m[5]) role = "County Chair";
        // Most pages print name, seat, email; Marion prints name, email, seat. Skip an email line.
        let j = i - 1;
        if (/@/.test(lines[j] || "")) j--;
        name = lines[j] || "";
        // A name wrapped onto two lines ("Danielle Levine" / "Cava", "Reggie" / "Gaffney, Jr."): one side is a single word.
        const prev = lines[j - 1] || "";
        if ((word(name) || word(prev)) && NAME.test(prev) && !LABEL.test(prev) && !/@/.test(prev)) name = `${prev} ${name}`;
      }
      if (!NAME.test(name) || LABEL.test(name) || /^(COMMISSIONERS|WEBSITE|SOCIAL)/i.test(name)) { fail(`FL: ${county} ${district || role}: bad name "${name}"`); return; }
      flRows.push({ state: "FL", county, role, district, name, source: SRC.FL.url, source_date: SRC.FL.date });
    });
  }
  const missing = FL_COUNTIES.filter(c => !seenCounty.has(c));
  if (missing.length) fail(`FL: no commission page for ${missing.join(", ")}`);
}

// ---- Checks
const count = (list, key) => list.reduce((acc, r) => (acc[r[key]] = (acc[r[key]] || 0) + 1, acc), {});
const meBy = count(rows, "county");
for (const c of ME_COUNTIES) if (![3, 5, 7].includes(meBy[c])) fail(`ME: ${c} has ${meBy[c] || 0} commissioners (expected 3, 5 or 7)`);
console.log(`ME: ${rows.length} commissioners in ${Object.keys(meBy).length} counties`);
console.log("   " + ME_COUNTIES.map(c => `${c} ${meBy[c] || 0}`).join(", "));

const flAll = flRows.length, flDuval = flRows.filter(r => r.county === "Duval").length;
const flOut = flRows.filter(r => r.county !== "Duval");
const flBy = count(flOut.filter(r => r.role !== "Mayor"), "county");
for (const c of FL_COUNTIES) if (c !== "Duval" && !(flBy[c] >= 5)) fail(`FL: ${c} has ${flBy[c] || 0} board members (expected at least 5)`);
for (const [c, n] of Object.entries(count(flOut, "county"))) {
  const seats = flOut.filter(r => r.county === c && r.district && r.district !== "At-Large").map(r => r.district); // Leon has two unnumbered At-Large seats
  if (new Set(seats).size !== seats.length) fail(`FL: ${c} has a duplicate seat (${seats.join(", ")})`);
}
if (flAll + DUVAL_UNPRINTED !== FL_STATEWIDE) fail(`FL: parsed ${flAll} including Duval (+${DUVAL_UNPRINTED} unprinted Duval seats), directory says ${FL_STATEWIDE} statewide`);
const mayors = flOut.filter(r => r.role === "Mayor");
console.log(`FL: ${flAll} parsed incl. Duval (directory says ${FL_STATEWIDE}); Duval ${flDuval} left out; ${flOut.length} written for ${Object.keys(flBy).length} counties`);
console.log(`   mayors: ${mayors.map(r => `${r.county} (${r.name})`).join(", ")}; boards over 5: ${Object.entries(flBy).filter(([, n]) => n > 5).map(([c, n]) => `${c} ${n}`).join(", ")}`);

if (errors.length) { for (const e of errors) console.error("ERROR " + e); console.error(`${errors.length} problem(s); not writing the CSV.`); process.exit(1); }
const head = ["state", "county", "role", "district", "name", "source", "source_date"];
const out = [...rows, ...flOut];
writeFile(p("data", "reference", "county-commissioners.csv"), toCSV([head, ...out.map(r => head.map(h => r[h]))]));
console.log(`${out.length} rows written to data/reference/county-commissioners.csv`);
