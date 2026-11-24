// Build the website-review queue: every Maine and Florida government in review order, with its website.
// Order: all of Maine, then Florida counties and cities, then Florida districts. Writes data/review/queue.json.
// Usage: node scripts/review/queue.mjs
import { p, readJSON, readText, writeJSON, csvObjects, cleanWebsite } from "../lib/util.mjs";

const ME = readJSON(p("data", "derived", "maine.json"));
const FL = readJSON(p("data", "derived", "florida.json"));
const census = csvObjects(readText(p("data", "reference", "census-govt-units-2022.csv"))).filter(c => c.STATE === "ME" || c.STATE === "FL");
const norm = s => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
const countyKey = n => norm(String(n).replace(/^county of /i, "").replace(/ county$/i, ""));
const web = cleanWebsite;

const byFips = new Map(census.map(c => [c.FIPS_STATE + c.FIPS_COUNTY + c.FIPS_PLACE, c]));
const counties = new Map(census.filter(c => c.UNIT_TYPE.startsWith("1")).map(c => [`${c.STATE}|${countyKey(c.UNIT_NAME)}`, c]));
const districtSites = new Map(csvObjects(readText(p("data", "reference", "fl-district-websites.csv"))).map(r => [norm(r.district), r]));

const queue = [];
const add = (e, website, websiteSource, group) => queue.push({ id: e.id, state: e.state, name: e.name, type: e.type, typeLabel: e.typeLabel, url: e.url, website, websiteSource, group, status: e.status.label, gradable: e.gradable !== false && !e.dissolved });
for (const e of ME.entities) {
  const c = e.type === "county" ? counties.get(`ME|${countyKey(e.name)}`) : e.geoid ? byFips.get(e.geoid) : null;
  add(e, web(c?.WEB_ADDRESS), c?.WEB_ADDRESS ? "Census of Governments 2022" : null, 1);
}
for (const e of FL.entities.filter(e => (e.type === "county" || e.type === "city") && !e.dissolved)) {
  const c = e.type === "county" ? counties.get(`FL|${countyKey(e.name)}`) : e.placeFips ? byFips.get(e.placeFips) : null;
  add(e, web(c?.WEB_ADDRESS), c?.WEB_ADDRESS ? "Census of Governments 2022" : null, 2);
}
for (const e of FL.entities.filter(e => e.type === "district" && !e.dissolved)) {
  const d = districtSites.get(norm(e.sourceName));
  add(e, web(d?.website), d?.website ? "FloridaCommerce Official List of Special Districts" : null, 3);
}
writeJSON(p("data", "review", "queue.json"), { built: new Date().toISOString(), queue });
const g = n => queue.filter(q => q.group === n);
console.log(`queue: ${queue.length} (Maine ${g(1).length}, FL counties+cities ${g(2).length}, FL districts ${g(3).length}); with a website: ${queue.filter(q => q.website).length}`);
for (const n of [1, 2, 3]) console.log(`  group ${n}: ${g(n).filter(q => q.website).length} of ${g(n).length} have a website`);
